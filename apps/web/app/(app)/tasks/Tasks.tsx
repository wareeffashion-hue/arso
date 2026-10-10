'use client';

import type { TaskStatus } from '@arso/domain';
import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { api, ApiRequestError } from '@/lib/api';
import { formatDateTime } from '@/lib/labels';
import { useSelection, withSelection } from '@/lib/store-context';

interface Task {
  id: string;
  title: string;
  brief: string | null;
  acceptanceCriteria: string | null;
  status: TaskStatus;
  final: boolean;
  problem: { id: string; title: string | null; ruleId: string | null } | null;
  owner: { id: string; name: string; me: boolean } | null;
  dueOn: string | null;
  cost?: { amount: string; currency: string } | null;
  result: string | null;
  cancelReason: string | null;
  createdBy: string;
  createdAt: string;
  revision: number;
  canEdit: boolean;
  nextStatuses: TaskStatus[];
  events?: {
    kind: string;
    toStatus: string | null;
    body: string | null;
    actor: string | null;
    at: string;
  }[];
}
interface TaskList {
  items: Task[];
  canCreate: boolean;
  seesCost: boolean;
}
interface Person {
  id: string;
  name: string;
  me: boolean;
}

export const TASK_LABELS: Record<TaskStatus, string> = {
  open: 'مفتوحة',
  assigned: 'مسندة',
  in_progress: 'قيد التنفيذ',
  review: 'بانتظار المراجعة',
  accepted: 'مقبولة',
  cancelled: 'ملغاة',
};
const ACTION_LABELS: Partial<Record<TaskStatus, string>> = {
  in_progress: 'ابدأ التنفيذ',
  review: 'سلّم للمراجعة',
  accepted: 'اقبل التسليم',
  cancelled: 'ألغِ المهمة',
  open: 'أزل الإسناد',
  assigned: 'أسند',
};

type Filter = 'mine' | 'active' | 'closed';

function messageOf(e: unknown, fallback: string) {
  return e instanceof ApiRequestError && e.status !== 500 ? e.message : fallback;
}

export function Tasks() {
  const sel = useSelection();
  const base =
    sel.state === 'ready' ? `/api/v1/organizations/${sel.org.id}/stores/${sel.store.id}` : null;
  const [data, setData] = useState<{ key: string; list: TaskList | null; failed: boolean }>({
    key: '',
    list: null,
    failed: false,
  });
  const [people, setPeople] = useState<Person[]>([]);
  const [filter, setFilter] = useState<Filter>('active');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!base) return;
    try {
      const list = await api<TaskList>(`${base}/tasks`);
      setData({ key: base, list, failed: false });
    } catch {
      setData({ key: base, list: null, failed: true });
    }
  }, [base]);

  useEffect(() => {
    void load();
    if (base) {
      api<{ items: Person[] }>(`${base}/problems/assignees`)
        .then((r) => setPeople(r.items))
        .catch(() => setPeople([]));
    }
  }, [load, base]);

  if (sel.state === 'no-org' || sel.state === 'no-store') {
    return (
      <EmptyState
        title="أضف متجرًا أولًا"
        body="المهام تخص متجرًا محددًا."
        action={
          <Link
            className="btn btn-primary"
            href={sel.state === 'no-org' ? '/onboarding' : '/settings'}
          >
            {sel.state === 'no-org' ? 'إنشاء مؤسسة' : 'إضافة متجر'}
          </Link>
        }
      />
    );
  }
  const current = data.key === base ? data : null;
  if (sel.state === 'error' || current?.failed) {
    return (
      <section className="card empty" role="alert">
        <h2>تعذّر تحميل المهام</h2>
        <p>أعد المحاولة بعد لحظة.</p>
        <button type="button" className="btn btn-primary" onClick={() => void load()}>
          إعادة المحاولة
        </button>
      </section>
    );
  }
  if (!current?.list || sel.state !== 'ready') {
    return (
      <div className="card skeleton skeleton-card" aria-busy="true" aria-label="جارٍ التحميل" />
    );
  }

  const list = current.list;
  const match = (t: Task) =>
    filter === 'mine' ? t.owner?.me === true && !t.final : filter === 'active' ? !t.final : t.final;
  const shown = list.items.filter(match);
  const count = (f: Filter) =>
    list.items.filter((t) =>
      f === 'mine' ? t.owner?.me === true && !t.final : f === 'active' ? !t.final : t.final,
    ).length;

  return (
    <>
      <div className="problems-bar">
        <div className="segmented" role="group" aria-label="تصفية المهام">
          {(
            [
              ['active', 'الجارية'],
              ['mine', 'مهامي'],
              ['closed', 'المغلقة'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-pressed={filter === k}
              className={filter === k ? 'active' : ''}
              onClick={() => setFilter(k)}
            >
              {label} <span className="num">({count(k)})</span>
            </button>
          ))}
        </div>
        {list.canCreate ? (
          <button type="button" className="btn btn-primary" onClick={() => setCreating(!creating)}>
            {creating ? 'إغلاق النموذج' : 'مهمة جديدة'}
          </button>
        ) : null}
      </div>

      {creating ? (
        <CreateForm
          base={base!}
          people={people}
          seesCost={list.seesCost}
          onCreated={() => {
            setCreating(false);
            void load();
          }}
        />
      ) : null}

      {shown.length === 0 ? (
        <section className="card empty" role="status">
          <h2>{filter === 'closed' ? 'لا مهام مغلقة بعد' : 'لا مهام جارية'}</h2>
          <p>
            حوّل أي بطاقة من «المشكلات والفرص» إلى مهمة لها مسؤول وموعد ومعيار تسليم، أو أنشئ مهمة
            مباشرة.
          </p>
          <Link className="btn btn-ghost" href={withSelection('/opportunities', sel)}>
            المشكلات والفرص
          </Link>
        </section>
      ) : (
        <ol className="problem-list">
          {shown.map((t) => (
            <li key={t.id}>
              <TaskCard
                task={t}
                base={base!}
                people={people}
                seesCost={list.seesCost}
                problemsHref={withSelection('/opportunities', sel)}
                onChanged={() => void load()}
              />
            </li>
          ))}
        </ol>
      )}
      <p className="field-hint">
        قبول المهمة يعني أن العمل سُلّم حسب معياره، ولا يعني نجاحه التجاري؛ ذاك يُقاس لاحقًا بالمؤشر
        أو التجربة.
      </p>
    </>
  );
}

function CreateForm({
  base,
  people,
  seesCost,
  onCreated,
}: {
  base: string;
  people: Person[];
  seesCost: boolean;
  onCreated: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    const val = (k: string) => String(d.get(k) ?? '').trim() || null;
    setBusy(true);
    setError(null);
    try {
      await api(`${base}/tasks`, {
        body: {
          title: val('title') ?? '',
          brief: val('brief'),
          acceptanceCriteria: val('criteria'),
          ownerMembershipId: val('owner'),
          dueOn: val('due'),
          ...(seesCost ? { costAmount: val('cost') } : {}),
        },
      });
      onCreated();
    } catch (err) {
      setError(messageOf(err, 'تعذّر إنشاء المهمة'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card settings-form" onSubmit={submit} aria-labelledby="new-task-title">
      <h2 id="new-task-title" className="section-title">
        مهمة جديدة
      </h2>
      <div className="field">
        <label htmlFor="t-title">العنوان</label>
        <input id="t-title" name="title" required minLength={2} maxLength={200} />
      </div>
      <div className="field">
        <label htmlFor="t-brief">الموجز</label>
        <textarea id="t-brief" name="brief" rows={3} maxLength={4000} />
      </div>
      <div className="field">
        <label htmlFor="t-criteria">معيار التسليم</label>
        <input id="t-criteria" name="criteria" maxLength={2000} placeholder="متى نعتبرها منجزة؟" />
      </div>
      <div className="settings-fields">
        <div className="field">
          <label htmlFor="t-owner">المسؤول</label>
          <select id="t-owner" name="owner" defaultValue="">
            <option value="">بلا مسؤول بعد</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.me ? ' (أنا)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="t-due">الموعد</label>
          <input id="t-due" name="due" type="date" dir="ltr" />
        </div>
        {seesCost ? (
          <div className="field">
            <label htmlFor="t-cost">التكلفة (ريال، اختياري)</label>
            <input
              id="t-cost"
              name="cost"
              inputMode="decimal"
              dir="ltr"
              pattern="\d{1,14}(\.\d{1,6})?"
            />
          </div>
        ) : null}
      </div>
      {error ? (
        <p className="alert alert-error" role="alert">
          <span aria-hidden="true">✕ </span>
          {error}
        </p>
      ) : null}
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? 'لحظة…' : 'إنشاء المهمة'}
      </button>
    </form>
  );
}

function TaskCard({
  task,
  base,
  people,
  seesCost,
  problemsHref,
  onChanged,
}: {
  task: Task;
  base: string;
  people: Person[];
  seesCost: boolean;
  problemsHref: string;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Task | null>(null);
  const [pending, setPending] = useState<TaskStatus | null>(null);
  const [note, setNote] = useState('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const t = detail ?? task;

  useEffect(() => {
    if (!open || detail) return;
    api<Task>(`${base}/tasks/${task.id}`)
      .then(setDetail)
      .catch(() => setDetail(null));
  }, [open, detail, base, task.id]);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      setDetail(
        await api<Task>(`${base}/tasks/${t.id}`, {
          method: 'PATCH',
          body: { revision: t.revision, ...body },
        }),
      );
      setPending(null);
      setNote('');
      onChanged();
    } catch (err) {
      setError(messageOf(err, 'تعذّر الحفظ'));
    } finally {
      setBusy(false);
    }
  }

  function move(to: TaskStatus) {
    if (to === 'accepted' || to === 'cancelled') {
      setPending(to);
      setOpen(true);
      return;
    }
    void patch({ status: to });
  }

  async function addComment(e: FormEvent) {
    e.preventDefault();
    if (!comment.trim()) return;
    try {
      setDetail(await api<Task>(`${base}/tasks/${t.id}/comments`, { body: { body: comment } }));
      setComment('');
    } catch (err) {
      setError(messageOf(err, 'تعذّر إضافة التعليق'));
    }
  }

  const overdue = !t.final && t.dueOn !== null && t.dueOn < new Date().toISOString().slice(0, 10);
  return (
    <article className={`card problem${t.final ? ' closed' : ''}`} id={t.id}>
      <header className="problem-head">
        <div className="problem-tags">
          <span className={`badge ${t.final ? 'badge-ok' : 'badge-partial'}`}>
            {TASK_LABELS[t.status]}
          </span>
          {overdue ? (
            <span className="badge badge-missing">
              <span aria-hidden="true">!</span> متأخرة عن موعدها
            </span>
          ) : null}
          {t.problem ? (
            <Link className="field-hint" href={`${problemsHref}#${t.problem.id}`}>
              من بطاقة: {t.problem.title}
            </Link>
          ) : null}
        </div>
        <h3>{t.title}</h3>
        <div className="problem-meta">
          <span>
            {t.owner ? `المسؤول: ${t.owner.name}${t.owner.me ? ' (أنت)' : ''}` : 'بلا مسؤول'}
          </span>
          {t.dueOn ? (
            <span>
              الموعد: <span className="num">{t.dueOn}</span>
            </span>
          ) : null}
          {seesCost && t.cost ? (
            <span>
              التكلفة: <span className="num">{t.cost.amount}</span>{' '}
              {t.cost.currency === 'SAR' ? 'ريال' : t.cost.currency}
            </span>
          ) : null}
        </div>
        {t.result ? (
          <p className="problem-fact">
            <span className="fact-label">النتيجة</span> {t.result}
          </p>
        ) : null}
        {t.cancelReason ? (
          <p className="problem-fact">
            <span className="fact-label">سبب الإلغاء</span> {t.cancelReason}
          </p>
        ) : null}
        <div className="actions">
          {t.nextStatuses.map((s) =>
            s === 'assigned' || s === 'open' ? null : (
              <button
                key={s}
                type="button"
                className={s === 'cancelled' ? 'btn btn-ghost' : 'btn btn-primary'}
                disabled={busy}
                onClick={() => move(s)}
              >
                {ACTION_LABELS[s]}
              </button>
            ),
          )}
          <button
            type="button"
            className="btn btn-ghost"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? 'إخفاء التفاصيل' : 'التفاصيل والسجل'}
          </button>
        </div>
        {error ? (
          <p className="alert alert-error" role="alert">
            <span aria-hidden="true">✕ </span>
            {error}
          </p>
        ) : null}
      </header>

      {open ? (
        <div className="problem-body">
          {pending ? (
            <form
              className="manage"
              onSubmit={(e) => {
                e.preventDefault();
                void patch(
                  pending === 'accepted'
                    ? { status: pending, result: note }
                    : { status: pending, cancelReason: note },
                );
              }}
            >
              <div className="field">
                <label htmlFor={`note-${t.id}`}>
                  {pending === 'accepted' ? 'ما الذي سُلّم؟ (النتيجة)' : 'سبب الإلغاء'}
                </label>
                <textarea
                  id={`note-${t.id}`}
                  required
                  rows={2}
                  maxLength={pending === 'accepted' ? 4000 : 1000}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
              <div className="actions">
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {pending === 'accepted' ? 'اقبل التسليم' : 'ألغِ المهمة'}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setPending(null)}>
                  تراجع
                </button>
              </div>
            </form>
          ) : null}
          {t.brief ? (
            <section>
              <h4>الموجز</h4>
              <p style={{ whiteSpace: 'pre-line', margin: 0 }}>{t.brief}</p>
            </section>
          ) : null}
          {t.acceptanceCriteria ? (
            <section>
              <h4>معيار التسليم</h4>
              <p style={{ margin: 0 }}>{t.acceptanceCriteria}</p>
            </section>
          ) : null}
          {t.canEdit && !t.final ? (
            <section className="manage">
              <div className="settings-fields">
                <div className="field">
                  <label htmlFor={`own-${t.id}`}>المسؤول</label>
                  <select
                    id={`own-${t.id}`}
                    value={t.owner?.id ?? ''}
                    onChange={(e) => void patch({ ownerMembershipId: e.target.value || null })}
                    disabled={busy}
                  >
                    <option value="">بلا مسؤول</option>
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor={`due-${t.id}`}>الموعد</label>
                  <input
                    id={`due-${t.id}`}
                    type="date"
                    dir="ltr"
                    defaultValue={t.dueOn ?? ''}
                    onBlur={(e) =>
                      e.target.value !== (t.dueOn ?? '') &&
                      void patch({ dueOn: e.target.value || null })
                    }
                  />
                </div>
              </div>
            </section>
          ) : null}
          <section>
            <h4>السجل والتعليقات</h4>
            <ul className="timeline">
              {(t.events ?? []).map((ev, i) => (
                <li key={i}>
                  <span className="field-hint nowrap">{formatDateTime(ev.at)}</span>
                  <span>
                    {ev.actor ? <b>{ev.actor}: </b> : null}
                    {ev.kind === 'comment'
                      ? ev.body
                      : ev.kind === 'status' || ev.kind === 'created'
                        ? `${ev.kind === 'created' ? 'أنشأ المهمة' : 'غيّر الحالة'} ← ${TASK_LABELS[ev.toStatus as TaskStatus] ?? ''}${ev.body ? `: ${ev.body}` : ''}`
                        : ev.kind === 'owner'
                          ? 'غيّر المسؤول'
                          : 'عدّل المهمة'}
                  </span>
                </li>
              ))}
            </ul>
            <form className="comment-form" onSubmit={addComment}>
              <label className="visually-hidden" htmlFor={`tc-${t.id}`}>
                تعليق
              </label>
              <input
                id={`tc-${t.id}`}
                value={comment}
                maxLength={2000}
                placeholder="أضف تحديثًا أو تعليقًا"
                onChange={(e) => setComment(e.target.value)}
              />
              <button type="submit" className="btn btn-ghost">
                إضافة
              </button>
            </form>
          </section>
        </div>
      ) : null}
    </article>
  );
}
