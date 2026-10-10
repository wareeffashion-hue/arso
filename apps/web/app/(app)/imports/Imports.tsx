'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { api, ApiRequestError } from '@/lib/api';
import { formatDateTime } from '@/lib/labels';
import { useSelection, withSelection } from '@/lib/store-context';

type Kind = 'orders' | 'costs' | 'ad_spend';

const KINDS: { kind: Kind; title: string; body: string; who: string }[] = [
  {
    kind: 'orders',
    title: 'الطلبات وبنودها',
    body: 'صف لكل بند: الطلب، والتاريخ، والحالة، والمتغير، والكمية، والإيراد دون ضريبة. الشحن المحصّل على مستوى الطلب ويتكرر بنفس القيمة في بنوده.',
    who: 'المالك',
  },
  {
    kind: 'costs',
    title: 'تكاليف المنتجات',
    body: 'تكلفة كل متغير دون ضريبة وتاريخ سريانها. التصحيح لنفس التاريخ يُحفظ نسخة جديدة، والقديمة تبقى للتفسير.',
    who: 'المالك والمالية',
  },
  {
    kind: 'ad_spend',
    title: 'الإنفاق الإعلاني اليومي',
    body: 'صف لكل حملة ويوم، بمنطقة الحساب الإعلاني وعملته كما في تقرير المنصة.',
    who: 'المالك',
  },
];

interface Rejected {
  line: number;
  reasons: string[];
}
interface Preview {
  id: string;
  kind: Kind;
  alreadyImported: boolean;
  totalRows: number;
  counts: { create: number; update: number; duplicate: number; rejected: number };
  summary: Record<string, unknown> & { warnings: string[] };
  rejected: Rejected[];
}
interface Batch {
  id: string;
  kind: Kind;
  fileName: string;
  totalRows: number;
  counts: { create: number; update: number; duplicate: number; rejected: number };
  committedAt: string | null;
}

const KIND_LABEL: Record<Kind, string> = {
  orders: 'الطلبات',
  costs: 'التكاليف',
  ad_spend: 'الإنفاق',
};
const MAX_BYTES = 20 * 1024 * 1024;

function errorText(e: unknown): string {
  if (e instanceof ApiRequestError) {
    if (e.status === 403) return 'لا تملك صلاحية استيراد هذا النوع لهذا المتجر';
    if (e.status === 413) return 'الملف أكبر من 20 ميغابايت؛ قسّمه إلى ملفات أصغر';
    if (e.status !== 500) return e.message;
  }
  return 'تعذّر إتمام الطلب. أعد المحاولة بعد لحظة';
}

export function Imports() {
  const sel = useSelection();
  const [kind, setKind] = useState<Kind>('orders');
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [naive, setNaive] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<Batch[] | null>(null);

  const base =
    sel.state === 'ready' ? `/api/v1/organizations/${sel.org.id}/stores/${sel.store.id}` : null;

  const loadHistory = useCallback(async () => {
    if (!base) return;
    try {
      setHistory((await api<{ items: Batch[] }>(`${base}/imports`)).items);
    } catch {
      setHistory([]);
    }
  }, [base]);

  // تبديل المتجر يمسح كل ما يخص المتجر السابق (AC14)
  useEffect(() => {
    setPreview(null);
    setDone(null);
    setError(null);
    setHistory(null);
    void loadHistory();
  }, [loadHistory]);

  function reset() {
    setPreview(null);
    setDone(null);
    setError(null);
  }

  async function pick(f: File | undefined) {
    reset();
    if (!f) return setFile(null);
    if (f.size > MAX_BYTES) {
      setFile(null);
      return setError('الملف أكبر من 20 ميغابايت؛ قسّمه إلى ملفات أصغر');
    }
    setFile({ name: f.name, text: await f.text() });
  }

  async function runPreview(e: FormEvent) {
    e.preventDefault();
    if (!base || !file || sel.state !== 'ready') return;
    setBusy(true);
    reset();
    try {
      setPreview(
        await api<Preview>(`${base}/imports`, {
          body: {
            kind,
            fileName: file.name,
            csv: file.text,
            naiveTimezone: naive ? sel.store.timezone : null,
          },
        }),
      );
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!base || !file || !preview) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ counts: Preview['counts'] }>(`${base}/imports/${preview.id}/commit`, {
        body: { csv: file.text },
      });
      setDone(
        `اعتُمد الملف: ${r.counts.create} جديد، و${r.counts.update} محدّث، و${r.counts.duplicate} مكرر لم يتغير، و${r.counts.rejected} مرفوض.`,
      );
      setPreview(null);
      setFile(null);
      void loadHistory();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (sel.state === 'loading') {
    return (
      <div className="card skeleton skeleton-card" aria-busy="true" aria-label="جارٍ التحميل" />
    );
  }
  if (sel.state === 'error') {
    return (
      <section className="card empty" role="alert">
        <h2>تعذّر التحميل</h2>
        <p>أعد المحاولة بعد لحظة.</p>
        <button type="button" className="btn btn-primary" onClick={sel.retry}>
          إعادة المحاولة
        </button>
      </section>
    );
  }
  if (sel.state === 'no-org' || sel.state === 'no-store') {
    return (
      <EmptyState
        title="أضف متجرًا أولًا"
        body="الاستيراد يكون لمتجر محدد، فأضف متجرك من الإعدادات."
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

  const chosen = KINDS.find((k) => k.kind === kind)!;
  return (
    <>
      <form className="card settings-form" onSubmit={runPreview} aria-labelledby="import-title">
        <h2 id="import-title" className="section-title">
          استيراد إلى «{sel.store.name}»
        </h2>
        <fieldset className="settings-fieldset">
          <legend>نوع الملف</legend>
          <div className="kind-grid">
            {KINDS.map((k) => (
              <label key={k.kind} className={`kind-card${kind === k.kind ? ' selected' : ''}`}>
                <input
                  type="radio"
                  name="kind"
                  value={k.kind}
                  checked={kind === k.kind}
                  onChange={() => {
                    setKind(k.kind);
                    reset();
                  }}
                />
                <span className="kind-title">{k.title}</span>
                <span className="kind-body">{k.body}</span>
                <span className="field-hint">يستورده: {k.who}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <p className="field-hint">
          <a href={`/templates/${kind}.csv`} download>
            تنزيل قالب «{chosen.title}»
          </a>{' '}
          · UTF-8 بفواصل، والأرقام بلا فواصل آلاف، والتاريخ ISO 8601. الحد 20 ميغابايت و100 ألف صف.
        </p>
        <div className="field">
          <label htmlFor="import-file">الملف</label>
          <input
            id="import-file"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => void pick(e.target.files?.[0])}
          />
        </div>
        {kind !== 'ad_spend' ? (
          <label className="check">
            <input type="checkbox" checked={naive} onChange={(e) => setNaive(e.target.checked)} />
            <span>
              الأوقات في الملف بلا منطقة زمنية: اعتبرها بتوقيت المتجر (
              <span className="num">{sel.store.timezone}</span>)
            </span>
          </label>
        ) : null}
        {error ? (
          <p className="alert alert-error" role="alert">
            <span aria-hidden="true">✕ </span>
            {error}
          </p>
        ) : null}
        {done ? (
          <p className="alert alert-ok" role="status">
            <span aria-hidden="true">✓ </span>
            {done} <Link href={withSelection('/overview', sel)}>اعرض النظرة العامة</Link>
          </p>
        ) : null}
        <button type="submit" className="btn btn-primary" disabled={!file || busy}>
          {busy && !preview ? 'نقرأ الملف…' : 'معاينة قبل الاعتماد'}
        </button>
      </form>

      {preview ? (
        <PreviewPanel
          preview={preview}
          busy={busy}
          onCommit={() => void commit()}
          onCancel={reset}
        />
      ) : null}

      <section className="section" aria-labelledby="history-title">
        <h2 id="history-title" className="section-title">
          ما اعتُمد لهذا المتجر
        </h2>
        {history === null ? (
          <div className="card skeleton skeleton-card" aria-busy="true" />
        ) : history.length === 0 ? (
          <p className="card settings-note">لم يُعتمد أي ملف لهذا المتجر بعد.</p>
        ) : (
          <div className="table-wrap card">
            <table>
              <thead>
                <tr>
                  <th scope="col">الملف</th>
                  <th scope="col">النوع</th>
                  <th scope="col">جديد</th>
                  <th scope="col">محدّث</th>
                  <th scope="col">مكرر</th>
                  <th scope="col">مرفوض</th>
                  <th scope="col">اعتُمد</th>
                </tr>
              </thead>
              <tbody>
                {history.map((b) => (
                  <tr key={b.id}>
                    <th scope="row">
                      <span className="num">{b.fileName}</span>
                    </th>
                    <td>{KIND_LABEL[b.kind]}</td>
                    <td className="num">{b.counts.create}</td>
                    <td className="num">{b.counts.update}</td>
                    <td className="num">{b.counts.duplicate}</td>
                    <td className="num">{b.counts.rejected}</td>
                    <td>
                      <span className="nowrap">
                        {b.committedAt ? formatDateTime(b.committedAt) : '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function PreviewPanel({
  preview,
  busy,
  onCommit,
  onCancel,
}: {
  preview: Preview;
  busy: boolean;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const c = preview.counts;
  const s = preview.summary;
  const tiles = [
    { label: 'جديد', value: c.create, tone: 'ok', icon: '+' },
    { label: 'محدّث', value: c.update, tone: 'partial', icon: '↻' },
    { label: 'مكرر بلا تغيير', value: c.duplicate, tone: 'missing', icon: '=' },
    { label: 'مرفوض', value: c.rejected, tone: c.rejected ? 'danger' : 'missing', icon: '✕' },
  ];
  const nothingToDo = c.create + c.update === 0;
  return (
    <section className="card settings-form" aria-labelledby="preview-title">
      <h2 id="preview-title" className="section-title">
        المعاينة: <span className="num">{preview.totalRows}</span> صفًا
      </h2>
      <ul className="preview-tiles">
        {tiles.map((t) => (
          <li key={t.label} className={`tile tile-${t.tone}`}>
            <span aria-hidden="true">{t.icon}</span>
            <b className="num">{t.value}</b>
            <span>{t.label}</span>
          </li>
        ))}
      </ul>
      {preview.kind === 'orders' ? (
        <p className="settings-note">
          <span className="num">{String(s.orders)}</span> طلبًا:{' '}
          <span className="num">{String(s.eligibleOrders)}</span> مؤهل، و
          <span className="num">{String(s.excludedOrders)}</span> مستبعد (ملغى أو بانتظار الدفع)، و
          <span className="num">{String(s.needsReviewOrders)}</span> بحالة غير معروفة.
        </p>
      ) : null}
      {s.warnings.map((w) => (
        <p key={w} className="alert" role="status">
          <span aria-hidden="true">ⓘ </span>
          {w}
        </p>
      ))}
      {preview.alreadyImported ? (
        <p className="alert alert-error" role="alert">
          <span aria-hidden="true">✕ </span>
          هذا الملف نفسه اعتُمد من قبل لهذا المتجر، ولن يُعتمد مرتين.
        </p>
      ) : null}
      {preview.rejected.length ? (
        <details open={preview.rejected.length <= 10}>
          <summary>
            الصفوف المرفوضة وأسبابها
            {c.rejected > preview.rejected.length
              ? ` (أول ${preview.rejected.length} من ${c.rejected})`
              : ''}
          </summary>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">السطر</th>
                  <th scope="col">السبب</th>
                </tr>
              </thead>
              <tbody>
                {preview.rejected.map((r) => (
                  <tr key={r.line}>
                    <th scope="row">
                      <span className="num">{r.line}</span>
                    </th>
                    <td>{r.reasons.join(' · ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
      <p className="field-hint">
        الاعتماد يكتب الصفوف الجديدة والمحدّثة فقط. الصفوف المرفوضة لا تُكتب؛ صحّحها وأعد رفعها في
        ملف لاحق.
      </p>
      <div className="actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || preview.alreadyImported || nothingToDo}
          onClick={onCommit}
        >
          {busy ? 'نعتمد…' : 'اعتماد الاستيراد'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          إلغاء
        </button>
      </div>
    </section>
  );
}
