'use client';

import { grantablePermissions, isRole, roleDefaults, type Role } from '@arso/domain';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { api, ApiRequestError } from '@/lib/api';
import {
  CURRENCY_OPTIONS,
  formatDateTime,
  PERMISSION_LABELS,
  roleLabel,
  ROLE_LABELS,
  TIMEZONE_OPTIONS,
} from '@/lib/labels';

interface Org {
  id: string;
  name: string;
  role: string;
}
interface Store {
  id: string;
  name: string;
  timezone: string;
  currency: string;
}
interface Grant {
  storeId: string;
  permissions: string[];
}
interface Member {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  grants: Grant[];
}
interface Invitation {
  id: string;
  email: string;
  role: string;
  storeIds: string[];
  expiresAt: string;
}

type View =
  | { state: 'loading' }
  | { state: 'error' }
  | { state: 'no-org' }
  | {
      state: 'ready';
      org: Org;
      stores: Store[];
      members: Member[] | null;
      invitations: Invitation[] | null;
      teamFailed: boolean;
    };

const INVITE_ROLES = (Object.keys(ROLE_LABELS) as Role[]).filter((r) => r !== 'owner');

/** رسالة خطأ عربية من رد الخادم الموحد (القسم 42) */
function messageOf(e: unknown, fallback: string): string {
  if (e instanceof ApiRequestError && e.status !== 500) return e.message;
  return fallback;
}

/** حالة إجراء واحد: انشغال وخطأ ورسالة نجاح */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const run = useCallback(async (fn: () => Promise<string | void>, fallback: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const msg = await fn();
      if (msg) setNotice(msg);
      return true;
    } catch (e) {
      setError(messageOf(e, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, notice, run };
}

function Feedback({ error, notice }: { error: string | null; notice: string | null }) {
  if (error)
    return (
      <p className="alert alert-error" role="alert">
        <span aria-hidden="true">✕ </span>
        {error}
      </p>
    );
  if (notice)
    return (
      <p className="alert alert-ok" role="status">
        <span aria-hidden="true">✓ </span>
        {notice}
      </p>
    );
  return null;
}

export function Settings() {
  const router = useRouter();
  const [view, setView] = useState<View>({ state: 'loading' });

  const load = useCallback(async () => {
    try {
      const me = await api<{ organizations: Org[] }>('/api/v1/me');
      const org = me.organizations[0];
      if (!org) {
        setView({ state: 'no-org' });
        return;
      }
      const base = `/api/v1/organizations/${org.id}`;
      const stores = await api<{ items: Store[] }>(`${base}/stores`);
      let members: Member[] | null = null;
      let invitations: Invitation[] | null = null;
      let teamFailed = false;
      if (org.role === 'owner') {
        try {
          [members, invitations] = await Promise.all([
            api<{ items: Member[] }>(`${base}/members`).then((r) => r.items),
            api<{ items: Invitation[] }>(`${base}/invitations`).then((r) => r.items),
          ]);
        } catch {
          // المتاجر وصلت والفريق تعذّر: حالة جزئية، لا نخفي ما وصل
          teamFailed = true;
        }
      }
      setView({ state: 'ready', org, stores: stores.items, members, invitations, teamFailed });
    } catch (e) {
      if (e instanceof ApiRequestError && e.status === 401) {
        router.push('/sign-in?next=/settings');
        return;
      }
      setView({ state: 'error' });
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  if (view.state === 'loading') {
    return (
      <div aria-busy="true" aria-label="جارٍ التحميل">
        <div className="skeleton skeleton-title" />
        <div className="card skeleton skeleton-card" />
      </div>
    );
  }
  if (view.state === 'error') {
    return (
      <section className="card empty" role="alert">
        <h2>تعذّر تحميل الإعدادات</h2>
        <p>لم يتغير شيء في حسابك. أعد المحاولة بعد لحظة.</p>
        <button type="button" className="btn btn-primary" onClick={() => void load()}>
          إعادة المحاولة
        </button>
      </section>
    );
  }
  if (view.state === 'no-org') {
    return (
      <EmptyState
        title="أنشئ مؤسستك أولًا"
        body="المؤسسة تجمع متاجرك وفريقك. بعد إنشائها تضيف متاجرك وتدعو فريقك من هنا."
        action={
          <Link className="btn btn-primary" href="/onboarding">
            إنشاء مؤسسة
          </Link>
        }
      />
    );
  }

  const { org, stores, members, invitations, teamFailed } = view;
  const isOwner = org.role === 'owner';
  const reload = () => void load();

  return (
    <>
      <div className="page-head">
        <h1>الإعدادات</h1>
        <p className="lead">
          {org.name} · دورك: {roleLabel(org.role)}
        </p>
      </div>

      <StoresSection org={org} stores={stores} canManage={isOwner} onChange={reload} />

      {isOwner ? (
        teamFailed || !members || !invitations ? (
          <section className="section">
            <h2 className="section-title">الفريق والصلاحيات</h2>
            <div className="card" role="alert">
              <p className="alert alert-error">
                <span aria-hidden="true">✕ </span>
                تعذّر تحميل الفريق. المتاجر أعلاه محدّثة.
              </p>
              <button type="button" className="btn btn-ghost" onClick={reload}>
                إعادة المحاولة
              </button>
            </div>
          </section>
        ) : (
          <TeamSection
            org={org}
            stores={stores}
            members={members}
            invitations={invitations}
            onChange={reload}
          />
        )
      ) : (
        <section className="section">
          <h2 className="section-title">الفريق والصلاحيات</h2>
          <p className="card settings-note">
            <span aria-hidden="true">🔒 </span>
            إدارة الفريق والصلاحيات لمالك المؤسسة فقط. إن احتجت وصولًا لمتجر آخر، اطلبه من المالك.
          </p>
        </section>
      )}
    </>
  );
}

/* ===================== المتاجر ===================== */

function StoresSection({
  org,
  stores,
  canManage,
  onChange,
}: {
  org: Org;
  stores: Store[];
  canManage: boolean;
  onChange: () => void;
}) {
  const action = useAction();

  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const d = new FormData(form);
    const ok = await action.run(async () => {
      await api(`/api/v1/organizations/${org.id}/stores`, {
        body: {
          name: String(d.get('name') ?? '').trim(),
          timezone: String(d.get('timezone')),
          currency: String(d.get('currency')),
        },
      });
      return 'أُضيف المتجر. الخطوة التالية ربطه بمصدر بياناته.';
    }, 'تعذّر إضافة المتجر');
    if (ok) {
      form.reset();
      onChange();
    }
  }

  return (
    <section className="section" aria-labelledby="stores-title">
      <h2 id="stores-title" className="section-title">
        المتاجر
      </h2>
      {stores.length === 0 ? (
        <p className="card settings-note">
          {canManage
            ? 'لا متاجر بعد. أضف متجرك الأول ثم اربطه بمصدر بياناته.'
            : 'لم يمنحك المالك وصولًا لأي متجر بعد.'}
        </p>
      ) : (
        <div className="table-wrap card">
          <table>
            <thead>
              <tr>
                <th scope="col">المتجر</th>
                <th scope="col">المنطقة الزمنية</th>
                <th scope="col">العملة</th>
                <th scope="col">الربط</th>
              </tr>
            </thead>
            <tbody>
              {stores.map((s) => (
                <tr key={s.id}>
                  <th scope="row">{s.name}</th>
                  <td>
                    <span className="num">{s.timezone}</span>
                  </td>
                  <td>
                    <span className="num">{s.currency}</span>
                  </td>
                  <td>
                    <span className="badge badge-missing">
                      <span aria-hidden="true">◔</span> غير مربوط
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canManage ? (
        <form className="card settings-form" onSubmit={add} aria-labelledby="add-store-title">
          <h3 id="add-store-title">إضافة متجر</h3>
          <div className="settings-fields">
            <div className="field">
              <label htmlFor="store-name">اسم المتجر</label>
              <input id="store-name" name="name" required minLength={2} maxLength={100} />
            </div>
            <div className="field">
              <label htmlFor="store-tz">المنطقة الزمنية</label>
              <select id="store-tz" name="timezone" defaultValue="Asia/Riyadh">
                {TIMEZONE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="store-cur">عملة المتجر</label>
              <select id="store-cur" name="currency" defaultValue="SAR">
                {CURRENCY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="field-hint">الفترات والتقارير تُحسب بالمنطقة الزمنية للمتجر.</p>
          <Feedback error={action.error} notice={action.notice} />
          <button type="submit" className="btn btn-primary" disabled={action.busy}>
            {action.busy ? 'لحظة…' : 'إضافة المتجر'}
          </button>
        </form>
      ) : null}
    </section>
  );
}

/* ===================== الفريق ===================== */

function storeNames(ids: string[], stores: Store[]): string {
  if (ids.length === 0) return 'لا متاجر';
  return ids.map((id) => stores.find((s) => s.id === id)?.name ?? 'متجر محذوف').join('، ');
}

function TeamSection({
  org,
  stores,
  members,
  invitations,
  onChange,
}: {
  org: Org;
  stores: Store[];
  members: Member[];
  invitations: Invitation[];
  onChange: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const action = useAction();
  const base = `/api/v1/organizations/${org.id}`;
  const active = members.filter((m) => m.status === 'active');
  const editingMember = active.find((m) => m.id === editing);

  async function revokeMember(m: Member) {
    const ok = await action.run(async () => {
      await api(`${base}/members/${m.id}/revoke`, { method: 'POST' });
      return `سُحبت عضوية ${m.name || m.email}. فقد الوصول فورًا.`;
    }, 'تعذّر سحب العضوية');
    setConfirming(null);
    if (ok) onChange();
  }

  async function revokeInvitation(inv: Invitation) {
    const ok = await action.run(async () => {
      await api(`${base}/invitations/${inv.id}/revoke`, { method: 'POST' });
      return `أُلغيت دعوة ${inv.email}. رابطها لم يعد يعمل.`;
    }, 'تعذّر إلغاء الدعوة');
    if (ok) onChange();
  }

  return (
    <section className="section" aria-labelledby="team-title">
      <h2 id="team-title" className="section-title">
        الفريق والصلاحيات
      </h2>
      <p className="settings-intro">
        كل عضو يرى المتاجر التي تمنحها له فقط، بصلاحيات دوره وما تضيفه. السحب فوري، وكل تعديل مسجّل.
      </p>
      <Feedback error={action.error} notice={action.notice} />

      <div className="table-wrap card">
        <table>
          <thead>
            <tr>
              <th scope="col">العضو</th>
              <th scope="col">الدور</th>
              <th scope="col">المتاجر</th>
              <th scope="col">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {active.map((m) => (
              <tr key={m.id}>
                <th scope="row">
                  <span className="settings-member">
                    <span>{m.name || '—'}</span>
                    <span className="num settings-email">{m.email}</span>
                  </span>
                </th>
                <td>{roleLabel(m.role)}</td>
                <td>
                  {m.role === 'owner'
                    ? 'كل المتاجر'
                    : storeNames(
                        m.grants.map((g) => g.storeId),
                        stores,
                      )}
                </td>
                <td>
                  {m.role === 'owner' ? (
                    <span className="field-hint">صلاحيات كاملة وثابتة</span>
                  ) : confirming === m.id ? (
                    <div className="actions">
                      <button
                        type="button"
                        className="btn btn-danger"
                        disabled={action.busy}
                        onClick={() => void revokeMember(m)}
                      >
                        تأكيد السحب
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setConfirming(null)}
                      >
                        تراجع
                      </button>
                    </div>
                  ) : (
                    <div className="actions">
                      <button
                        type="button"
                        className="btn btn-ghost"
                        aria-expanded={editing === m.id}
                        onClick={() => setEditing(editing === m.id ? null : m.id)}
                      >
                        تعديل الوصول
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => setConfirming(m.id)}
                      >
                        سحب العضوية
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editingMember ? (
        <AccessEditor
          key={editingMember.id}
          base={base}
          member={editingMember}
          stores={stores}
          onDone={(changed) => {
            setEditing(null);
            if (changed) onChange();
          }}
        />
      ) : null}

      <InviteForm base={base} stores={stores} onDone={onChange} />

      <h3 className="settings-sub">دعوات بانتظار القبول</h3>
      {invitations.length === 0 ? (
        <p className="card settings-note">لا دعوات معلّقة.</p>
      ) : (
        <div className="table-wrap card">
          <table>
            <thead>
              <tr>
                <th scope="col">البريد</th>
                <th scope="col">الدور</th>
                <th scope="col">المتاجر</th>
                <th scope="col">تنتهي</th>
                <th scope="col">إجراء</th>
              </tr>
            </thead>
            <tbody>
              {invitations.map((inv) => (
                <tr key={inv.id}>
                  <th scope="row">
                    <span className="num">{inv.email}</span>
                  </th>
                  <td>{roleLabel(inv.role)}</td>
                  <td>{storeNames(inv.storeIds, stores)}</td>
                  <td>
                    <span className="nowrap">{formatDateTime(inv.expiresAt)}</span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={action.busy}
                      onClick={() => void revokeInvitation(inv)}
                    >
                      إلغاء الدعوة
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function StoreChecks({
  stores,
  selected,
  onToggle,
  children,
}: {
  stores: Store[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  children?: (store: Store) => ReactNode;
}) {
  if (stores.length === 0) {
    return <p className="field-hint">أضف متجرًا أولًا لتمنح الوصول إليه.</p>;
  }
  return (
    <ul className="check-list">
      {stores.map((s) => (
        <li key={s.id}>
          <label className="check">
            <input type="checkbox" checked={selected.has(s.id)} onChange={() => onToggle(s.id)} />
            <span>{s.name}</span>
          </label>
          {selected.has(s.id) && children ? children(s) : null}
        </li>
      ))}
    </ul>
  );
}

function AccessEditor({
  base,
  member,
  stores,
  onDone,
}: {
  base: string;
  member: Member;
  stores: Store[];
  onDone: (changed: boolean) => void;
}) {
  const role: Role | null = isRole(member.role) ? member.role : null;
  // الاعتماد يحتاج MFA وبوابة E2، فلا نعرضه كصلاحية قابلة للمنح قبلها (CLAUDE.md §7)
  const extras = role ? grantablePermissions(role).filter((p) => p !== 'actions.approve') : [];
  const defaults = role ? roleDefaults(role) : [];
  const [grants, setGrants] = useState<Map<string, Set<string>>>(
    () => new Map(member.grants.map((g) => [g.storeId, new Set(g.permissions)])),
  );
  const action = useAction();

  function toggleStore(id: string) {
    setGrants((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, new Set());
      return next;
    });
  }
  function togglePerm(storeId: string, p: string) {
    setGrants((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(storeId));
      if (set.has(p)) set.delete(p);
      else set.add(p);
      next.set(storeId, set);
      return next;
    });
  }

  async function save() {
    const ok = await action.run(async () => {
      await api(`${base}/members/${member.id}/grants`, {
        method: 'PUT',
        body: {
          grants: [...grants].map(([storeId, perms]) => ({ storeId, permissions: [...perms] })),
        },
      });
    }, 'تعذّر حفظ الوصول');
    if (ok) onDone(true);
  }

  return (
    <div className="card settings-form" role="region" aria-labelledby="access-title">
      <h3 id="access-title">وصول {member.name || member.email}</h3>
      <p className="field-hint">
        صلاحيات دور «{roleLabel(member.role)}» على كل متجر يُمنح له:{' '}
        {defaults.length
          ? defaults.map((p) => PERMISSION_LABELS[p]).join('، ')
          : 'لا شيء افتراضيًا؛ كل صلاحية تُضاف صراحة'}
        .
      </p>
      <fieldset className="settings-fieldset">
        <legend>المتاجر التي يراها، وما تضيفه على كل متجر</legend>
        <StoreChecks stores={stores} selected={new Set(grants.keys())} onToggle={toggleStore}>
          {(s) =>
            extras.length ? (
              <fieldset className="check-sub">
                <legend className="field-hint">صلاحيات إضافية على {s.name}</legend>
                {extras.map((p) => (
                  <label key={p} className="check">
                    <input
                      type="checkbox"
                      checked={grants.get(s.id)?.has(p) ?? false}
                      onChange={() => togglePerm(s.id, p)}
                    />
                    <span>{PERMISSION_LABELS[p]}</span>
                  </label>
                ))}
              </fieldset>
            ) : null
          }
        </StoreChecks>
      </fieldset>
      {grants.size === 0 ? (
        <p className="alert" role="status">
          <span aria-hidden="true">ⓘ </span>
          بلا أي متجر لن يرى هذا العضو أي بيانات.
        </p>
      ) : null}
      <Feedback error={action.error} notice={action.notice} />
      <div className="actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={action.busy}
          onClick={() => void save()}
        >
          {action.busy ? 'لحظة…' : 'حفظ الوصول'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => onDone(false)}>
          إلغاء
        </button>
      </div>
    </div>
  );
}

function InviteForm({
  base,
  stores,
  onDone,
}: {
  base: string;
  stores: Store[];
  onDone: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const action = useAction();

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const d = new FormData(form);
    const email = String(d.get('email') ?? '').trim();
    const ok = await action.run(async () => {
      await api(`${base}/invitations`, {
        body: { email, role: String(d.get('role')), storeIds: [...selected] },
      });
      return `أرسلنا الدعوة إلى ${email}. الرابط يعمل مرة واحدة ولهذا البريد فقط.`;
    }, 'تعذّر إرسال الدعوة');
    if (ok) {
      form.reset();
      setSelected(new Set());
      onDone();
    }
  }

  return (
    <form className="card settings-form" onSubmit={submit} aria-labelledby="invite-title">
      <h3 id="invite-title">دعوة عضو</h3>
      <div className="settings-fields">
        <div className="field">
          <label htmlFor="invite-email">البريد الإلكتروني</label>
          <input
            id="invite-email"
            name="email"
            type="email"
            dir="ltr"
            required
            autoComplete="off"
          />
        </div>
        <div className="field">
          <label htmlFor="invite-role">الدور</label>
          <select id="invite-role" name="role" defaultValue="analyst">
            {INVITE_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <fieldset className="settings-fieldset">
        <legend>المتاجر التي سيراها</legend>
        <StoreChecks stores={stores} selected={selected} onToggle={toggle} />
      </fieldset>
      {selected.size === 0 && stores.length > 0 ? (
        <p className="field-hint">بلا متجر لن يرى العضو أي بيانات حتى تمنحه وصولًا.</p>
      ) : null}
      <Feedback error={action.error} notice={action.notice} />
      <button type="submit" className="btn btn-primary" disabled={action.busy}>
        {action.busy ? 'لحظة…' : 'إرسال الدعوة'}
      </button>
    </form>
  );
}
