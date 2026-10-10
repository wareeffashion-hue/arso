import { Inject, Injectable, Logger } from '@nestjs/common';
import { withTenant, type TransactionSql } from '@arso/db';
import {
  canTransition,
  CLOSED,
  Decimal,
  percentOf,
  Q02_STALE_DAYS,
  Q03_MIN_DROP_POINTS,
  Q03_MIN_ORDERS,
  q01Impact,
  q03Impact,
  REASON_REQUIRED,
  ruleById,
  RULES,
  RULES_VERSION,
  totalScore,
  type DecimalValue,
  type ProblemKind,
  type ProblemStatus,
  type Score,
} from '@arso/domain';
import { SQL, type Sql } from '../db.js';
import { ApiError } from '../errors.js';
import type { Membership, StoreAccess } from '../org/org.service.js';

/** إعادة الفحص عند القراءة إن مضى على آخر فحص أكثر من هذا */
const STALE_MS = 60 * 60 * 1000;

interface Hypothesis {
  text: string;
  /** إشارة الأرقام: تتسق مع الفرضية، أو لا تشير إليها. لا «مثبتة» أبدًا */
  signal: 'consistent' | 'not_indicated' | 'unknown';
}

interface Finding {
  ruleId: string;
  entity: string;
  window: string;
  kind: ProblemKind;
  score: Score;
  quality: 'complete' | 'limited_sample';
  title: string;
  observation: { text: string; values: Record<string, string | number | null> };
  evidence: { label: string; value: string; detail?: string }[];
  hypotheses: Hypothesis[];
  checks: string[];
  action: string;
  periodStart: Date | null;
  periodEnd: Date | null;
}

interface ProblemRow {
  id: string;
  rule_id: string;
  rule_version: string;
  kind: ProblemKind;
  status: ProblemStatus;
  score_impact: number;
  score_evidence: number;
  score_fit: number;
  score_feasibility: number;
  quality: string;
  title: string;
  observation: Finding['observation'];
  evidence: Finding['evidence'];
  hypotheses: Hypothesis[];
  checks: string[];
  action: string;
  period_start: Date | null;
  period_end: Date | null;
  owner_membership_id: string | null;
  due_on: string | null;
  status_reason: string | null;
  first_seen_at: Date;
  last_seen_at: Date;
  condition_cleared_at: Date | null;
  revision: number;
}

const fmtMoney = (v: string) => new Decimal(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

@Injectable()
export class ProblemsService {
  private readonly logger = new Logger('ProblemsService');
  constructor(@Inject(SQL) private readonly sql: Sql) {}

  // ===== الفحص =====

  private async period(tx: TransactionSql, store: StoreAccess, days: number, offsetDays = 0) {
    const [p] = await tx<{ start: Date; end: Date; start_date: string; end_date: string }[]>`
      WITH b AS (
        SELECT date_trunc('day', now() AT TIME ZONE ${store.timezone})
               - make_interval(days => ${days - 1 + offsetDays}) AS s)
      SELECT s AT TIME ZONE ${store.timezone} AS start,
             (s + make_interval(days => ${days})) AT TIME ZONE ${store.timezone} AS end,
             s::date::text AS start_date,
             (s + make_interval(days => ${days}))::date::text AS end_date
      FROM b`;
    return p!;
  }

  private async q01(tx: TransactionSql, store: StoreAccess): Promise<Finding | null> {
    const p = await this.period(tx, store, 30);
    const variants = await tx<{ variant: string; lines: number; value: string }[]>`
      SELECT l.variant_external_id AS variant, count(*)::int AS lines,
             sum(l.product_revenue_ex_tax)::text AS value
      FROM order_lines l JOIN orders o ON o.id = l.order_id
      WHERE o.store_id = ${store.id} AND o.eligibility = 'eligible'
        AND o.placed_at >= ${p.start} AND o.placed_at < ${p.end}
        AND NOT EXISTS (
          SELECT 1 FROM cost_versions cv
          WHERE cv.store_id = l.store_id AND cv.variant_external_id = l.variant_external_id
            AND cv.valid_from <= o.placed_at)
      GROUP BY 1 ORDER BY sum(l.product_revenue_ex_tax) DESC`;
    if (!variants.length) return null;
    const [all] = await tx<{ value: string | null }[]>`
      SELECT sum(l.product_revenue_ex_tax)::text AS value
      FROM order_lines l JOIN orders o ON o.id = l.order_id
      WHERE o.store_id = ${store.id} AND o.eligibility = 'eligible'
        AND o.placed_at >= ${p.start} AND o.placed_at < ${p.end}`;
    const uncovered = variants.reduce((s, v) => s.plus(v.value), new Decimal(0)).toFixed(2);
    const lines = variants.reduce((s, v) => s + v.lines, 0);
    const share = percentOf(uncovered, all!.value ?? '0') ?? '0';
    return {
      ruleId: 'Q01',
      entity: 'store',
      window: 'rolling_30d',
      kind: 'quality',
      score: { impact: q01Impact(share), evidence: 3, fit: 2, feasibility: 2 },
      quality: 'complete',
      title:
        variants.length === 1
          ? 'متغير واحد مبيع بلا تكلفة موثقة'
          : `${variants.length} متغيرات مبيعة بلا تكلفة موثقة`,
      observation: {
        text: `مبيعات ${fmtMoney(uncovered)} ريال (${share}٪ من مبيعات آخر 30 يومًا) في ${lines} بندًا لمتغيرات بلا تكلفة سارية وقت الطلب. لذلك لا يُحسب هامش كامل.`,
        values: {
          uncoveredValue: uncovered,
          sharePercent: share,
          lines,
          variants: variants.length,
        },
      },
      evidence: variants.slice(0, 8).map((v) => ({
        label: v.variant,
        value: `${fmtMoney(v.value)} ريال`,
        detail: `${v.lines} بندًا`,
      })),
      hypotheses: [
        { text: 'متغيرات جديدة لم تُضف تكلفتها بعد', signal: 'unknown' },
        { text: 'معرّف المتغير في ملف التكاليف يختلف عنه في ملف الطلبات', signal: 'unknown' },
        { text: 'تاريخ سريان التكلفة بعد تاريخ الطلبات', signal: 'unknown' },
      ],
      checks: [
        'طابق معرّفات المتغيرات أعلاه مع ملف التكاليف',
        'تأكد أن تاريخ السريان يسبق أقدم طلب لكل متغير',
        'الهدية أو المجاني يحتاج تكلفة صفر مؤكدة، لا خانة فارغة',
      ],
      action: 'أكمل تكاليف هذه المتغيرات من صفحة الاستيراد',
      periodStart: p.start,
      periodEnd: p.end,
    };
  }

  private async q02(tx: TransactionSql, store: StoreAccess): Promise<Finding | null> {
    const [r] = await tx<{ last: Date | null; days: number | null }[]>`
      SELECT max(committed_at) AS last,
             extract(day FROM now() - max(committed_at))::int AS days
      FROM import_batches WHERE store_id = ${store.id} AND kind = 'orders' AND status = 'completed'`;
    if (!r?.last || (r.days ?? 0) < Q02_STALE_DAYS) return null;
    const days = r.days!;
    return {
      ruleId: 'Q02',
      entity: 'orders_source',
      window: 'freshness',
      kind: 'quality',
      score: { impact: days >= 14 ? 3 : 2, evidence: 3, fit: 1, feasibility: 2 },
      quality: 'complete',
      title: 'بيانات الطلبات لم تُحدَّث منذ مدة',
      observation: {
        text: `آخر استيراد لملف الطلبات قبل ${days} يومًا. الأرقام لا تشمل ما بعده.`,
        values: { daysSinceLastImport: days, lastImportAt: r.last.toISOString() },
      },
      evidence: [{ label: 'آخر استيراد', value: r.last.toISOString().slice(0, 10) }],
      hypotheses: [],
      checks: ['تأكد أن الملف الجديد يشمل الطلبات منذ آخر استيراد'],
      action: 'ارفع ملف طلبات محدّثًا، أو اربط سلة للمزامنة التلقائية عند توفرها',
      periodStart: null,
      periodEnd: null,
    };
  }

  private async dq01(tx: TransactionSql, store: StoreAccess): Promise<Finding | null> {
    const p = await this.period(tx, store, 30);
    const rows = await tx<{ status: string; n: number }[]>`
      SELECT source_status AS status, count(*)::int AS n FROM orders
      WHERE store_id = ${store.id} AND eligibility = 'needs_review'
        AND placed_at >= ${p.start} AND placed_at < ${p.end}
      GROUP BY 1 ORDER BY 2 DESC`;
    if (!rows.length) return null;
    const [t] = await tx<{ n: number }[]>`
      SELECT count(*)::int AS n FROM orders
      WHERE store_id = ${store.id} AND placed_at >= ${p.start} AND placed_at < ${p.end}`;
    const n = rows.reduce((s, r) => s + r.n, 0);
    const share = percentOf(String(n), String(t!.n)) ?? '0';
    const impact = new Decimal(share).gte(10) ? 3 : new Decimal(share).gte(3) ? 2 : 1;
    return {
      ruleId: 'DQ01',
      entity: 'store',
      window: 'rolling_30d',
      kind: 'quality',
      score: { impact, evidence: 3, fit: 1, feasibility: 1 },
      quality: 'complete',
      title: `${n} طلب بحالة غير معروفة خارج المبيعات`,
      observation: {
        text: `${n} طلب (${share}٪ من طلبات آخر 30 يومًا) بحالات لا تعرفها خريطة الحالات، فلم تُحتسب مبيعات ولا مستبعدة.`,
        values: { orders: n, sharePercent: share },
      },
      evidence: rows.map((r) => ({ label: r.status, value: `${r.n} طلب` })),
      hypotheses: [
        { text: 'حالة مخصصة في المتجر لا تقابلها حالة قياسية', signal: 'unknown' },
        { text: 'تهجئة مختلفة لحالة معروفة', signal: 'unknown' },
      ],
      checks: ['حدد لكل حالة: هل الطلب مدفوع ومنفّذ، أم ملغى؟'],
      action: 'صحّح الحالة في الملف إلى حالة معروفة، أو أبلغ فريق أرسو لإضافتها إلى خريطة الحالات',
      periodStart: p.start,
      periodEnd: p.end,
    };
  }

  private async dq02(tx: TransactionSql, store: StoreAccess): Promise<Finding | null> {
    const p = await this.period(tx, store, 30);
    const rows = await tx<{ currency: string; spend: string }[]>`
      SELECT currency, sum(spend)::text AS spend FROM ad_spend_facts
      WHERE store_id = ${store.id} AND currency <> ${store.currency}
        AND report_date >= ${p.start_date}::date AND report_date < ${p.end_date}::date
      GROUP BY 1 ORDER BY 1`;
    if (!rows.length) return null;
    return {
      ruleId: 'DQ02',
      entity: 'store',
      window: 'rolling_30d',
      kind: 'quality',
      score: { impact: 2, evidence: 3, fit: 1, feasibility: 1 },
      quality: 'complete',
      title: 'إنفاق إعلاني بعملة أخرى خارج الإجمالي',
      observation: {
        text: `إنفاق ${rows.map((r) => `${fmtMoney(r.spend)} ${r.currency.trim()}`).join(' و')} في آخر 30 يومًا لم يدخل إجمالي الإنفاق بـ${store.currency}، لأنه لا يوجد سعر تحويل موثق.`,
        values: Object.fromEntries(rows.map((r) => [r.currency.trim(), r.spend])),
      },
      evidence: rows.map((r) => ({ label: r.currency.trim(), value: fmtMoney(r.spend) })),
      hypotheses: [],
      checks: ['هل تتيح منصة الإعلان تصدير التقرير بعملة المتجر؟'],
      action: 'صدّر التقرير بعملة المتجر إن أمكن؛ وإلا يبقى الإنفاق ناقصًا حتى يتوفر تحويل موثق',
      periodStart: p.start,
      periodEnd: p.end,
    };
  }

  private async marginStats(tx: TransactionSql, store: StoreAccess, start: Date, end: Date) {
    const [r] = await tx<
      {
        orders: number;
        lines: number;
        with_cost: number;
        units: string | null;
        sales: string | null;
        cogs: string | null;
      }[]
    >`
      SELECT count(DISTINCT o.id)::int AS orders, count(*)::int AS lines,
             count(c.cost_ex_tax)::int AS with_cost, sum(l.quantity)::text AS units,
             sum(l.product_revenue_ex_tax)::text AS sales,
             sum(c.cost_ex_tax * l.quantity)::text AS cogs
      FROM order_lines l JOIN orders o ON o.id = l.order_id
      LEFT JOIN LATERAL (
        SELECT cv.cost_ex_tax FROM cost_versions cv
        WHERE cv.store_id = l.store_id AND cv.variant_external_id = l.variant_external_id
          AND cv.valid_from <= o.placed_at
        ORDER BY cv.valid_from DESC, cv.revision DESC LIMIT 1) c ON true
      WHERE o.store_id = ${store.id} AND o.eligibility = 'eligible'
        AND o.placed_at >= ${start} AND o.placed_at < ${end}`;
    return r!;
  }

  private async q03(tx: TransactionSql, store: StoreAccess): Promise<Finding | null> {
    const cur = await this.period(tx, store, 30);
    const prev = await this.period(tx, store, 30, 30);
    const a = await this.marginStats(tx, store, prev.start, prev.end);
    const b = await this.marginStats(tx, store, cur.start, cur.end);
    const complete = (s: typeof a) => s.lines > 0 && s.with_cost === s.lines && s.sales !== null;
    if (!complete(a) || !complete(b)) return null;
    const rate = (s: typeof a) =>
      new Decimal(s.sales!).isZero()
        ? null
        : new Decimal(s.sales!)
            .minus(s.cogs ?? '0')
            .div(s.sales!)
            .times(100);
    const ra = rate(a);
    const rb = rate(b);
    if (!ra || !rb) return null;
    const drop = ra.minus(rb);
    if (drop.lt(Q03_MIN_DROP_POINTS)) return null;

    const perUnit = (v: string | null, units: string | null) =>
      v && units && !new Decimal(units).isZero() ? new Decimal(v).div(units) : null;
    const pa = perUnit(a.sales, a.units);
    const pb = perUnit(b.sales, b.units);
    const ca = perUnit(a.cogs, a.units);
    const cb = perUnit(b.cogs, b.units);
    const change = (x: DecimalValue | null, y: DecimalValue | null) =>
      x && y && !x.isZero() ? y.minus(x).div(x).times(100) : null;
    const priceChange = change(pa, pb);
    const costChange = change(ca, cb);

    // المتغيرات الأكثر مساهمة في نقص الهامش بالريال بين الفترتين
    const movers = await tx<{ variant: string; prev: string; cur: string }[]>`
      WITH x AS (
        SELECT l.variant_external_id AS variant,
               (o.placed_at >= ${cur.start}) AS is_cur,
               l.product_revenue_ex_tax - c.cost_ex_tax * l.quantity AS margin
        FROM order_lines l JOIN orders o ON o.id = l.order_id
        JOIN LATERAL (
          SELECT cv.cost_ex_tax FROM cost_versions cv
          WHERE cv.store_id = l.store_id AND cv.variant_external_id = l.variant_external_id
            AND cv.valid_from <= o.placed_at
          ORDER BY cv.valid_from DESC, cv.revision DESC LIMIT 1) c ON true
        WHERE o.store_id = ${store.id} AND o.eligibility = 'eligible'
          AND o.placed_at >= ${prev.start} AND o.placed_at < ${cur.end})
      SELECT variant,
             coalesce(sum(margin) FILTER (WHERE NOT is_cur), 0)::text AS prev,
             coalesce(sum(margin) FILTER (WHERE is_cur), 0)::text AS cur
      FROM x GROUP BY 1
      ORDER BY coalesce(sum(margin) FILTER (WHERE is_cur), 0)
             - coalesce(sum(margin) FILTER (WHERE NOT is_cur), 0)
      LIMIT 3`;

    const limited = a.orders < Q03_MIN_ORDERS || b.orders < Q03_MIN_ORDERS;
    const sig = (c: DecimalValue | null, threshold: number, up: boolean): Hypothesis['signal'] =>
      c === null
        ? 'unknown'
        : (up ? c.gte(threshold) : c.lte(-threshold))
          ? 'consistent'
          : 'not_indicated';
    const pct = (c: DecimalValue | null) =>
      c === null ? '—' : `${c.gte(0) ? '+' : ''}${c.toFixed(1)}٪`;
    // مقارنة مثل بمثل: المتغيرات المبيعة في الفترتين فقط، بأوزان كميات الفترة الحالية.
    // هكذا لا يُقرأ تغير المزيج كأنه تغير سعر أو تكلفة مورد.
    const perVariant = await tx<
      { variant: string; is_cur: boolean; units: string; sales: string; cogs: string }[]
    >`
      SELECT l.variant_external_id AS variant, (o.placed_at >= ${cur.start}) AS is_cur,
             sum(l.quantity)::text AS units, sum(l.product_revenue_ex_tax)::text AS sales,
             sum(c.cost_ex_tax * l.quantity)::text AS cogs
      FROM order_lines l JOIN orders o ON o.id = l.order_id
      JOIN LATERAL (
        SELECT cv.cost_ex_tax FROM cost_versions cv
        WHERE cv.store_id = l.store_id AND cv.variant_external_id = l.variant_external_id
          AND cv.valid_from <= o.placed_at
        ORDER BY cv.valid_from DESC, cv.revision DESC LIMIT 1) c ON true
      WHERE o.store_id = ${store.id} AND o.eligibility = 'eligible'
        AND o.placed_at >= ${prev.start} AND o.placed_at < ${cur.end}
      GROUP BY 1, 2`;
    const prevBy = new Map(perVariant.filter((v) => !v.is_cur).map((v) => [v.variant, v]));
    let base = { price: new Decimal(0), cost: new Decimal(0) };
    let delta = { price: new Decimal(0), cost: new Decimal(0) };
    let newOrGone = false;
    for (const v of perVariant.filter((x) => x.is_cur)) {
      const pv = prevBy.get(v.variant);
      if (!pv) {
        newOrGone = true;
        continue;
      }
      const u = new Decimal(v.units);
      const pPrev = new Decimal(pv.sales).div(pv.units);
      const cPrev = new Decimal(pv.cogs).div(pv.units);
      base = { price: base.price.plus(pPrev.times(u)), cost: base.cost.plus(cPrev.times(u)) };
      delta = {
        price: delta.price.plus(new Decimal(v.sales).minus(pPrev.times(u))),
        cost: delta.cost.plus(new Decimal(v.cogs).minus(cPrev.times(u))),
      };
    }
    if (prevBy.size > perVariant.filter((x) => x.is_cur).length) newOrGone = true;
    const lflPrice = base.price.isZero() ? null : delta.price.div(base.price).times(100);
    const lflCost = base.cost.isZero() ? null : delta.cost.div(base.cost).times(100);
    const priceSignal = sig(lflPrice, 2, false);
    const costSignal = sig(lflCost, 2, true);
    const mixSignal: Hypothesis['signal'] =
      priceSignal !== 'consistent' && costSignal !== 'consistent'
        ? 'consistent'
        : newOrGone
          ? 'unknown'
          : 'not_indicated';

    return {
      ruleId: 'Q03',
      entity: 'store',
      window: 'rolling_30d_vs_prev_30d',
      kind: 'contribution',
      score: {
        impact: q03Impact(drop.toFixed(1)),
        evidence: limited ? 1 : 2,
        fit: 2,
        feasibility: 1,
      },
      quality: limited ? 'limited_sample' : 'complete',
      title: `هامش المنتجات تراجع ${drop.toFixed(1)} نقطة`,
      observation: {
        text: `هامش المنتجات بعد تكلفة البضاعة ${rb.toFixed(1)}٪ في آخر 30 يومًا مقابل ${ra.toFixed(1)}٪ في الثلاثين السابقة (−${drop.toFixed(1)} نقطة)، على ${b.orders} و${a.orders} طلبًا مؤهلًا${limited ? '. العينة أقل من 30 طلبًا في إحدى الفترتين: قراءة محدودة' : ''}.`,
        values: {
          currentRate: rb.toFixed(1),
          previousRate: ra.toFixed(1),
          dropPoints: drop.toFixed(1),
          currentOrders: b.orders,
          previousOrders: a.orders,
        },
      },
      evidence: [
        {
          label: 'متوسط سعر الوحدة',
          value: pct(priceChange),
          detail: `${pa ? fmtMoney(pa.toString()) : '—'} ← ${pb ? fmtMoney(pb.toString()) : '—'} ريال`,
        },
        {
          label: 'متوسط تكلفة الوحدة',
          value: pct(costChange),
          detail: `${ca ? fmtMoney(ca.toString()) : '—'} ← ${cb ? fmtMoney(cb.toString()) : '—'} ريال`,
        },
        {
          label: 'سعر الوحدة مثلًا بمثل',
          value: pct(lflPrice),
          detail: 'نفس المتغيرات في الفترتين، بكميات الفترة الحالية',
        },
        {
          label: 'تكلفة الوحدة مثلًا بمثل',
          value: pct(lflCost),
          detail: 'تغير تكلفة المورد لنفس المتغيرات',
        },
        ...movers
          .filter((m) => new Decimal(m.cur).lt(m.prev))
          .map((m) => ({
            label: m.variant,
            value: `${fmtMoney(new Decimal(m.cur).minus(m.prev).toString())} ريال`,
            detail: 'تغير هامش المتغير بين الفترتين',
          })),
      ],
      hypotheses: [
        { text: 'خصومات أكبر أو سعر بيع أقل', signal: priceSignal },
        { text: 'ارتفاع تكلفة المورد', signal: costSignal },
        {
          text: 'تحوّل المبيعات إلى منتجات أقل هامشًا',
          signal: mixSignal,
        },
      ],
      checks: [
        'راجع الكوبونات والعروض النشطة في الفترة',
        'راجع آخر تحديث لتكاليف المورد',
        'قارن مزيج المنتجات المباعة بين الفترتين',
      ],
      action: 'حدد السبب من الفحوص أعلاه قبل تغيير الأسعار أو الإنفاق',
      periodStart: prev.start,
      periodEnd: cur.end,
    };
  }

  /** يشغّل القواعد ويحدّث البطاقات دون تكرار. لا يغيّر حالة بطاقة قائمة */
  async evaluate(m: Membership, store: StoreAccess) {
    return withTenant(this.sql, m.organizationId, async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${'problems:' + store.id}))`;
      const findings = (
        await Promise.all([
          this.q01(tx, store),
          this.q02(tx, store),
          this.q03(tx, store),
          this.dq01(tx, store),
          this.dq02(tx, store),
        ])
      ).filter((f): f is Finding => f !== null);

      const signatures = new Set<string>();
      for (const f of findings) {
        const rule = ruleById(f.ruleId)!;
        const signature = `${store.id}/${f.ruleId}/${rule.version}/${f.entity}/${f.window}`;
        signatures.add(signature);
        const fields = {
          kind: f.kind,
          score_impact: f.score.impact,
          score_evidence: f.score.evidence,
          score_fit: f.score.fit,
          score_feasibility: f.score.feasibility,
          quality: f.quality,
          title: f.title,
          observation: tx.json(f.observation as never),
          evidence: tx.json(f.evidence as never),
          hypotheses: tx.json(f.hypotheses as never),
          checks: tx.json(f.checks as never),
          action: f.action,
          period_start: f.periodStart,
          period_end: f.periodEnd,
        };
        const [open] = await tx<{ id: string; observation: Finding['observation'] }[]>`
          SELECT id, observation FROM problems
          WHERE store_id = ${store.id} AND signature = ${signature}
            AND status NOT IN ('resolved', 'rejected')`;
        if (!open) {
          // رفضٌ بسبب قرار بشري: لا نعيد فتح نفس التوقيع ما دام الشرط نفسه قائمًا
          const [last] = await tx<{ status: string }[]>`
            SELECT status FROM problems WHERE store_id = ${store.id} AND signature = ${signature}
            ORDER BY first_seen_at DESC LIMIT 1`;
          if (last?.status === 'rejected') continue;
          const [p] = await tx<{ id: string }[]>`
            INSERT INTO problems ${tx({
              organization_id: m.organizationId,
              store_id: store.id,
              rule_id: f.ruleId,
              rule_version: rule.version,
              signature,
              ...fields,
            })} RETURNING id`;
          await tx`INSERT INTO problem_events (organization_id, problem_id, kind)
                   VALUES (${m.organizationId}, ${p!.id}, 'created')`;
          continue;
        }
        const changed = open.observation.text !== f.observation.text;
        await tx`
          UPDATE problems SET ${tx(fields)}, last_seen_at = now(), condition_cleared_at = NULL,
            revision = revision + ${changed ? 1 : 0}
          WHERE id = ${open.id}`;
        if (changed) {
          await tx`INSERT INTO problem_events (organization_id, problem_id, kind)
                   VALUES (${m.organizationId}, ${open.id}, 'refreshed')`;
        }
      }

      // الشرط زال: نوسم البطاقة ولا نغيّر حالتها (تغيير الحالة قرار بشري)
      const stale = await tx<{ id: string; signature: string }[]>`
        SELECT id, signature FROM problems
        WHERE store_id = ${store.id} AND status NOT IN ('resolved', 'rejected')
          AND condition_cleared_at IS NULL`;
      for (const s of stale.filter((x) => !signatures.has(x.signature))) {
        await tx`UPDATE problems SET condition_cleared_at = now() WHERE id = ${s.id}`;
        await tx`INSERT INTO problem_events (organization_id, problem_id, kind)
                 VALUES (${m.organizationId}, ${s.id}, 'cleared')`;
      }
      await tx`
        INSERT INTO problem_evaluations (organization_id, store_id, rules_version, evaluated_at)
        VALUES (${m.organizationId}, ${store.id}, ${RULES_VERSION}, now())
        ON CONFLICT (organization_id, store_id)
        DO UPDATE SET rules_version = EXCLUDED.rules_version, evaluated_at = now()`;
      return { evaluated: RULES.filter((r) => r.runnable).length, findings: findings.length };
    });
  }

  /** فحص بعد الاستيراد؛ فشله لا يُفشل الاستيراد */
  async evaluateQuietly(m: Membership, store: StoreAccess) {
    try {
      await this.evaluate(m, store);
    } catch (err) {
      this.logger.error({ msg: 'problem evaluation failed', storeId: store.id, err });
    }
  }

  // ===== القراءة =====

  private readable(store: StoreAccess, ruleId: string) {
    const rule = ruleById(ruleId);
    if (!rule) return false;
    return rule.readPermission === null || store.permissions.has(rule.readPermission);
  }

  private canManage(store: StoreAccess, ruleId: string) {
    const rule = ruleById(ruleId);
    return Boolean(rule?.managePermissions.some((p) => store.permissions.has(p)));
  }

  async list(m: Membership, store: StoreAccess) {
    const [last] = await withTenant(
      this.sql,
      m.organizationId,
      (tx) => tx<{ evaluated_at: Date; rules_version: string }[]>`
        SELECT evaluated_at, rules_version FROM problem_evaluations WHERE store_id = ${store.id}`,
    );
    if (
      !last ||
      last.rules_version !== RULES_VERSION ||
      Date.now() - last.evaluated_at.getTime() > STALE_MS
    ) {
      await this.evaluate(m, store);
    }

    return withTenant(this.sql, m.organizationId, async (tx) => {
      const rows = await tx<ProblemRow[]>`
        SELECT id, rule_id, rule_version, kind, status, score_impact, score_evidence, score_fit,
               score_feasibility, quality, title, observation, evidence, hypotheses, checks,
               action, period_start, period_end, owner_membership_id, due_on::text AS due_on,
               status_reason, first_seen_at, last_seen_at, condition_cleared_at, revision
        FROM problems WHERE store_id = ${store.id}
        ORDER BY (score_impact + score_evidence + score_fit + score_feasibility) DESC,
                 first_seen_at DESC
        LIMIT 200`;
      const names = await this.memberNames(tx);
      const [ev] = await tx<{ evaluated_at: Date }[]>`
        SELECT evaluated_at FROM problem_evaluations WHERE store_id = ${store.id}`;
      const items = rows
        .filter((r) => this.readable(store, r.rule_id))
        .map((r) => this.present(r, store, names));
      return {
        evaluatedAt: ev?.evaluated_at.toISOString() ?? null,
        items,
        waiting: RULES.filter((r) => !r.runnable).map((r) => ({
          id: r.id,
          title: r.title,
          kind: r.kind,
          needs: r.needs,
        })),
        hiddenRules: RULES.filter(
          (r) => r.readPermission && !store.permissions.has(r.readPermission),
        ).map((r) => r.id),
      };
    });
  }

  private async memberNames(tx: TransactionSql) {
    const rows = await tx<{ membership_id: string; name: string | null; status: string }[]>`
      SELECT membership_id, name, status FROM current_org_members()`;
    return new Map(rows.map((r) => [r.membership_id, r.name ?? 'عضو']));
  }

  private present(r: ProblemRow, store: StoreAccess, names: Map<string, string>) {
    const score = {
      impact: r.score_impact,
      evidence: r.score_evidence,
      fit: r.score_fit,
      feasibility: r.score_feasibility,
    };
    return {
      id: r.id,
      ruleId: r.rule_id,
      ruleVersion: r.rule_version,
      kind: r.kind,
      status: r.status,
      open: !CLOSED.has(r.status),
      score: { ...score, total: totalScore(score) },
      quality: r.quality,
      title: r.title,
      observation: r.observation,
      evidence: r.evidence,
      hypotheses: r.hypotheses,
      checks: r.checks,
      action: r.action,
      period: {
        start: r.period_start?.toISOString() ?? null,
        end: r.period_end?.toISOString() ?? null,
      },
      owner: r.owner_membership_id
        ? { id: r.owner_membership_id, name: names.get(r.owner_membership_id) ?? 'عضو' }
        : null,
      dueOn: r.due_on,
      statusReason: r.status_reason,
      firstSeenAt: r.first_seen_at.toISOString(),
      lastSeenAt: r.last_seen_at.toISOString(),
      conditionClearedAt: r.condition_cleared_at?.toISOString() ?? null,
      revision: r.revision,
      canManage: this.canManage(store, r.rule_id),
    };
  }

  private async load(tx: TransactionSql, store: StoreAccess, id: string) {
    const [r] = await tx<ProblemRow[]>`
      SELECT id, rule_id, rule_version, kind, status, score_impact, score_evidence, score_fit,
             score_feasibility, quality, title, observation, evidence, hypotheses, checks, action,
             period_start, period_end, owner_membership_id, due_on::text AS due_on, status_reason,
             first_seen_at, last_seen_at, condition_cleared_at, revision
      FROM problems WHERE id = ${id} AND store_id = ${store.id} FOR UPDATE`;
    if (!r || !this.readable(store, r.rule_id)) {
      throw new ApiError(404, 'NOT_FOUND', 'العنصر غير موجود');
    }
    return r;
  }

  async get(m: Membership, store: StoreAccess, id: string) {
    return withTenant(this.sql, m.organizationId, async (tx) => {
      const r = await this.load(tx, store, id);
      const names = await this.memberNames(tx);
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
        FROM problem_events WHERE problem_id = ${id} ORDER BY id DESC LIMIT 100`;
      return {
        ...this.present(r, store, names),
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

  /** الأعضاء الذين يمكن إسناد البطاقة إليهم: من يرى هذا المتجر */
  async assignees(m: Membership, store: StoreAccess) {
    return withTenant(this.sql, m.organizationId, async (tx) => {
      const rows = await tx<{ id: string }[]>`
        SELECT ms.id FROM memberships ms
        WHERE ms.status = 'active' AND (ms.role = 'owner' OR EXISTS (
          SELECT 1 FROM store_grants g WHERE g.membership_id = ms.id AND g.store_id = ${store.id}
            AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > now())))`;
      const names = await this.memberNames(tx);
      return rows.map((r) => ({ id: r.id, name: names.get(r.id) ?? 'عضو', me: r.id === m.id }));
    });
  }

  async update(
    m: Membership,
    store: StoreAccess,
    id: string,
    input: {
      revision: number;
      status?: ProblemStatus;
      reason?: string | null;
      ownerMembershipId?: string | null;
      dueOn?: string | null;
    },
  ) {
    await withTenant(this.sql, m.organizationId, async (tx) => {
      const r = await this.load(tx, store, id);
      if (!this.canManage(store, r.rule_id)) {
        throw new ApiError(403, 'FORBIDDEN', 'لا تملك صلاحية إدارة هذه البطاقة');
      }
      if (r.revision !== input.revision) {
        throw new ApiError(
          409,
          'REVISION_CONFLICT',
          'تغيّرت البطاقة قبل لحظات. راجع آخر نسخة ثم أعد المحاولة',
        );
      }
      const set: Record<string, unknown> = {};
      if (input.status && input.status !== r.status) {
        if (!canTransition(r.status, input.status)) {
          throw new ApiError(
            422,
            'INVALID_TRANSITION',
            'لا يمكن الانتقال إلى هذه الحالة من الحالة الحالية',
            {
              fields: ['status'],
            },
          );
        }
        const reason = input.reason?.trim() || null;
        if (REASON_REQUIRED.has(input.status) && !reason) {
          throw new ApiError(422, 'REASON_REQUIRED', 'اكتب سبب التأجيل أو الرفض أو دليل الحل', {
            fields: ['reason'],
          });
        }
        set.status = input.status;
        set.status_reason = reason;
        await tx`INSERT INTO problem_events (organization_id, problem_id, actor_membership_id, kind,
                                             from_status, to_status, body)
                 VALUES (${m.organizationId}, ${id}, ${m.id}, 'status', ${r.status},
                         ${input.status}, ${reason})`;
      }
      if (
        input.ownerMembershipId !== undefined &&
        input.ownerMembershipId !== r.owner_membership_id
      ) {
        if (input.ownerMembershipId !== null) {
          const ok = (await this.assignees(m, store)).some((a) => a.id === input.ownerMembershipId);
          if (!ok) {
            throw new ApiError(
              422,
              'VALIDATION_FAILED',
              'المسؤول يجب أن يكون عضوًا يرى هذا المتجر',
              {
                fields: ['ownerMembershipId'],
              },
            );
          }
        }
        set.owner_membership_id = input.ownerMembershipId;
        await tx`INSERT INTO problem_events (organization_id, problem_id, actor_membership_id, kind)
                 VALUES (${m.organizationId}, ${id}, ${m.id}, 'owner')`;
      }
      if (input.dueOn !== undefined) set.due_on = input.dueOn;
      if (Object.keys(set).length === 0) return;

      await tx`UPDATE problems SET ${tx(set)}, revision = revision + 1 WHERE id = ${id}`;
      const [u] = await tx<
        { user_id: string }[]
      >`SELECT user_id FROM memberships WHERE id = ${m.id}`;
      await tx`
        INSERT INTO audit_logs (organization_id, store_id, actor_type, actor_id, action, target_type,
                                target_id, before_state, after_state)
        VALUES (${m.organizationId}, ${store.id}, 'user', ${u!.user_id}, 'problem.update', 'problem', ${id},
                ${tx.json({ status: r.status, owner: r.owner_membership_id, dueOn: r.due_on } as never)},
                ${tx.json(set as never)})`;
    });
    return this.get(m, store, id);
  }

  async comment(m: Membership, store: StoreAccess, id: string, body: string) {
    await withTenant(this.sql, m.organizationId, async (tx) => {
      await this.load(tx, store, id);
      await tx`INSERT INTO problem_events (organization_id, problem_id, actor_membership_id, kind, body)
               VALUES (${m.organizationId}, ${id}, ${m.id}, 'comment', ${body})`;
    });
    return this.get(m, store, id);
  }
}
