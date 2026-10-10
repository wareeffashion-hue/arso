import { Inject, Injectable } from '@nestjs/common';
import { withTenant } from '@arso/db';
import {
  currencyScale,
  Decimal,
  ORDER_STATUS_MAPPING_VERSION,
  safeRatio,
  type MetricValue,
  type Quality,
} from '@arso/domain';
import { SQL, type Sql } from '../db.js';
import type { Membership, StoreAccess } from '../org/org.service.js';

/**
 * النظرة العامة (القسم 13) من حقائق مستوردة. كل رقم بجودته وتحذيراته ومصدره:
 * الغياب null وليس صفرًا، ولا ربحية على تكاليف ناقصة (AC01)، ولا جمع عملتين.
 * القراءة: نشاط طلبات أُنشئت في الفترة بمنطقة المتجر [start, end) (القسم 32).
 */
export const OVERVIEW_DEFINITION_VERSION = 'overview-1';

export interface OverviewMetric extends MetricValue {
  /** رقم ثانوي موسوم (مثل «على البنود ذات التكلفة فقط»)، لا يحل محل الرقم الأساسي */
  readonly secondary?: { readonly label: string; readonly value: string };
}

const FINANCE_METRICS = [
  'cost_coverage_value',
  'product_margin_after_cogs',
  'contribution_post_marketing',
] as const;

const worst = (...qs: Quality[]): Quality => {
  const order: Quality[] = ['unavailable', 'incomplete', 'limited_sample', 'stale', 'complete'];
  return order.find((q) => qs.includes(q)) ?? 'complete';
};

@Injectable()
export class OverviewService {
  constructor(@Inject(SQL) private readonly sql: Sql) {}

  async overview(m: Membership, store: StoreAccess, days: number) {
    const scale = currencyScale(store.currency);
    const money = (v: string | null) => (v === null ? null : new Decimal(v).toFixed(scale));
    const finance = store.permissions.has('finance.read_summary');

    return withTenant(this.sql, m.organizationId, async (tx) => {
      const [period] = await tx<
        { start_utc: Date; end_utc: Date; start_date: string; end_date: string }[]
      >`
        WITH b AS (
          SELECT date_trunc('day', now() AT TIME ZONE ${store.timezone})
                 - make_interval(days => ${days - 1}) AS s)
        SELECT s AT TIME ZONE ${store.timezone} AS start_utc,
               (s + make_interval(days => ${days})) AT TIME ZONE ${store.timezone} AS end_utc,
               s::date::text AS start_date,
               (s + make_interval(days => ${days}))::date::text AS end_date
        FROM b`;
      const { start_utc: start, end_utc: end, start_date: startDate, end_date: endDate } = period!;

      const [orders] = await tx<
        {
          eligible: string;
          excluded: string;
          needs_review: string;
          any_orders: boolean;
          sales: string | null;
          shipping: string | null;
          shipping_unknown: string;
        }[]
      >`
        SELECT
          count(*) FILTER (WHERE o.eligibility = 'eligible')::text AS eligible,
          count(*) FILTER (WHERE o.eligibility = 'excluded')::text AS excluded,
          count(*) FILTER (WHERE o.eligibility = 'needs_review')::text AS needs_review,
          EXISTS (SELECT 1 FROM orders WHERE store_id = ${store.id}) AS any_orders,
          (SELECT sum(l.product_revenue_ex_tax) FROM order_lines l JOIN orders x ON x.id = l.order_id
            WHERE x.store_id = ${store.id} AND x.eligibility = 'eligible'
              AND x.placed_at >= ${start} AND x.placed_at < ${end})::text AS sales,
          sum(o.shipping_income_ex_tax) FILTER (WHERE o.eligibility = 'eligible')::text AS shipping,
          count(*) FILTER (WHERE o.eligibility = 'eligible' AND o.shipping_income_ex_tax IS NULL)::text
            AS shipping_unknown
        FROM orders o
        WHERE o.store_id = ${store.id} AND o.placed_at >= ${start} AND o.placed_at < ${end}`;

      // تكلفة كل بند: آخر نسخة سارية وقت الطلب (AC05)، بأحدث مراجعة لتاريخ السريان نفسه
      const [cost] = await tx<
        {
          lines: string;
          lines_with_cost: string;
          value_all: string | null;
          value_with_cost: string | null;
          cogs: string | null;
        }[]
      >`
        SELECT count(*)::text AS lines,
               count(c.cost_ex_tax)::text AS lines_with_cost,
               sum(l.product_revenue_ex_tax)::text AS value_all,
               sum(l.product_revenue_ex_tax) FILTER (WHERE c.cost_ex_tax IS NOT NULL)::text
                 AS value_with_cost,
               sum(c.cost_ex_tax * l.quantity)::text AS cogs
        FROM order_lines l
        JOIN orders o ON o.id = l.order_id
        LEFT JOIN LATERAL (
          SELECT cv.cost_ex_tax FROM cost_versions cv
          WHERE cv.store_id = l.store_id AND cv.variant_external_id = l.variant_external_id
            AND cv.valid_from <= o.placed_at
          ORDER BY cv.valid_from DESC, cv.revision DESC LIMIT 1) c ON true
        WHERE o.store_id = ${store.id} AND o.eligibility = 'eligible'
          AND o.placed_at >= ${start} AND o.placed_at < ${end}`;

      // الإنفاق بيومه ومنطقته كما وردا (AC15)، ولا جمع لعملة غير عملة المتجر
      const spendRows = await tx<{ currency: string; spend: string; zones: string[] }[]>`
        SELECT currency, sum(spend)::text AS spend, array_agg(DISTINCT report_timezone) AS zones
        FROM ad_spend_facts
        WHERE store_id = ${store.id} AND report_date >= ${startDate}::date AND report_date < ${endDate}::date
        GROUP BY currency`;
      const [anySpend] = await tx<{ any: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM ad_spend_facts WHERE store_id = ${store.id}) AS any`;

      const daily = await tx<{ day: string; sales: string; orders: string }[]>`
        SELECT (o.placed_at AT TIME ZONE ${store.timezone})::date::text AS day,
               sum(l.product_revenue_ex_tax)::text AS sales,
               count(DISTINCT o.id)::text AS orders
        FROM orders o JOIN order_lines l ON l.order_id = o.id
        WHERE o.store_id = ${store.id} AND o.eligibility = 'eligible'
          AND o.placed_at >= ${start} AND o.placed_at < ${end}
        GROUP BY 1`;
      const dailySpend = await tx<{ day: string; spend: string }[]>`
        SELECT report_date::text AS day, sum(spend)::text AS spend
        FROM ad_spend_facts
        WHERE store_id = ${store.id} AND currency = ${store.currency}
          AND report_date >= ${startDate}::date AND report_date < ${endDate}::date
        GROUP BY 1`;

      const imports = await tx<{ kind: string; last: Date }[]>`
        SELECT kind, max(committed_at) AS last FROM import_batches
        WHERE store_id = ${store.id} AND status = 'completed' GROUP BY kind`;
      const [costCount] = await tx<{ n: string }[]>`
        SELECT count(DISTINCT variant_external_id)::text AS n FROM cost_versions WHERE store_id = ${store.id}`;

      // ===== المقاييس =====
      const base = { currency: store.currency, definitionVersion: OVERVIEW_DEFINITION_VERSION };
      const o = orders!;
      const eligible = new Decimal(o.eligible);
      const review = Number(o.needs_review);
      const salesWarnings = [
        'الاستردادات الجزئية لا تُستورد بعد: الرقم قبل خصمها، والطلبات المسترجعة كليًا مستبعدة',
      ];
      if (review) salesWarnings.push(`${review} طلب بحالة غير معروفة لم يُحتسب حتى يُراجع`);
      const salesQuality: Quality = o.any_orders ? 'incomplete' : 'unavailable';

      const sales: OverviewMetric = {
        ...base,
        key: 'net_product_sales_ex_tax',
        value: o.any_orders ? money(o.sales ?? '0') : null,
        quality: salesQuality,
        warnings: o.any_orders ? salesWarnings : ['لا طلبات مستوردة لهذا المتجر'],
      };
      const orderCount: OverviewMetric = {
        key: 'eligible_order_count',
        definitionVersion: `${OVERVIEW_DEFINITION_VERSION}/${ORDER_STATUS_MAPPING_VERSION}`,
        value: o.any_orders ? eligible.toFixed(0) : null,
        quality: !o.any_orders ? 'unavailable' : review ? 'incomplete' : 'complete',
        warnings: review ? [`${review} طلب بحالة غير معروفة`] : [],
      };
      const aov: OverviewMetric = {
        ...base,
        key: 'aov_products',
        value: money(safeRatio(sales.value, o.any_orders ? o.eligible : null)),
        quality: eligible.isZero() ? 'unavailable' : salesQuality,
        warnings: eligible.isZero() && o.any_orders ? ['لا طلبات مؤهلة في الفترة'] : [],
      };

      const own = spendRows.find((s) => s.currency.trim() === store.currency);
      const foreign = spendRows.filter((s) => s.currency.trim() !== store.currency);
      const zones = [...new Set(spendRows.flatMap((s) => s.zones))].filter(
        (z) => z !== store.timezone,
      );
      const spendWarnings: string[] = [];
      for (const f of foreign)
        spendWarnings.push(
          `إنفاق ${new Decimal(f.spend).toFixed(2)} ${f.currency.trim()} غير محتسب: يحتاج سعر تحويل موثق`,
        );
      if (zones.length)
        spendWarnings.push(`أيام التقرير بمنطقة ${zones.join('، ')}؛ المقارنة اليومية تقريبية`);
      const spend: OverviewMetric = {
        ...base,
        key: 'ad_spend',
        value: anySpend!.any ? money(own?.spend ?? '0') : null,
        quality: !anySpend!.any ? 'unavailable' : foreign.length ? 'incomplete' : 'complete',
        warnings: anySpend!.any ? spendWarnings : ['لا إنفاق مستورد لهذا المتجر'],
      };
      const blendedRaw = safeRatio(sales.value, spend.value);
      const blended: OverviewMetric = {
        key: 'blended_sales_to_ad_spend',
        definitionVersion: OVERVIEW_DEFINITION_VERSION,
        value: blendedRaw === null ? null : new Decimal(blendedRaw).toFixed(2),
        quality: blendedRaw === null ? 'unavailable' : worst(sales.quality, spend.quality),
        warnings: ['وصفي: مبيعات المتجر ÷ الإنفاق، وليس إسنادًا ولا أثرًا إضافيًا'],
      };

      const metrics: Record<string, OverviewMetric> = {
        net_product_sales_ex_tax: sales,
        eligible_order_count: orderCount,
        aov_products: aov,
        ad_spend: spend,
        blended_sales_to_ad_spend: blended,
      };

      if (finance) {
        const c = cost!;
        const lines = Number(c.lines);
        const missing = lines - Number(c.lines_with_cost);
        const ratio =
          c.value_all === null || new Decimal(c.value_all).isZero()
            ? null
            : new Decimal(c.value_with_cost ?? '0').div(c.value_all).toDecimalPlaces(4).toString();
        metrics.cost_coverage_value = {
          key: 'cost_coverage_value',
          definitionVersion: OVERVIEW_DEFINITION_VERSION,
          value: lines === 0 ? null : (ratio ?? '1'),
          quality: lines === 0 ? 'unavailable' : 'complete',
          warnings: missing ? [`${missing} من ${lines} بندًا بلا تكلفة موثقة`] : [],
        };
        const covered =
          c.value_with_cost === null
            ? null
            : new Decimal(c.value_with_cost).minus(c.cogs ?? '0').toFixed(scale);
        metrics.product_margin_after_cogs = {
          ...base,
          key: 'product_margin_after_cogs',
          value:
            lines > 0 && missing === 0 && sales.value !== null
              ? money(new Decimal(sales.value).minus(c.cogs ?? '0').toString())
              : null,
          quality: lines === 0 ? 'unavailable' : missing ? 'incomplete' : salesQuality,
          warnings: [
            ...(missing ? [`تكلفة ${missing} بندًا مفقودة: لا هامش كامل على تكاليف ناقصة`] : []),
            'قبل تكاليف الشحن والدفع والتغليف والإعلان',
          ],
          ...(missing && covered !== null && Number(c.lines_with_cost) > 0
            ? { secondary: { label: 'على البنود ذات التكلفة فقط', value: covered } }
            : {}),
        };
        metrics.contribution_post_marketing = {
          ...base,
          key: 'contribution_post_marketing',
          value: null,
          quality: 'incomplete',
          warnings: ['تحتاج تكاليف الشحن والدفع والتغليف لكل طلب، ولم تُستورد بعد'],
        };
      }

      // سلسلة يومية كاملة بأيام الفترة؛ اليوم بلا بيانات null لا صفر إذا لم تُستورد بيانات أصلًا
      const salesByDay = new Map(daily.map((d) => [d.day, d]));
      const spendByDay = new Map(dailySpend.map((d) => [d.day, d.spend]));
      const series = [];
      for (let i = 0; i < days; i++) {
        const d = new Date(`${startDate}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + i);
        const day = d.toISOString().slice(0, 10);
        const s = salesByDay.get(day);
        series.push({
          date: day,
          netSales: o.any_orders ? money(s?.sales ?? '0') : null,
          orders: o.any_orders ? Number(s?.orders ?? 0) : null,
          spend: anySpend!.any ? money(spendByDay.get(day) ?? '0') : null,
        });
      }

      const last = (k: string) => imports.find((i) => i.kind === k)?.last.toISOString() ?? null;
      return {
        store: {
          id: store.id,
          name: store.name,
          currency: store.currency,
          timezone: store.timezone,
        },
        period: { days, start: start.toISOString(), end: end.toISOString(), startDate, endDate },
        dataStatus: {
          orders: { lastImportAt: last('orders'), present: o.any_orders },
          costs: { lastImportAt: last('costs'), variants: Number(costCount!.n) },
          adSpend: { lastImportAt: last('ad_spend'), present: anySpend!.any },
          ordersInPeriod: {
            eligible: Number(o.eligible),
            excluded: Number(o.excluded),
            needsReview: review,
          },
        },
        metrics,
        restricted: finance ? [] : [...FINANCE_METRICS],
        series,
      };
    });
  }
}
