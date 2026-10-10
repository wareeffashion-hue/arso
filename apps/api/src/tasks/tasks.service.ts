import { Inject, Injectable } from '@nestjs/common';
import { withTenant, type TransactionSql } from '@arso/db';
import {
  canMoveTask,
  currencyScale,
  Decimal,
  ruleById,
  TASK_FINAL,
  taskNextStatuses,
  type TaskStatus,
} from '@arso/domain';
import { SQL, type Sql } from '../db.js';
import { ApiError } from '../errors.js';
import type { Membership, StoreAccess } from '../org/org.service.js';
import { ProblemsService } from '../problems/problems.service.js';

interface TaskRow {
  id: string;
  problem_id: string | null;
  problem_rule_id: string | null;
  problem_title: string | null;
  title: string;
  brief: string | null;
  acceptance_criteria: string | null;
  owner_membership_id: string | null;
  due_on: string | null;
  status: TaskStatus;
  cost_amount: string | null;
  cost_currency: string | null;
  result: string | null;
  cancel_reason: string | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  revision: number;
}

export interface TaskInput {
  title?: string;
  brief?: string | null;
  acceptanceCriteria?: string | null;
  ownerMembershipId?: string | null;
  dueOn?: string | null;
  costAmount?: string | null;
}

const notFound = () => new ApiError(404, 'NOT_FOUND', 'العنصر غير موجود');
const forbidden = () => new ApiError(403, 'FORBIDDEN', 'لا تملك صلاحية هذا الإجراء');

/**
 * المهام (القسم 28). الإدارة بـ actions.prepare، والمسؤول عن المهمة يبدأها ويسلّمها للمراجعة.
 * مهمة مرتبطة بمشكلة لا يقرؤها العضو (مثل Q03 المالية) لا تظهر له، والتكلفة لا تظهر
 * إلا لمن يملك finance.read_summary (AC02).
 */
@Injectable()
export class TasksService {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly problems: ProblemsService,
  ) {}

  private canManage(store: StoreAccess) {
    return store.permissions.has('actions.prepare');
  }

  private seesCost(store: StoreAccess) {
    return store.permissions.has('finance.read_summary');
  }

  private problemReadable(store: StoreAccess, ruleId: string | null) {
    if (!ruleId) return true;
    const rule = ruleById(ruleId);
    return (
      Boolean(rule) &&
      (rule!.readPermission === null || store.permissions.has(rule!.readPermission))
    );
  }

  private async names(tx: TransactionSql) {
    const rows = await tx<{ membership_id: string; name: string | null }[]>`
      SELECT membership_id, name FROM current_org_members()`;
    return new Map(rows.map((r) => [r.membership_id, r.name ?? 'عضو']));
  }

  private select(tx: TransactionSql, store: StoreAccess, id?: string, lock = false) {
    return tx<TaskRow[]>`
      SELECT t.id, t.problem_id, p.rule_id AS problem_rule_id, p.title AS problem_title, t.title,
             t.brief, t.acceptance_criteria, t.owner_membership_id, t.due_on::text AS due_on,
             t.status, t.cost_amount::text AS cost_amount, t.cost_currency, t.result,
             t.cancel_reason, t.created_by, t.created_at, t.updated_at, t.revision
      FROM tasks t LEFT JOIN problems p ON p.id = t.problem_id
      WHERE t.store_id = ${store.id} ${id ? tx`AND t.id = ${id}` : tx``}
      ORDER BY (t.status IN ('accepted', 'cancelled')), t.due_on NULLS LAST, t.created_at DESC
      LIMIT 500 ${lock ? tx`FOR UPDATE OF t` : tx``}`;
  }

  private present(r: TaskRow, m: Membership, store: StoreAccess, names: Map<string, string>) {
    const isAssignee = r.owner_membership_id === m.id;
    const actor = { canManage: this.canManage(store), isAssignee };
    return {
      id: r.id,
      title: r.title,
      brief: r.brief,
      acceptanceCriteria: r.acceptance_criteria,
      status: r.status,
      final: TASK_FINAL.has(r.status),
      problem: r.problem_id
        ? { id: r.problem_id, title: r.problem_title, ruleId: r.problem_rule_id }
        : null,
      owner: r.owner_membership_id
        ? {
            id: r.owner_membership_id,
            name: names.get(r.owner_membership_id) ?? 'عضو',
            me: isAssignee,
          }
        : null,
      dueOn: r.due_on,
      cost: this.seesCost(store)
        ? r.cost_amount === null
          ? null
          : {
              amount: new Decimal(r.cost_amount).toFixed(currencyScale(r.cost_currency!.trim())),
              currency: r.cost_currency!.trim(),
            }
        : undefined,
      result: r.result,
      cancelReason: r.cancel_reason,
      createdBy: names.get(r.created_by) ?? 'عضو',
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
      revision: r.revision,
      canEdit: actor.canManage,
      nextStatuses: taskNextStatuses(r.status).filter((s) => canMoveTask(r.status, s, actor)),
    };
  }

  async list(m: Membership, store: StoreAccess) {
    return withTenant(this.sql, m.organizationId, async (tx) => {
      const rows = (await this.select(tx, store)).filter((r) =>
        this.problemReadable(store, r.problem_rule_id),
      );
      const names = await this.names(tx);
      return {
        items: rows.map((r) => this.present(r, m, store, names)),
        canCreate: this.canManage(store),
        seesCost: this.seesCost(store),
      };
    });
  }

  private async load(tx: TransactionSql, store: StoreAccess, id: string, lock = false) {
    const [r] = await this.select(tx, store, id, lock);
    if (!r || !this.problemReadable(store, r.problem_rule_id)) throw notFound();
    return r;
  }

  async get(m: Membership, store: StoreAccess, id: string) {
    return withTenant(this.sql, m.organizationId, async (tx) => {
      const r = await this.load(tx, store, id);
      const names = await this.names(tx);
      const events = await tx<
        {
          kind: string;
          from_status: string | null;
          to_status: string | null;
          body: string | null;
          actor_membership_id: string | null;
          occurred_at: Date;
        }[]
      >`SELECT kind, from_status, to_status, body, actor_membership_id, occurred_at
        FROM task_events WHERE task_id = ${id} ORDER BY id DESC LIMIT 100`;
      return {
        ...this.present(r, m, store, names),
        events: events.map((e) => ({
          kind: e.kind,
          fromStatus: e.from_status,
          toStatus: e.to_status,
          body: e.body,
          actor: e.actor_membership_id ? (names.get(e.actor_membership_id) ?? 'عضو') : null,
          at: e.occurred_at.toISOString(),
        })),
      };
    });
  }

  private async checkOwner(m: Membership, store: StoreAccess, ownerId: string | null | undefined) {
    if (!ownerId) return;
    const ok = (await this.problems.assignees(m, store)).some((a) => a.id === ownerId);
    if (!ok) {
      throw new ApiError(422, 'VALIDATION_FAILED', 'المسؤول يجب أن يكون عضوًا يرى هذا المتجر', {
        fields: ['ownerMembershipId'],
      });
    }
  }

  /** أي لمس للتكلفة (تحديدها أو مسحها بـ null) لمن يملك finance.read_summary فقط */
  private checkCost(store: StoreAccess, cost: string | null | undefined) {
    if (cost === undefined) return;
    if (!this.seesCost(store)) throw forbidden();
  }

  private async audit(
    tx: TransactionSql,
    m: Membership,
    store: StoreAccess,
    action: string,
    id: string,
    before: unknown,
    after: unknown,
  ) {
    const [u] = await tx<{ user_id: string }[]>`SELECT user_id FROM memberships WHERE id = ${m.id}`;
    await tx`
      INSERT INTO audit_logs (organization_id, store_id, actor_type, actor_id, action, target_type,
                              target_id, before_state, after_state)
      VALUES (${m.organizationId}, ${store.id}, 'user', ${u!.user_id}, ${action}, 'task', ${id},
              ${before === null ? null : tx.json(before as never)},
              ${after === null ? null : tx.json(after as never)})`;
  }

  async create(
    m: Membership,
    store: StoreAccess,
    input: TaskInput & { title: string; problemId?: string | null },
  ) {
    if (!this.canManage(store)) throw forbidden();
    await this.checkOwner(m, store, input.ownerMembershipId);
    this.checkCost(store, input.costAmount);
    const id = await withTenant(this.sql, m.organizationId, async (tx) => {
      if (input.problemId) {
        const [p] = await tx<{ rule_id: string }[]>`
          SELECT rule_id FROM problems WHERE id = ${input.problemId} AND store_id = ${store.id}`;
        if (!p || !this.problemReadable(store, p.rule_id)) {
          throw new ApiError(422, 'VALIDATION_FAILED', 'المشكلة غير موجودة في هذا المتجر', {
            fields: ['problemId'],
          });
        }
      }
      const status: TaskStatus = input.ownerMembershipId ? 'assigned' : 'open';
      const [t] = await tx<{ id: string }[]>`
        INSERT INTO tasks ${tx({
          organization_id: m.organizationId,
          store_id: store.id,
          problem_id: input.problemId ?? null,
          title: input.title,
          brief: input.brief ?? null,
          acceptance_criteria: input.acceptanceCriteria ?? null,
          owner_membership_id: input.ownerMembershipId ?? null,
          due_on: input.dueOn ?? null,
          status,
          cost_amount: input.costAmount ?? null,
          cost_currency: input.costAmount ? store.currency : null,
          created_by: m.id,
        })} RETURNING id`;
      await tx`INSERT INTO task_events (organization_id, task_id, actor_membership_id, kind, to_status)
               VALUES (${m.organizationId}, ${t!.id}, ${m.id}, 'created', ${status})`;
      if (input.problemId) {
        await tx`INSERT INTO problem_events (organization_id, problem_id, actor_membership_id, kind, body)
                 VALUES (${m.organizationId}, ${input.problemId}, ${m.id}, 'comment',
                         ${`أُنشئت مهمة: ${input.title}`})`;
      }
      await this.audit(tx, m, store, 'task.create', t!.id, null, {
        status,
        problemId: input.problemId ?? null,
      });
      return t!.id;
    });
    return this.get(m, store, id);
  }

  async update(
    m: Membership,
    store: StoreAccess,
    id: string,
    input: TaskInput & {
      revision: number;
      status?: TaskStatus;
      result?: string | null;
      cancelReason?: string | null;
    },
  ) {
    await withTenant(this.sql, m.organizationId, async (tx) => {
      const r = await this.load(tx, store, id, true);
      if (r.revision !== input.revision) {
        throw new ApiError(
          409,
          'REVISION_CONFLICT',
          'تغيّرت المهمة قبل لحظات. راجع آخر نسخة ثم أعد المحاولة',
        );
      }
      const manage = this.canManage(store);
      const isAssignee = r.owner_membership_id === m.id;
      const editsFields = (
        [
          'title',
          'brief',
          'acceptanceCriteria',
          'ownerMembershipId',
          'dueOn',
          'costAmount',
        ] as const
      ).some((k) => input[k] !== undefined);
      if (editsFields && !manage) throw forbidden();
      if (editsFields && TASK_FINAL.has(r.status)) {
        throw new ApiError(409, 'TASK_FINAL', 'المهمة مغلقة ولا تُعدّل');
      }
      if (input.ownerMembershipId !== undefined)
        await this.checkOwner(m, store, input.ownerMembershipId);
      this.checkCost(store, input.costAmount);

      const set: Record<string, unknown> = {};
      if (input.title !== undefined) set.title = input.title;
      if (input.brief !== undefined) set.brief = input.brief;
      if (input.acceptanceCriteria !== undefined)
        set.acceptance_criteria = input.acceptanceCriteria;
      if (input.dueOn !== undefined) set.due_on = input.dueOn;
      if (input.costAmount !== undefined) {
        set.cost_amount = input.costAmount;
        set.cost_currency = input.costAmount === null ? null : store.currency;
      }

      let status = r.status;
      if (
        input.ownerMembershipId !== undefined &&
        input.ownerMembershipId !== r.owner_membership_id
      ) {
        set.owner_membership_id = input.ownerMembershipId;
        // الإسناد يغيّر الحالة بين «مفتوحة» و«مسندة» فقط، وبحدث موثق
        if (input.ownerMembershipId && status === 'open') status = 'assigned';
        if (!input.ownerMembershipId && status === 'assigned') status = 'open';
        if (!input.ownerMembershipId && !['open', 'assigned'].includes(status)) {
          throw new ApiError(422, 'VALIDATION_FAILED', 'لا تُزال المسؤولية عن مهمة بدأ تنفيذها', {
            fields: ['ownerMembershipId'],
          });
        }
        await tx`INSERT INTO task_events (organization_id, task_id, actor_membership_id, kind)
                 VALUES (${m.organizationId}, ${id}, ${m.id}, 'owner')`;
      }

      if (input.status && input.status !== status) {
        if (!canMoveTask(status, input.status, { canManage: manage, isAssignee })) {
          throw new ApiError(
            manage || isAssignee ? 422 : 403,
            manage || isAssignee ? 'INVALID_TRANSITION' : 'FORBIDDEN',
            manage || isAssignee
              ? 'لا يمكن الانتقال إلى هذه الحالة من الحالة الحالية'
              : 'لا تملك صلاحية هذا الإجراء',
            { fields: ['status'] },
          );
        }
        if (input.status === 'accepted') {
          const result = input.result?.trim();
          if (!result) {
            throw new ApiError(422, 'RESULT_REQUIRED', 'اكتب ما سُلّم ونتيجته قبل القبول', {
              fields: ['result'],
            });
          }
          set.result = result;
        }
        if (input.status === 'cancelled') {
          const reason = input.cancelReason?.trim();
          if (!reason) {
            throw new ApiError(422, 'REASON_REQUIRED', 'اكتب سبب الإلغاء', {
              fields: ['cancelReason'],
            });
          }
          set.cancel_reason = reason;
        }
        if (input.status === 'assigned' && !(set.owner_membership_id ?? r.owner_membership_id)) {
          throw new ApiError(422, 'VALIDATION_FAILED', 'حدد مسؤولًا قبل الإسناد', {
            fields: ['ownerMembershipId'],
          });
        }
        await tx`INSERT INTO task_events (organization_id, task_id, actor_membership_id, kind,
                                          from_status, to_status, body)
                 VALUES (${m.organizationId}, ${id}, ${m.id}, 'status', ${status}, ${input.status},
                         ${(set.result ?? set.cancel_reason ?? null) as string | null})`;
        status = input.status;
      }
      if (status !== r.status) set.status = status;
      if (Object.keys(set).length === 0) return;
      if (editsFields) {
        await tx`INSERT INTO task_events (organization_id, task_id, actor_membership_id, kind)
                 VALUES (${m.organizationId}, ${id}, ${m.id}, 'edit')`;
      }
      await tx`UPDATE tasks SET ${tx(set)}, updated_at = now(), revision = revision + 1 WHERE id = ${id}`;
      await this.audit(
        tx,
        m,
        store,
        'task.update',
        id,
        { status: r.status, owner: r.owner_membership_id },
        { ...set, cost_amount: set.cost_amount === undefined ? undefined : 'changed' },
      );
    });
    return this.get(m, store, id);
  }

  async comment(m: Membership, store: StoreAccess, id: string, body: string) {
    await withTenant(this.sql, m.organizationId, async (tx) => {
      await this.load(tx, store, id);
      await tx`INSERT INTO task_events (organization_id, task_id, actor_membership_id, kind, body)
               VALUES (${m.organizationId}, ${id}, ${m.id}, 'comment', ${body})`;
    });
    return this.get(m, store, id);
  }

  /** عنوان وموجز مقترحان من بطاقة مشكلة، يعدّلهما المستخدم قبل الإنشاء */
  async draftFromProblem(m: Membership, store: StoreAccess, problemId: string) {
    const p = await this.problems.get(m, store, problemId);
    return {
      title: p.action.length <= 200 ? p.action : p.title,
      brief: `${p.observation.text}\n\nالفحوص:\n${p.checks.map((c) => `- ${c}`).join('\n')}`,
      problemId: p.id,
    };
  }
}
