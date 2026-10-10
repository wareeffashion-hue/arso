import { Money, type CurrencyCode } from './money.js';

/**
 * السجل المالي الحسابي (القسم 31 والملحق أ). append-only: التصحيح بحركة عكسية.
 * اصطلاح الإشارة: الإيراد موجب، ورد الإيراد سالب. التكلفة موجبة في مجموعة التكلفة،
 * واستعادة التكلفة سالبة في نفس المجموعة.
 */

export const ENTRY_KINDS = [
  'product_revenue',
  'shipping_revenue',
  'product_refund',
  'shipping_refund',
  'cogs_charge',
  'cogs_recovery',
  'payment_fee',
  'payment_fee_refund',
  'shipping_cost',
  'return_shipping_cost',
  'exchange_shipping_cost',
  'packaging_cost',
  'repair_cost',
  'marketing_cost',
  'manual_adjustment',
] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

export type EntryGroup = 'revenue' | 'variable_cost' | 'marketing';

type KindRule = { group: EntryGroup | null; sign: 'positive' | 'negative' | 'any' };

const KIND_RULES: Readonly<Record<EntryKind, KindRule>> = {
  product_revenue: { group: 'revenue', sign: 'positive' },
  shipping_revenue: { group: 'revenue', sign: 'positive' },
  product_refund: { group: 'revenue', sign: 'negative' },
  shipping_refund: { group: 'revenue', sign: 'negative' },
  cogs_charge: { group: 'variable_cost', sign: 'positive' },
  cogs_recovery: { group: 'variable_cost', sign: 'negative' },
  payment_fee: { group: 'variable_cost', sign: 'positive' },
  payment_fee_refund: { group: 'variable_cost', sign: 'negative' },
  shipping_cost: { group: 'variable_cost', sign: 'positive' },
  return_shipping_cost: { group: 'variable_cost', sign: 'positive' },
  exchange_shipping_cost: { group: 'variable_cost', sign: 'positive' },
  packaging_cost: { group: 'variable_cost', sign: 'positive' },
  repair_cost: { group: 'variable_cost', sign: 'positive' },
  marketing_cost: { group: 'marketing', sign: 'positive' },
  // التسوية اليدوية تحدد مجموعتها صراحة، ولا تُستنتج
  manual_adjustment: { group: null, sign: 'any' },
};

export interface FinancialEntry {
  readonly kind: EntryKind;
  readonly amount: Money;
  /** مجموعة التسوية اليدوية فقط؛ الأنواع الأخرى مجموعتها ثابتة */
  readonly group?: EntryGroup;
  /** مفتاح المصدر الفريد (القسم 37): source + record + line + kind + revision */
  readonly sourceKey: string;
  /** إن كانت حركة عكسية، تشير للأصل */
  readonly reversesKey?: string;
}

export class LedgerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerValidationError';
  }
}

export function entryGroup(entry: FinancialEntry): EntryGroup {
  const rule = KIND_RULES[entry.kind];
  const group = rule.group ?? entry.group;
  if (!group) throw new LedgerValidationError(`التسوية ${entry.sourceKey} بلا مجموعة`);
  if (rule.group && entry.group && entry.group !== rule.group) {
    throw new LedgerValidationError(`${entry.kind} لا ينتمي إلى ${entry.group}`);
  }
  return group;
}

export function validateEntry(entry: FinancialEntry): void {
  entryGroup(entry);
  // الحركة العكسية تحمل الإشارة المعاكسة للأصل، فلا يُطبق عليها قيد الإشارة
  if (entry.reversesKey) return;
  const { sign } = KIND_RULES[entry.kind];
  if (sign === 'positive' && entry.amount.isNegative()) {
    throw new LedgerValidationError(`${entry.kind} يجب أن يكون موجبًا (${entry.sourceKey})`);
  }
  if (sign === 'negative' && entry.amount.isPositive()) {
    throw new LedgerValidationError(`${entry.kind} يجب أن يكون سالبًا (${entry.sourceKey})`);
  }
}

/**
 * إزالة التكرار بمفتاح المصدر: نفس الحدث إذا وصل مرتين يُحتسب مرة واحدة (AC03).
 * وصول نفس المفتاح بقيمة مختلفة خطأ، لأن التصحيح يكون بمراجعة (revision) جديدة.
 */
export function dedupeEntries(entries: readonly FinancialEntry[]): FinancialEntry[] {
  const seen = new Map<string, FinancialEntry>();
  for (const e of entries) {
    const prev = seen.get(e.sourceKey);
    if (!prev) {
      seen.set(e.sourceKey, e);
      continue;
    }
    if (prev.kind !== e.kind || !prev.amount.equals(e.amount)) {
      throw new LedgerValidationError(`تعارض في المفتاح ${e.sourceKey}: نفس المفتاح بقيمة مختلفة`);
    }
  }
  return [...seen.values()];
}

export interface GroupTotals {
  readonly currency: CurrencyCode;
  readonly revenue: Money;
  readonly variableCost: Money;
  readonly marketing: Money;
}

export function totalsByGroup(
  entries: readonly FinancialEntry[],
  currency: CurrencyCode,
): GroupTotals {
  let revenue = Money.zero(currency);
  let variableCost = Money.zero(currency);
  let marketing = Money.zero(currency);
  for (const e of dedupeEntries(entries)) {
    validateEntry(e);
    const g = entryGroup(e);
    if (g === 'revenue') revenue = revenue.plus(e.amount);
    else if (g === 'variable_cost') variableCost = variableCost.plus(e.amount);
    else marketing = marketing.plus(e.amount);
  }
  return { currency, revenue, variableCost, marketing };
}
