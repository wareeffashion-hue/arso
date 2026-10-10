'use client';

import { nextStatuses, REASON_REQUIRED, type ProblemStatus } from '@arso/domain';
import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { api, ApiRequestError } from '@/lib/api';
import { formatDateTime } from '@/lib/labels';
import {
  KIND_LABELS,
  SCORE_PARTS,
  SIGNAL_LABELS,
  STATUS_LABELS,
  type Problem,
  type ProblemList,
} from '@/lib/problems';
import { useSelection, withSelection } from '@/lib/store-context';

type Filter = 'open' | 'closed' | 'all';

function messageOf(e: unknown, fallback: string) {
  return e instanceof ApiRequestError && e.status !== 500 ? e.message : fallback;
}

export function Opportunities() {
  const sel = useSelection();
  const base =
    sel.state === 'ready'
      ? `/api/v1/organizations/${sel.org.id}/stores/${sel.store.id}/problems`
      : null;
  const [data, setData] = useState<{ key: string; list: ProblemList | null; failed: boolean }>({
    key: '',
    list: null,
    failed: false,
  });
  const [filter, setFilter] = useState<Filter>('open');
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (evaluate = false) => {
      if (!base) return;
      setBusy(evaluate);
      try {
        const list = evaluate
          ? await api<ProblemList>(`${base}/evaluate`, { method: 'POST' })
          : await api<ProblemList>(base);
        setData({ key: base, list, failed: false });
      } catch {
        setData({ key: base, list: null, failed: true });
      } finally {
        setBusy(false);
      }
    },
    [base],
  );

  useEffect(() => {
    void load();
  }, [load]);

  if (sel.state === 'no-org' || sel.state === 'no-store') {
    return (
      <EmptyState
        title="أضف متجرًا أولًا"
        body="القواعد تفحص بيانات متجر محدد."
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
        <h2>تعذّر تحميل المشكلات والفرص</h2>
        <p>أعد المحاولة بعد لحظة.</p>
        <button type="button" className="btn btn-primary" onClick={() => void load()}>
          إعادة المحاولة
        </button>
      </section>
    );
  }
  if (!current?.list || sel.state !== 'ready') {
    return (
      <div aria-busy="true" aria-label="جارٍ التحميل">
        <div className="card skeleton skeleton-card" />
      </div>
    );
  }

  const list = current.list;
  const shown = list.items.filter((p) =>
    filter === 'all' ? true : filter === 'open' ? p.open : !p.open,
  );
  return (
    <>
      <div className="problems-bar">
        <div className="segmented" role="group" aria-label="تصفية حسب الحالة">
          {(
            [
              ['open', 'مفتوحة'],
              ['closed', 'مغلقة'],
              ['all', 'الكل'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-pressed={filter === k}
              className={filter === k ? 'active' : ''}
              onClick={() => setFilter(k)}
            >
              {label}{' '}
              <span className="num">
                (
                {
                  list.items.filter((p) => (k === 'all' ? true : k === 'open' ? p.open : !p.open))
                    .length
                }
                )
              </span>
            </button>
          ))}
        </div>
        <span className="field-hint">
          {list.evaluatedAt ? `آخر فحص ${formatDateTime(list.evaluatedAt)}` : 'لم يُفحص بعد'}
        </span>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy}
          onClick={() => void load(true)}
        >
          {busy ? 'نفحص…' : 'إعادة الفحص'}
        </button>
      </div>

      {list.hiddenRules.length ? (
        <p className="field-hint">
          <span aria-hidden="true">🔒 </span>
          بعض القواعد المالية ({list.hiddenRules.join('، ')}) غير متاحة لدورك.
        </p>
      ) : null}

      {shown.length === 0 ? (
        <section className="card empty" role="status">
          <h2>{filter === 'open' ? 'لا مشكلات مفتوحة في البيانات المتاحة' : 'لا بطاقات هنا'}</h2>
          <p>
            القواعد تفحص ما استوردته فقط. القواعد التي تنتظر بيانات مذكورة أدناه، ولن نستنتج منها
            شيئًا قبل توفر مصدرها.
          </p>
          <Link className="btn btn-ghost" href={withSelection('/imports', sel)}>
            استيراد بيانات
          </Link>
        </section>
      ) : (
        <ol className="problem-list">
          {shown.map((p) => (
            <li key={p.id}>
              <ProblemCard problem={p} base={base!} onChanged={() => void load()} />
            </li>
          ))}
        </ol>
      )}

      <section className="section" aria-labelledby="waiting-title">
        <h2 id="waiting-title" className="section-title">
          قواعد تنتظر بيانات
        </h2>
        <div className="table-wrap card">
          <table>
            <thead>
              <tr>
                <th scope="col">القاعدة</th>
                <th scope="col">النوع</th>
                <th scope="col">ما تحتاجه</th>
              </tr>
            </thead>
            <tbody>
              {list.waiting.map((w) => (
                <tr key={w.id}>
                  <th scope="row">
                    <span className="num">{w.id}</span> {w.title}
                  </th>
                  <td>{KIND_LABELS[w.kind]}</td>
                  <td>{w.needs}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function ScoreBreakdown({ score }: { score: Problem['score'] }) {
  return (
    <div className="score">
      <p className="score-total">
        ترتيب داخلي <b className="num">{score.total}</b>
        <span className="field-hint"> من 10 · ليس احتمال نجاح</span>
      </p>
      <ul>
        {SCORE_PARTS.map((part) => (
          <li key={part.key}>
            <span>{part.label}</span>
            <span className="score-dots" aria-label={`${score[part.key]} من ${part.max}`}>
              {Array.from({ length: part.max }, (_, i) => (
                <span key={i} className={i < score[part.key] ? 'on' : ''} aria-hidden="true" />
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProblemCard({
  problem,
  base,
  onChanged,
}: {
  problem: Problem;
  base: string;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Problem | null>(null);
  const p = detail ?? problem;

  useEffect(() => {
    if (!open || detail) return;
    api<Problem>(`${base}/${problem.id}`)
      .then(setDetail)
      .catch(() => setDetail(null));
  }, [open, detail, base, problem.id]);

  return (
    <article className={`card problem${p.open ? '' : ' closed'}`} id={p.id}>
      <header className="problem-head">
        <div className="problem-tags">
          <span className="badge badge-missing">{KIND_LABELS[p.kind]}</span>
          <span className={`badge ${p.open ? 'badge-partial' : 'badge-ok'}`}>
            {STATUS_LABELS[p.status]}
          </span>
          {p.quality === 'limited_sample' ? (
            <span className="badge badge-partial">
              <span aria-hidden="true">◔</span> عينة محدودة
            </span>
          ) : null}
          {p.conditionClearedAt ? (
            <span className="badge badge-ok">
              <span aria-hidden="true">✓</span> الشرط لم يعد قائمًا
            </span>
          ) : null}
          <span className="field-hint num">
            {p.ruleId} · {p.score.total}/10
          </span>
        </div>
        <h3>{p.title}</h3>
        <p className="problem-fact">
          <span className="fact-label">ما حدث</span> {p.observation.text}
        </p>
        <p className="problem-action">
          <span className="fact-label">الخطوة</span> {p.action}
        </p>
        <div className="problem-meta">
          {p.owner ? <span>المسؤول: {p.owner.name}</span> : <span>بلا مسؤول</span>}
          {p.dueOn ? (
            <span>
              الموعد: <span className="num">{p.dueOn}</span>
            </span>
          ) : null}
          {p.statusReason ? <span>السبب: {p.statusReason}</span> : null}
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? 'إخفاء التفاصيل' : 'الدليل والفحوص'}
        </button>
      </header>

      {open ? (
        <div className="problem-body">
          <section>
            <h4>الدليل (من بياناتك)</h4>
            {p.evidence.length ? (
              <ul className="evidence">
                {p.evidence.map((e) => (
                  <li key={e.label}>
                    <b className="num">{e.label}</b>
                    <span className="num">{e.value}</span>
                    {e.detail ? <span className="field-hint">{e.detail}</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="field-hint">الملاحظة أعلاه هي الدليل.</p>
            )}
          </section>
          {p.hypotheses.length ? (
            <section>
              <h4>تفسيرات محتملة · فرضيات وليست حقائق</h4>
              <ul className="hypotheses">
                {p.hypotheses.map((h) => (
                  <li key={h.text} className={`sig-${h.signal}`}>
                    <span aria-hidden="true">{SIGNAL_LABELS[h.signal].icon}</span>
                    <span>{h.text}</span>
                    <span className="field-hint">{SIGNAL_LABELS[h.signal].text}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <section>
            <h4>فحوص لازمة قبل القرار</h4>
            <ul className="checks-list">
              {p.checks.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </section>
          <ScoreBreakdown score={p.score} />
          {p.canManage && p.open ? <ToTask problem={p} base={base} /> : null}
          {p.canManage ? (
            <Manage problem={p} base={base} onSaved={(np) => (setDetail(np), onChanged())} />
          ) : (
            <p className="field-hint">
              <span aria-hidden="true">🔒 </span>
              تغيير الحالة والمسؤول لمن يملك صلاحية إدارة هذا النوع.
            </p>
          )}
          <Comments problem={p} base={base} onSaved={setDetail} />
        </div>
      ) : null}
    </article>
  );
}

function Manage({
  problem,
  base,
  onSaved,
}: {
  problem: Problem;
  base: string;
  onSaved: (p: Problem) => void;
}) {
  const options = nextStatuses(problem.status);
  const [status, setStatus] = useState<ProblemStatus | ''>('');
  const [reason, setReason] = useState('');
  const [owner, setOwner] = useState(problem.owner?.id ?? '');
  const [due, setDue] = useState(problem.dueOn ?? '');
  const [people, setPeople] = useState<{ id: string; name: string; me: boolean }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ items: { id: string; name: string; me: boolean }[] }>(`${base}/assignees`)
      .then((r) => setPeople(r.items))
      .catch(() => setPeople([]));
  }, [base]);

  const needsReason = status !== '' && REASON_REQUIRED.has(status);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { revision: problem.revision };
      if (status) {
        body.status = status;
        body.reason = reason || null;
      }
      if (owner !== (problem.owner?.id ?? '')) body.ownerMembershipId = owner || null;
      if (due !== (problem.dueOn ?? '')) body.dueOn = due || null;
      onSaved(await api<Problem>(`${base}/${problem.id}`, { method: 'PATCH', body }));
      setStatus('');
      setReason('');
    } catch (err) {
      setError(messageOf(err, 'تعذّر الحفظ'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="manage" onSubmit={save} aria-label="إدارة البطاقة">
      <div className="settings-fields">
        <div className="field">
          <label htmlFor={`st-${problem.id}`}>الحالة الجديدة</label>
          <select
            id={`st-${problem.id}`}
            value={status}
            onChange={(e) => setStatus(e.target.value as ProblemStatus | '')}
            disabled={options.length === 0}
          >
            <option value="">بلا تغيير ({STATUS_LABELS[problem.status]})</option>
            {options.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`ow-${problem.id}`}>المسؤول</label>
          <select id={`ow-${problem.id}`} value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">بلا مسؤول</option>
            {people.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.me ? ' (أنا)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`due-${problem.id}`}>الموعد</label>
          <input
            id={`due-${problem.id}`}
            type="date"
            dir="ltr"
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
        </div>
      </div>
      {needsReason ? (
        <div className="field">
          <label htmlFor={`rs-${problem.id}`}>
            {status === 'resolved' ? 'كيف حُلّت؟ (الدليل أو النتيجة)' : 'السبب'}
          </label>
          <textarea
            id={`rs-${problem.id}`}
            required
            maxLength={1000}
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
      ) : null}
      {error ? (
        <p className="alert alert-error" role="alert">
          <span aria-hidden="true">✕ </span>
          {error}
        </p>
      ) : null}
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? 'لحظة…' : 'حفظ'}
      </button>
    </form>
  );
}

function Comments({
  problem,
  base,
  onSaved,
}: {
  problem: Problem;
  base: string;
  onSaved: (p: Problem) => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const events = problem.events ?? [];

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setError(null);
    try {
      onSaved(await api<Problem>(`${base}/${problem.id}/comments`, { body: { body: text } }));
      setText('');
    } catch (err) {
      setError(messageOf(err, 'تعذّر إضافة التعليق'));
    }
  }

  const label = (ev: (typeof events)[number]) => {
    if (ev.kind === 'comment') return ev.body;
    if (ev.kind === 'status')
      return `غيّر الحالة إلى «${STATUS_LABELS[ev.toStatus as ProblemStatus] ?? ev.toStatus}»${ev.body ? `: ${ev.body}` : ''}`;
    if (ev.kind === 'owner') return 'غيّر المسؤول';
    if (ev.kind === 'created') return 'أنشأتها القاعدة';
    if (ev.kind === 'refreshed') return 'حدّثتها القاعدة ببيانات جديدة';
    return 'لم يعد الشرط قائمًا في آخر فحص';
  };

  return (
    <section>
      <h4>السجل والتعليقات</h4>
      <ul className="timeline">
        {events.map((ev, i) => (
          <li key={i}>
            <span className="field-hint nowrap">{formatDateTime(ev.at)}</span>
            <span>
              {ev.actor ? <b>{ev.actor}: </b> : null}
              {label(ev)}
            </span>
          </li>
        ))}
      </ul>
      <form className="comment-form" onSubmit={add}>
        <label className="visually-hidden" htmlFor={`cm-${problem.id}`}>
          تعليق
        </label>
        <input
          id={`cm-${problem.id}`}
          value={text}
          maxLength={2000}
          placeholder="أضف تعليقًا أو نتيجة فحص"
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="btn btn-ghost">
          إضافة
        </button>
      </form>
      {error ? (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** تحويل البطاقة إلى مهمة بمسودة من الخطوة والملاحظة والفحوص؛ تُعدَّل لاحقًا في صفحة المهام */
function ToTask({ problem, base }: { problem: Problem; base: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const storeBase = base.replace(/\/problems$/, '');
  async function create() {
    setState('busy');
    try {
      const draft = await api<{ title: string; brief: string; problemId: string }>(
        `${base}/${problem.id}/task-draft`,
      );
      await api(`${storeBase}/tasks`, { body: draft });
      setState('done');
    } catch {
      setState('error');
    }
  }
  return (
    <div className="actions">
      {state === 'done' ? (
        <p className="alert alert-ok" role="status">
          <span aria-hidden="true">✓ </span>
          أُنشئت مهمة من هذه البطاقة. <Link href="/tasks">افتح المهام</Link>
        </p>
      ) : (
        <button
          type="button"
          className="btn btn-primary"
          disabled={state === 'busy'}
          onClick={() => void create()}
        >
          {state === 'busy' ? 'لحظة…' : 'حوّل إلى مهمة'}
        </button>
      )}
      {state === 'error' ? (
        <p className="alert alert-error" role="alert">
          تعذّر إنشاء المهمة. تحتاج صلاحية تحضير الإجراءات.
        </p>
      ) : null}
    </div>
  );
}
