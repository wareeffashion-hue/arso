'use client';

import { Decimal, type Quality } from '@arso/domain';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { DailyBars } from '@/components/DailyBars';
import { EmptyState } from '@/components/EmptyState';
import { KpiCard } from '@/components/KpiCard';
import { TopOpportunities } from '@/components/TopOpportunities';
import { api } from '@/lib/api';
import { formatDecimal } from '@/lib/format';
import { formatDateTime } from '@/lib/labels';
import { useSelection, withSelection, type Selection } from '@/lib/store-context';

interface Metric {
  key: string;
  value: string | null;
  quality: Quality;
  warnings: string[];
  secondary?: { label: string; value: string };
}
interface OverviewData {
  store: { id: string };
  period: { days: number; startDate: string; endDate: string };
  dataStatus: {
    orders: { lastImportAt: string | null; present: boolean };
    costs: { lastImportAt: string | null; variants: number };
    adSpend: { lastImportAt: string | null; present: boolean };
    ordersInPeriod: { eligible: number; excluded: number; needsReview: number };
  };
  metrics: Record<string, Metric | undefined>;
  restricted: string[];
  series: { date: string; netSales: string | null; orders: number | null; spend: string | null }[];
}

type Load =
  { key: string; state: 'loading' | 'error' } | { key: string; state: 'ready'; data: OverviewData };

function note(m: Metric | undefined): string | undefined {
  if (!m) return undefined;
  const parts = [...m.warnings];
  if (m.secondary) {
    parts.unshift(`${m.secondary.label}: ${formatDecimal(m.secondary.value, 2)} ريال`);
  }
  return parts.join(' · ') || undefined;
}

function Card({
  m,
  label,
  money,
  digits,
  percent,
}: {
  m: Metric | undefined;
  label: string;
  money?: boolean;
  digits?: number;
  percent?: boolean;
}) {
  const raw = m?.value ?? null;
  const value = percent && raw !== null ? new Decimal(raw).times(100).toFixed(1) : raw;
  return (
    <KpiCard
      label={label}
      value={value}
      suffix={percent ? '٪' : undefined}
      quality={m?.quality ?? 'unavailable'}
      money={money}
      fractionDigits={digits}
      note={note(m)}
    />
  );
}

export function Overview() {
  const sel = useSelection();
  const key = sel.state === 'ready' ? `${sel.store.id}:${sel.days}` : '';
  const [load, setLoad] = useState<Load>({ key: '', state: 'loading' });

  useEffect(() => {
    if (sel.state !== 'ready') return;
    let live = true;
    const k = `${sel.store.id}:${sel.days}`;
    setLoad({ key: k, state: 'loading' });
    api<OverviewData>(
      `/api/v1/organizations/${sel.org.id}/stores/${sel.store.id}/overview?days=${sel.days}`,
    )
      .then((data) => live && setLoad({ key: k, state: 'ready', data }))
      .catch(() => live && setLoad({ key: k, state: 'error' }));
    return () => {
      live = false;
    };
  }, [sel]);

  return (
    <>
      <div className="page-head">
        <h1>نظرة عامة</h1>
        <p className="lead">صورة متجرك الحقيقية: ما تبيعه، وما تنفقه، وما يبقى لك.</p>
      </div>
      <Body sel={sel} load={load.key === key ? load : { key, state: 'loading' }} />
    </>
  );
}

function Body({ sel, load }: { sel: Selection; load: Load }) {
  if (sel.state === 'loading' || (sel.state === 'ready' && load.state === 'loading')) {
    return (
      <div aria-busy="true" aria-label="جارٍ التحميل">
        <div className="kpi-grid">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="card skeleton skeleton-card" />
          ))}
        </div>
      </div>
    );
  }
  if (sel.state === 'error' || load.state === 'error') {
    return (
      <section className="card empty" role="alert">
        <h2>تعذّر تحميل النظرة العامة</h2>
        <p>بياناتك محفوظة. أعد المحاولة بعد لحظة.</p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => (sel.state === 'error' ? sel.retry() : location.reload())}
        >
          إعادة المحاولة
        </button>
      </section>
    );
  }
  if (sel.state === 'no-org') {
    return (
      <EmptyState
        title="أنشئ مؤسستك أولًا"
        body="المؤسسة تجمع متاجرك وفريقك."
        action={
          <Link className="btn btn-primary" href="/onboarding">
            إنشاء مؤسسة
          </Link>
        }
      />
    );
  }
  if (sel.state === 'no-store') {
    return (
      <EmptyState
        title="أضف متجرك الأول"
        body="أضف المتجر من الإعدادات، ثم استورد طلباته وتكاليفه وإنفاقه الإعلاني."
        action={
          <Link className="btn btn-primary" href="/settings">
            إضافة متجر
          </Link>
        }
      />
    );
  }
  if (load.state !== 'ready') return null;

  const d = load.data;
  const m = d.metrics;
  const nothing = !d.dataStatus.orders.present && !d.dataStatus.adSpend.present;
  const importsHref = withSelection('/imports', sel);

  return (
    <>
      <DataStrip data={d} importsHref={importsHref} />

      {nothing ? (
        <EmptyState
          title="استورد طلباتك لترى أول قراءة حقيقية"
          body="ارفع ملف الطلبات، ثم التكاليف والإنفاق الإعلاني. لن نعرض أي رقم قبل أن يكون له مصدر."
          action={
            <Link className="btn btn-primary" href={importsHref}>
              استيراد البيانات
            </Link>
          }
        />
      ) : null}

      <section aria-labelledby="kpis-title" className="section">
        <h2 id="kpis-title" className="section-title">
          المؤشرات الأساسية
        </h2>
        <div className="kpi-grid">
          <Card m={m.net_product_sales_ex_tax} label="صافي مبيعات المنتجات" money />
          <Card m={m.eligible_order_count} label="طلبات مؤهلة" />
          <Card m={m.aov_products} label="متوسط قيمة الطلب" money />
          <Card m={m.ad_spend} label="الإنفاق الإعلاني" money />
          <Card m={m.blended_sales_to_ad_spend} label="المبيعات ÷ الإنفاق" digits={2} />
          {d.restricted.length === 0 ? (
            <>
              <Card m={m.product_margin_after_cogs} label="الهامش بعد تكلفة البضاعة" money />
              <Card m={m.cost_coverage_value} label="تغطية التكاليف" digits={1} percent />
              <Card m={m.contribution_post_marketing} label="المساهمة بعد التسويق" money />
            </>
          ) : null}
        </div>
        {d.restricted.length ? (
          <p className="field-hint">
            <span aria-hidden="true">🔒 </span>
            الأرقام المالية (التكاليف والهامش والمساهمة) غير متاحة لدورك. اطلبها من مالك المؤسسة.
          </p>
        ) : null}
      </section>

      <section aria-labelledby="trend-title" className="section">
        <h2 id="trend-title" className="section-title">
          يومًا بيوم
        </h2>
        <div className="chart-grid">
          <DailyBars
            title="صافي مبيعات المنتجات"
            unit="ريال"
            series={1}
            money
            points={d.series.map((s) => ({ date: s.date, value: s.netSales }))}
          />
          <DailyBars
            title="الإنفاق الإعلاني"
            unit="ريال"
            series={2}
            money
            points={d.series.map((s) => ({ date: s.date, value: s.spend }))}
          />
        </div>
        <p className="field-hint">
          كل مقياس في رسم مستقل بمحوره. أيام المبيعات بمنطقة المتجر، وأيام الإنفاق كما وردت من حساب
          الإعلان.
        </p>
      </section>
      <TopOpportunities
        base={`/api/v1/organizations/${sel.org.id}/stores/${sel.store.id}/problems`}
        href={withSelection('/opportunities', sel)}
      />
    </>
  );
}

function DataStrip({ data, importsHref }: { data: OverviewData; importsHref: string }) {
  const s = data.dataStatus;
  const item = (label: string, ok: boolean, at: string | null, extra?: string) => (
    <li className={ok ? 'ok' : 'missing'}>
      <span aria-hidden="true">{ok ? '✓' : '○'}</span>
      <span>
        <b>{label}</b> {ok ? `آخر استيراد ${at ? formatDateTime(at) : '—'}` : 'لم يُستورد'}
        {extra ? ` · ${extra}` : ''}
      </span>
    </li>
  );
  return (
    <section className="card data-strip" aria-label="حالة البيانات">
      <ul>
        {item('الطلبات', s.orders.present, s.orders.lastImportAt)}
        {item(
          'التكاليف',
          s.costs.variants > 0,
          s.costs.lastImportAt,
          s.costs.variants ? `${s.costs.variants} متغيرًا` : undefined,
        )}
        {item('الإنفاق الإعلاني', s.adSpend.present, s.adSpend.lastImportAt)}
      </ul>
      {s.ordersInPeriod.needsReview ? (
        <p className="alert" role="status">
          <span aria-hidden="true">ⓘ </span>
          {s.ordersInPeriod.needsReview} طلب بحالة غير معروفة لم يُحتسب. حالته تحتاج مراجعة قبل
          اعتبارها مبيعات.
        </p>
      ) : null}
      <Link className="btn btn-ghost" href={importsHref}>
        استيراد بيانات
      </Link>
    </section>
  );
}
