import { currencyScale } from './money.js';
import type { CsvTable } from './csv.js';
import { classifyOrderStatus, type Eligibility } from './order-status.js';

/**
 * قوالب الاستيراد والتحقق من صفوفها (الملحق ب والقسم 38). التحقق هنا نقي وحتمي:
 * نفس الملف بنفس الخيارات يعطي نفس النتيجة، فالمعاينة والاعتماد يتفقان.
 */

export const IMPORT_KINDS = ['orders', 'costs', 'ad_spend'] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export const IMPORT_TEMPLATES: Readonly<
  Record<ImportKind, { required: readonly string[]; optional: readonly string[] }>
> = {
  orders: {
    required: [
      'order_external_id',
      'line_external_id',
      'created_at',
      'source_status',
      'currency',
      'variant_external_id',
      'quantity',
      'product_revenue_ex_tax',
    ],
    optional: [
      'store_external_id',
      'product_external_id',
      'tax_amount',
      'shipping_income_ex_tax',
      'customer_external_id',
    ],
  },
  costs: {
    required: ['variant_external_id', 'currency', 'cost_ex_tax', 'valid_from'],
    optional: ['store_external_id', 'source_note'],
  },
  ad_spend: {
    required: [
      'provider',
      'account_external_id',
      'report_date',
      'report_timezone',
      'currency',
      'spend',
    ],
    optional: [
      'store_external_id',
      'campaign_external_id',
      'attribution_window',
      'conversion_type',
      'attributed_value',
    ],
  },
};

export const AD_PROVIDERS = ['snapchat', 'meta', 'tiktok', 'google', 'x', 'other'] as const;

export interface ImportOptions {
  /** معرّف المتجر الذي صدر له القالب. store_external_id إن وُجد يجب أن يطابقه */
  readonly storeId: string;
  readonly storeCurrency: string;
  readonly storeTimezone: string;
  /** وقت بلا منطقة: null يرفضه، أو منطقة IANA يُفسَّر بها بعد اختيار صريح من المستخدم */
  readonly naiveTimezone: string | null;
}

export interface RejectedRow {
  readonly line: number;
  readonly reasons: readonly string[];
}

export interface OrderLineRow {
  readonly orderExternalId: string;
  readonly lineExternalId: string;
  readonly createdAt: string;
  readonly sourceStatus: string;
  readonly eligibility: Eligibility;
  readonly currency: string;
  readonly productExternalId: string | null;
  readonly variantExternalId: string;
  readonly quantity: string;
  readonly productRevenueExTax: string;
  readonly taxAmount: string | null;
  /** على مستوى الطلب: يُخزن مرة واحدة ولا يُجمع لكل بند */
  readonly shippingIncomeExTax: string | null;
  readonly customerExternalId: string | null;
}

export interface CostRow {
  readonly variantExternalId: string;
  readonly currency: string;
  readonly costExTax: string;
  readonly validFrom: string;
  readonly sourceNote: string | null;
}

export interface AdSpendRow {
  readonly provider: (typeof AD_PROVIDERS)[number];
  readonly accountExternalId: string;
  readonly campaignExternalId: string;
  readonly reportDate: string;
  readonly reportTimezone: string;
  readonly currency: string;
  readonly spend: string;
  readonly attributionWindow: string;
  readonly conversionType: string;
  readonly attributedValue: string | null;
}

export type RowsOf<K extends ImportKind> = K extends 'orders'
  ? OrderLineRow
  : K extends 'costs'
    ? CostRow
    : AdSpendRow;

export interface ValidationResult<T> {
  readonly rows: readonly T[];
  readonly rejected: readonly RejectedRow[];
  /** أخطاء على مستوى الملف (أعمدة ناقصة): الملف كله مرفوض */
  readonly fileErrors: readonly string[];
}

// ===== أدوات القيم =====

const DECIMAL = /^-?\d{1,14}(\.\d{1,6})?$/;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/i;
const NAIVE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;
const MAX_TEXT = 200;

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function validDate(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** إزاحة المنطقة بالدقائق عند لحظة UTC معينة */
function offsetMinutes(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((asUtc - utcMs) / 60_000);
}

/** وقت محلي في منطقة IANA إلى لحظة UTC (مع تمريرة ثانية لحدود التوقيت الصيفي) */
export function zonedToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  tz: string,
): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const first = guess - offsetMinutes(guess, tz) * 60_000;
  const second = guess - offsetMinutes(first, tz) * 60_000;
  return new Date(second);
}

type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string };

function parseTimestamp(raw: string, naiveTz: string | null): Parsed<string> {
  if (WITH_ZONE.test(raw)) {
    const t = Date.parse(raw);
    if (Number.isNaN(t)) return { ok: false, reason: 'تاريخ غير صالح' };
    return { ok: true, value: new Date(t).toISOString() };
  }
  const m = NAIVE.exec(raw);
  if (m) {
    if (!naiveTz) return { ok: false, reason: 'الوقت بلا منطقة زمنية؛ اختر المنطقة صراحة' };
    const [y, mo, d, h, mi, s] = m.slice(1).map((x) => Number(x ?? 0)) as number[];
    if (!validDate(y!, mo!, d!) || h! > 23 || mi! > 59 || s! > 59)
      return { ok: false, reason: 'تاريخ غير صالح' };
    return { ok: true, value: zonedToUtc(y!, mo!, d!, h!, mi!, s!, naiveTz).toISOString() };
  }
  return { ok: false, reason: 'صيغة التاريخ يجب أن تكون ISO 8601' };
}

/** بداية سريان التكلفة: تاريخ وحده = بداية اليوم بمنطقة المتجر */
function parseValidFrom(raw: string, opts: ImportOptions): Parsed<string> {
  const m = DATE_ONLY.exec(raw);
  if (m) {
    const [y, mo, d] = m.slice(1).map(Number) as [number, number, number];
    if (!validDate(y, mo, d)) return { ok: false, reason: 'تاريخ غير صالح' };
    return { ok: true, value: zonedToUtc(y, mo, d, 0, 0, 0, opts.storeTimezone).toISOString() };
  }
  return parseTimestamp(raw, opts.naiveTimezone);
}

function parseDecimal(
  raw: string,
  field: string,
  rule: 'positive' | 'non_negative' | 'any',
): Parsed<string> {
  const v = raw.replace(/,/g, '') === raw ? raw : null;
  if (v === null || !DECIMAL.test(v)) return { ok: false, reason: `${field}: رقم عشري غير صالح` };
  const negative = v.startsWith('-');
  const zero = /^-?0+(\.0+)?$/.test(v);
  if (rule === 'positive' && (negative || zero))
    return { ok: false, reason: `${field}: يجب أن يكون أكبر من صفر` };
  if (rule === 'non_negative' && negative && !zero)
    return { ok: false, reason: `${field}: لا يقبل قيمة سالبة` };
  return { ok: true, value: zero ? '0' : v };
}

function parseCurrency(raw: string): Parsed<string> {
  const c = raw.toUpperCase();
  try {
    currencyScale(c);
    return { ok: true, value: c };
  } catch {
    return { ok: false, reason: `عملة غير مدعومة: ${raw}` };
  }
}

function text(raw: string, field: string): Parsed<string> {
  if (!raw) return { ok: false, reason: `${field}: مطلوب` };
  if (raw.length > MAX_TEXT) return { ok: false, reason: `${field}: أطول من ${MAX_TEXT} حرف` };
  return { ok: true, value: raw };
}

// ===== التحقق العام =====

function checkHeader(table: CsvTable, kind: ImportKind): string[] {
  const t = IMPORT_TEMPLATES[kind];
  const missing = t.required.filter((c) => !table.header.includes(c));
  return missing.length ? [`أعمدة مطلوبة ناقصة: ${missing.join('، ')}`] : [];
}

/** يقرأ الصف إلى خريطة عمود→قيمة، ويجمع أسباب الرفض بدل التوقف عند أولها */
class RowReader {
  readonly reasons: string[] = [];
  constructor(
    private readonly header: readonly string[],
    private readonly cells: readonly string[],
  ) {
    if (cells.length !== header.length)
      this.reasons.push(`عدد الأعمدة ${cells.length} بدل ${header.length}`);
  }
  raw(col: string): string {
    const i = this.header.indexOf(col);
    return i === -1 ? '' : (this.cells[i] ?? '').trim();
  }
  take<T>(p: Parsed<T>): T | undefined {
    if (p.ok) return p.value;
    this.reasons.push(p.reason);
    return undefined;
  }
  /** القيمة الفارغة تبقى null (الغياب ليس صفرًا) */
  optional<T>(col: string, parse: (raw: string) => Parsed<T>): T | null | undefined {
    const r = this.raw(col);
    return r === '' ? null : this.take(parse(r));
  }
}

function checkStore(r: RowReader, opts: ImportOptions) {
  const s = r.raw('store_external_id');
  if (s && s.toLowerCase() !== opts.storeId.toLowerCase())
    r.reasons.push('الصف لمتجر آخر غير الذي صدر له القالب');
}

export function validateOrders(
  table: CsvTable,
  opts: ImportOptions,
): ValidationResult<OrderLineRow> {
  const fileErrors = checkHeader(table, 'orders');
  if (fileErrors.length) return { rows: [], rejected: [], fileErrors };

  const parsed: { line: number; row: OrderLineRow }[] = [];
  const rejected: RejectedRow[] = [];
  const seen = new Set<string>();

  for (const { line, cells } of table.rows) {
    const r = new RowReader(table.header, cells);
    checkStore(r, opts);
    const orderExternalId = r.take(text(r.raw('order_external_id'), 'order_external_id'));
    const lineExternalId = r.take(text(r.raw('line_external_id'), 'line_external_id'));
    const createdAt = r.take(parseTimestamp(r.raw('created_at'), opts.naiveTimezone));
    const sourceStatus = r.take(text(r.raw('source_status'), 'source_status'));
    const currency = r.take(parseCurrency(r.raw('currency')));
    const variantExternalId = r.take(text(r.raw('variant_external_id'), 'variant_external_id'));
    const quantity = r.take(parseDecimal(r.raw('quantity'), 'quantity', 'positive'));
    const revenue = r.take(
      parseDecimal(r.raw('product_revenue_ex_tax'), 'product_revenue_ex_tax', 'non_negative'),
    );
    const taxAmount = r.optional('tax_amount', (v) =>
      parseDecimal(v, 'tax_amount', 'non_negative'),
    );
    const shipping = r.optional('shipping_income_ex_tax', (v) =>
      parseDecimal(v, 'shipping_income_ex_tax', 'non_negative'),
    );
    const productExternalId = r.optional('product_external_id', (v) =>
      text(v, 'product_external_id'),
    );
    const customerExternalId = r.optional('customer_external_id', (v) =>
      text(v, 'customer_external_id'),
    );
    if (currency && currency !== opts.storeCurrency)
      r.reasons.push(`عملة الطلب ${currency} تختلف عن عملة المتجر ${opts.storeCurrency}`);
    const key = `${orderExternalId}\u0000${lineExternalId}`;
    if (orderExternalId && lineExternalId && seen.has(key)) r.reasons.push('بند مكرر في نفس الملف');

    if (r.reasons.length) {
      rejected.push({ line, reasons: r.reasons });
      continue;
    }
    seen.add(key);
    parsed.push({
      line,
      row: {
        orderExternalId: orderExternalId!,
        lineExternalId: lineExternalId!,
        createdAt: createdAt!,
        sourceStatus: sourceStatus!,
        eligibility: classifyOrderStatus(sourceStatus!),
        currency: currency!,
        productExternalId: productExternalId ?? null,
        variantExternalId: variantExternalId!,
        quantity: quantity!,
        productRevenueExTax: revenue!,
        taxAmount: taxAmount ?? null,
        shippingIncomeExTax: shipping ?? null,
        customerExternalId: customerExternalId ?? null,
      },
    });
  }

  // حقول الطلب يجب أن تتطابق في كل بنوده، وإلا يُرفض الطلب كله (الشحن لا يُجمع لكل بند)
  const byOrder = new Map<string, { line: number; row: OrderLineRow }[]>();
  for (const p of parsed) {
    const list = byOrder.get(p.row.orderExternalId) ?? [];
    list.push(p);
    byOrder.set(p.row.orderExternalId, list);
  }
  const rows: OrderLineRow[] = [];
  for (const list of byOrder.values()) {
    const first = list[0]!.row;
    const fields: [keyof OrderLineRow, string][] = [
      ['createdAt', 'التاريخ'],
      ['sourceStatus', 'الحالة'],
      ['shippingIncomeExTax', 'الشحن المحصّل'],
      ['customerExternalId', 'العميل'],
    ];
    const differing = fields
      .filter(([k]) => list.some(({ row }) => row[k] !== first[k]))
      .map(([, label]) => label);
    if (differing.length) {
      for (const p of list)
        rejected.push({
          line: p.line,
          reasons: [`${differing.join(' و')} يختلف بين بنود الطلب ${first.orderExternalId}`],
        });
    } else {
      rows.push(...list.map((p) => p.row));
    }
  }
  rejected.sort((a, b) => a.line - b.line);
  return { rows, rejected, fileErrors: [] };
}

export function validateCosts(table: CsvTable, opts: ImportOptions): ValidationResult<CostRow> {
  const fileErrors = checkHeader(table, 'costs');
  if (fileErrors.length) return { rows: [], rejected: [], fileErrors };
  const rows: CostRow[] = [];
  const rejected: RejectedRow[] = [];
  const seen = new Set<string>();
  for (const { line, cells } of table.rows) {
    const r = new RowReader(table.header, cells);
    checkStore(r, opts);
    const variantExternalId = r.take(text(r.raw('variant_external_id'), 'variant_external_id'));
    const currency = r.take(parseCurrency(r.raw('currency')));
    const costExTax = r.take(parseDecimal(r.raw('cost_ex_tax'), 'cost_ex_tax', 'non_negative'));
    const validFrom = r.take(parseValidFrom(r.raw('valid_from'), opts));
    const sourceNote = r.optional('source_note', (v) => text(v, 'source_note'));
    if (currency && currency !== opts.storeCurrency)
      r.reasons.push(
        `عملة التكلفة ${currency} تختلف عن عملة المتجر ${opts.storeCurrency}؛ لا تحويل بلا سعر موثق`,
      );
    const key = `${variantExternalId}\u0000${validFrom}`;
    if (variantExternalId && validFrom && seen.has(key))
      r.reasons.push('نفس المتغير ونفس تاريخ السريان مكرر في الملف');
    if (r.reasons.length) {
      rejected.push({ line, reasons: r.reasons });
      continue;
    }
    seen.add(key);
    rows.push({
      variantExternalId: variantExternalId!,
      currency: currency!,
      costExTax: costExTax!,
      validFrom: validFrom!,
      sourceNote: sourceNote ?? null,
    });
  }
  return { rows, rejected, fileErrors: [] };
}

export function validateAdSpend(
  table: CsvTable,
  opts: ImportOptions,
): ValidationResult<AdSpendRow> {
  const fileErrors = checkHeader(table, 'ad_spend');
  if (fileErrors.length) return { rows: [], rejected: [], fileErrors };
  const rows: AdSpendRow[] = [];
  const rejected: RejectedRow[] = [];
  const seen = new Set<string>();
  for (const { line, cells } of table.rows) {
    const r = new RowReader(table.header, cells);
    checkStore(r, opts);
    const providerRaw = r.raw('provider').toLowerCase();
    const provider = (AD_PROVIDERS as readonly string[]).includes(providerRaw)
      ? (providerRaw as AdSpendRow['provider'])
      : undefined;
    if (!provider) r.reasons.push(`provider: واحد من ${AD_PROVIDERS.join('، ')}`);
    const accountExternalId = r.take(text(r.raw('account_external_id'), 'account_external_id'));
    const campaignExternalId = r.raw('campaign_external_id') || '-';
    const dateRaw = r.raw('report_date');
    const dm = DATE_ONLY.exec(dateRaw);
    if (!dm || !validDate(Number(dm[1]), Number(dm[2]), Number(dm[3])))
      r.reasons.push('report_date: تاريخ يومي بصيغة YYYY-MM-DD');
    const reportTimezone = r.raw('report_timezone');
    if (!isValidTimezone(reportTimezone) || !reportTimezone)
      r.reasons.push('report_timezone: منطقة IANA غير صالحة');
    const currency = r.take(parseCurrency(r.raw('currency')));
    const spend = r.take(parseDecimal(r.raw('spend'), 'spend', 'non_negative'));
    const attributedValue = r.optional('attributed_value', (v) =>
      parseDecimal(v, 'attributed_value', 'non_negative'),
    );
    const attributionWindow = r.raw('attribution_window') || 'unknown';
    const conversionType = r.raw('conversion_type') || 'unknown';
    const key = [
      provider,
      accountExternalId,
      campaignExternalId,
      dateRaw,
      reportTimezone,
      attributionWindow,
      conversionType,
    ].join('\u0000');
    if (seen.has(key)) r.reasons.push('نفس الحملة ونفس اليوم والنافذة مكررة في الملف');
    if (r.reasons.length) {
      rejected.push({ line, reasons: r.reasons });
      continue;
    }
    seen.add(key);
    rows.push({
      provider: provider!,
      accountExternalId: accountExternalId!,
      campaignExternalId,
      reportDate: dateRaw,
      reportTimezone,
      currency: currency!,
      spend: spend!,
      attributionWindow,
      conversionType,
      attributedValue: attributedValue ?? null,
    });
  }
  return { rows, rejected, fileErrors: [] };
}

export function validateImport<K extends ImportKind>(
  kind: K,
  table: CsvTable,
  opts: ImportOptions,
): ValidationResult<RowsOf<K>> {
  const v =
    kind === 'orders'
      ? validateOrders(table, opts)
      : kind === 'costs'
        ? validateCosts(table, opts)
        : validateAdSpend(table, opts);
  return v as ValidationResult<RowsOf<K>>;
}
