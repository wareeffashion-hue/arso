import { Decimal } from './money.js';

/**
 * كل رقم في أرسو يحمل جودته (القسم 30): الغياب ليس صفرًا.
 */
export type Quality = 'complete' | 'incomplete' | 'unavailable' | 'stale' | 'limited_sample';

export interface MetricValue {
  readonly key: string;
  /** نص عشري، أو null حين لا يمكن حساب الرقم بأمانة */
  readonly value: string | null;
  readonly currency?: string;
  readonly quality: Quality;
  readonly definitionVersion: string;
  readonly warnings: readonly string[];
}

/**
 * نسبة التغير. إذا كان الأساس صفرًا أو مفقودًا لا تُحسب نسبة (القسم 30):
 * يُعرض الفرق المطلق و«غير قابل لحساب نسبة».
 */
export function percentChange(
  current: string | null,
  baseline: string | null,
): { absolute: string | null; percent: string | null } {
  if (current === null || baseline === null) return { absolute: null, percent: null };
  const c = new Decimal(current);
  const b = new Decimal(baseline);
  const absolute = c.minus(b).toString();
  if (b.isZero()) return { absolute, percent: null };
  return { absolute, percent: c.minus(b).div(b.abs()).times(100).toDecimalPlaces(2).toString() };
}

/** قسمة آمنة للمقاييس: مقام صفر أو مفقود = null (مثل aov_products) */
export function safeRatio(numerator: string | null, denominator: string | null): string | null {
  if (numerator === null || denominator === null) return null;
  const d = new Decimal(denominator);
  if (d.isZero()) return null;
  return new Decimal(numerator).div(d).toString();
}
