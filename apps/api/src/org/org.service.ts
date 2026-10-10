import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { withTenant } from '@arso/db';
import {
  effectivePermissions,
  isPermission,
  organizationPermissions,
  type Permission,
  type Role,
  type StoreGrant,
} from '@arso/domain';
import type { AppConfig } from '../config.js';
import { CONFIG } from '../tokens.js';
import { SQL, type Sql } from '../db.js';
import { ApiError } from '../errors.js';
import { MAILER, type Mailer } from '../mail/mailer.js';
import type { AuthUser } from '../auth/session.guard.js';

export interface Membership {
  id: string;
  organizationId: string;
  role: Role;
  status: 'active';
}

interface PgError {
  code?: string;
}

const notFound = () => new ApiError(404, 'NOT_FOUND', 'العنصر غير موجود');
const forbidden = () => new ApiError(403, 'FORBIDDEN', 'لا تملك صلاحية هذا الإجراء');

@Injectable()
export class OrgService {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}

  async listMyOrganizations(userId: string) {
    const rows = await this.sql<
      { organization_id: string; organization_name: string; role: string }[]
    >`SELECT organization_id, organization_name, role FROM user_memberships(${userId})`;
    return rows.map((r) => ({ id: r.organization_id, name: r.organization_name, role: r.role }));
  }

  async createOrganization(user: AuthUser, name: string): Promise<{ id: string }> {
    const [r] = await this.sql<
      { id: string }[]
    >`SELECT create_organization(${name}, ${user.id}) AS id`;
    return { id: r!.id };
  }

  /**
   * عضوية المستخدم في المؤسسة. غير العضو يحصل على 404 لا 403،
   * حتى لا يكشف الرد وجود مؤسسة لا يملك الوصول إليها (القسم 42).
   */
  async requireMembership(orgId: string, userId: string): Promise<Membership> {
    const rows = await withTenant(
      this.sql,
      orgId,
      (tx) => tx<{ id: string; role: Role }[]>`
      SELECT id, role FROM memberships WHERE user_id = ${userId} AND status = 'active'`,
    );
    const m = rows[0];
    if (!m) throw notFound();
    return { id: m.id, organizationId: orgId, role: m.role, status: 'active' };
  }

  requireOrgPermission(m: Membership, p: Permission): void {
    if (!organizationPermissions(m).has(p)) throw forbidden();
  }

  private async grantsFor(orgId: string, membershipId: string): Promise<StoreGrant[]> {
    const rows = await withTenant(
      this.sql,
      orgId,
      (tx) =>
        tx<
          {
            store_id: string;
            permissions: string[];
            expires_at: Date | null;
            revoked_at: Date | null;
          }[]
        >`SELECT store_id, permissions, expires_at, revoked_at FROM store_grants WHERE membership_id = ${membershipId}`,
    );
    return rows.map((r) => ({
      storeId: r.store_id,
      permissions: r.permissions,
      expiresAt: r.expires_at,
      revokedAt: r.revoked_at,
    }));
  }

  /** المتاجر التي يراها العضو: المالك يرى الكل، وغيره المتاجر الممنوحة بصلاحية قراءة فقط */
  async listStores(m: Membership) {
    const stores = await withTenant(
      this.sql,
      m.organizationId,
      (tx) =>
        tx<
          { id: string; name: string; timezone: string; currency: string; sector: string }[]
        >`SELECT id, name, timezone, currency, sector FROM stores ORDER BY created_at`,
    );
    if (m.role === 'owner') return stores;
    const grants = await this.grantsFor(m.organizationId, m.id);
    return stores.filter((s) => effectivePermissions(m, s.id, grants).size > 0);
  }

  async createStore(m: Membership, input: { name: string; timezone: string; currency: string }) {
    this.requireOrgPermission(m, 'connections.manage');
    return withTenant(this.sql, m.organizationId, async (tx) => {
      const [s] = await tx<{ id: string }[]>`
        INSERT INTO stores (organization_id, name, timezone, currency)
        VALUES (${m.organizationId}, ${input.name}, ${input.timezone}, ${input.currency}) RETURNING id`;
      await this.audit(tx, m, 'store.create', 'store', s!.id, null, input);
      return { id: s!.id };
    });
  }

  async listMembers(m: Membership) {
    this.requireOrgPermission(m, 'members.manage');
    return withTenant(
      this.sql,
      m.organizationId,
      (tx) => tx`
      SELECT membership_id AS id, email, name, role, status FROM current_org_members()`,
    );
  }

  /**
   * دعوة عضو: رمز عشوائي 256 بت يُرسل بالبريد مرة واحدة، وتُخزن تجزئته فقط.
   * المتاجر المحددة يجب أن تكون من نفس المؤسسة.
   */
  async invite(
    m: Membership,
    actor: AuthUser,
    input: { email: string; role: Exclude<Role, 'owner'>; storeIds: string[] },
  ) {
    this.requireOrgPermission(m, 'members.manage');
    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest();
    const expiresAt = new Date(Date.now() + this.config.INVITATION_TTL_HOURS * 3_600_000);
    const storeIds = [...new Set(input.storeIds.map((s) => s.toLowerCase()))];

    const id = await withTenant(this.sql, m.organizationId, async (tx) => {
      if (storeIds.length) {
        const found = await tx`SELECT id FROM stores WHERE id = ANY(${storeIds}::uuid[])`;
        if (found.length !== storeIds.length) {
          throw new ApiError(422, 'VALIDATION_FAILED', 'بعض المتاجر غير موجودة في هذه المؤسسة', {
            fields: ['storeIds'],
          });
        }
      }
      const [inv] = await tx<{ id: string }[]>`
        INSERT INTO invitations (organization_id, email, role, store_ids, token_hash, invited_by, expires_at)
        VALUES (${m.organizationId}, ${input.email}, ${input.role}, ${storeIds}::uuid[], ${tokenHash},
                ${m.id}, ${expiresAt})
        RETURNING id`;
      await this.audit(tx, m, 'invitation.create', 'invitation', inv!.id, null, {
        role: input.role,
        storeIds,
      });
      return inv!.id;
    });

    const link = `${this.config.PUBLIC_WEB_URL}/invite/accept?token=${token}`;
    await this.mailer.send({
      to: input.email,
      subject: 'دعوة للانضمام إلى فريق في أرسو',
      text: `دعاك ${actor.name} للانضمام إلى فريقه في أرسو.\nاقبل الدعوة خلال ${this.config.INVITATION_TTL_HOURS} ساعة:\n${link}\n\nإن لم تتوقع هذه الدعوة، تجاهل الرسالة.`,
    });
    return { id, expiresAt: expiresAt.toISOString() };
  }

  async acceptInvitation(user: AuthUser, token: string): Promise<{ organizationId: string }> {
    const tokenHash = createHash('sha256').update(token).digest();
    try {
      const [r] = await this.sql<
        { org: string }[]
      >`SELECT accept_invitation(${tokenHash}, ${user.id}) AS org`;
      return { organizationId: r!.org };
    } catch (e) {
      const code = (e as PgError).code;
      // نفس الرد لكل الحالات: لا نكشف إن كانت الدعوة موجودة أو لمن هي
      if (code === 'P0002' || code === '42501') {
        throw new ApiError(404, 'INVITATION_INVALID', 'الدعوة غير صالحة أو منتهية أو لبريد آخر');
      }
      throw e;
    }
  }

  /**
   * تعديل منح عضو (ملاحظة المراجعة الأمنية #3): المالك فقط، ولا تعديل لعضوية مالك،
   * ويُسجَّل الأثر قبل وبعد في سجل التدقيق.
   */
  async setGrants(
    m: Membership,
    targetMembershipId: string,
    grants: { storeId: string; permissions: string[] }[],
  ) {
    this.requireOrgPermission(m, 'members.manage');
    for (const g of grants) {
      if (!g.permissions.every(isPermission)) {
        throw new ApiError(422, 'VALIDATION_FAILED', 'صلاحية غير معروفة', { fields: ['grants'] });
      }
    }
    return withTenant(this.sql, m.organizationId, async (tx) => {
      const [target] = await tx<{ role: string }[]>`
        SELECT role FROM memberships WHERE id = ${targetMembershipId} AND status = 'active' FOR UPDATE`;
      if (!target) throw notFound();
      if (target.role === 'owner') {
        throw new ApiError(409, 'OWNER_GRANTS_IMMUTABLE', 'صلاحيات المالك ثابتة ولا تُعدّل');
      }
      const before = await tx`
        SELECT store_id, permissions FROM store_grants
        WHERE membership_id = ${targetMembershipId} AND revoked_at IS NULL ORDER BY store_id`;

      const storeIds = [...new Set(grants.map((g) => g.storeId.toLowerCase()))];
      if (storeIds.length) {
        const found = await tx`SELECT id FROM stores WHERE id = ANY(${storeIds}::uuid[])`;
        if (found.length !== storeIds.length) {
          throw new ApiError(422, 'VALIDATION_FAILED', 'بعض المتاجر غير موجودة في هذه المؤسسة', {
            fields: ['grants'],
          });
        }
      }
      await tx`UPDATE store_grants SET revoked_at = now()
               WHERE membership_id = ${targetMembershipId} AND revoked_at IS NULL`;
      for (const g of grants) {
        await tx`
          INSERT INTO store_grants (organization_id, membership_id, store_id, permissions)
          VALUES (${m.organizationId}, ${targetMembershipId}, ${g.storeId}, ${g.permissions})
          ON CONFLICT (membership_id, store_id)
            DO UPDATE SET permissions = EXCLUDED.permissions, revoked_at = NULL, expires_at = NULL`;
      }
      await this.audit(tx, m, 'grants.update', 'membership', targetMembershipId, before, grants);
      return { membershipId: targetMembershipId, grants };
    });
  }

  /** سحب العضوية فوري: الحالة revoked وكل منحها مسحوبة (القسم 8) */
  async revokeMember(m: Membership, targetMembershipId: string) {
    this.requireOrgPermission(m, 'members.manage');
    if (targetMembershipId === m.id) {
      throw new ApiError(409, 'CANNOT_REVOKE_SELF', 'لا يمكنك سحب عضويتك بنفسك');
    }
    return withTenant(this.sql, m.organizationId, async (tx) => {
      const [target] = await tx<{ role: string }[]>`
        SELECT role FROM memberships WHERE id = ${targetMembershipId} AND status = 'active' FOR UPDATE`;
      if (!target) throw notFound();
      if (target.role === 'owner') {
        throw new ApiError(409, 'OWNER_IMMUTABLE', 'لا يمكن سحب عضوية مالك من هنا');
      }
      await tx`UPDATE memberships SET status = 'revoked', revoked_at = now() WHERE id = ${targetMembershipId}`;
      await tx`UPDATE store_grants SET revoked_at = now()
               WHERE membership_id = ${targetMembershipId} AND revoked_at IS NULL`;
      await this.audit(
        tx,
        m,
        'membership.revoke',
        'membership',
        targetMembershipId,
        { role: target.role },
        null,
      );
      return { id: targetMembershipId, status: 'revoked' as const };
    });
  }

  private async audit(
    tx: Sql | import('@arso/db').TransactionSql,
    m: Membership,
    action: string,
    targetType: string,
    targetId: string,
    before: unknown,
    after: unknown,
  ) {
    const [u] = await tx<{ user_id: string }[]>`SELECT user_id FROM memberships WHERE id = ${m.id}`;
    await tx`
      INSERT INTO audit_logs (organization_id, actor_type, actor_id, action, target_type, target_id,
                              before_state, after_state)
      VALUES (${m.organizationId}, 'user', ${u!.user_id}, ${action}, ${targetType}, ${targetId},
              ${before === null ? null : tx.json(before as never)}, ${after === null ? null : tx.json(after as never)})`;
  }
}
