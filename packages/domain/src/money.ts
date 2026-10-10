import { Decimal as DecimalBase } from 'decimal.js';

/**
 * المال في أرسو (ADR-0009): Decimal دائمًا، ونص عشري عبر الـ API، ولا number أبدًا.
 * لا جمع لعملتين مختلفتين قبل تحويل موثق.
 */

// دقة حسابية تكفي NUMERIC(20,6) مع هامش للنسب الوسيطة
const D = DecimalBase.clone({ precision: 40, rounding: DecimalBase.ROUND_HALF_EVEN });
export { D as Decimal };
export type DecimalValue = InstanceType<typeof D>;

/** منازل العملة العشرية (ISO 4217) للتقريب النهائي فقط */
const CURRENCY_SCALE: Readonly<Record<string, number>> = {
  SAR: 2,
  AED: 2,
  KWD: 3,
  BHD: 3,
  OMR: 3,
  QAR: 2,
  USD: 2,
  EUR: 2,
};

export type CurrencyCode = string;

export class CurrencyMismatchError extends Error {
  constructor(a: CurrencyCode, b: CurrencyCode) {
    super(`لا يمكن جمع ${a} و${b} قبل تحويل موثق`);
    this.name = 'CurrencyMismatchError';
  }
}

export class InvalidAmountError extends Error {
  constructor(raw: unknown) {
    super(`قيمة مالية غير صالحة: ${String(raw)}`);
    this.name = 'InvalidAmountError';
  }
}

const DECIMAL_STRING = /^-?\d+(\.\d+)?$/;

export function currencyScale(currency: CurrencyCode): number {
  const scale = CURRENCY_SCALE[currency];
  if (scale === undefined) throw new Error(`عملة غير مدعومة: ${currency}`);
  return scale;
}

export class Money {
  private constructor(
    readonly amount: DecimalValue,
    readonly currency: CurrencyCode,
  ) {}

  /** يقبل نصًا عشريًا فقط، فالأرقام العائمة تفقد الدقة قبل أن تصل إلينا */
  static of(amount: string, currency: CurrencyCode): Money {
    if (typeof amount !== 'string' || !DECIMAL_STRING.test(amount)) {
      throw new InvalidAmountError(amount);
    }
    currencyScale(currency);
    return new Money(new D(amount), currency);
  }

  static zero(currency: CurrencyCode): Money {
    return Money.of('0', currency);
  }

  private assertSame(other: Money): void {
    if (other.currency !== this.currency)
      throw new CurrencyMismatchError(this.currency, other.currency);
  }

  plus(other: Money): Money {
    this.assertSame(other);
    return new Money(this.amount.plus(other.amount), this.currency);
  }

  minus(other: Money): Money {
    this.assertSame(other);
    return new Money(this.amount.minus(other.amount), this.currency);
  }

  negated(): Money {
    return new Money(this.amount.negated(), this.currency);
  }

  isZero(): boolean {
    return this.amount.isZero();
  }

  isNegative(): boolean {
    return this.amount.isNegative() && !this.amount.isZero();
  }

  isPositive(): boolean {
    return this.amount.isPositive() && !this.amount.isZero();
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.amount.equals(other.amount);
  }

  /** تقريب نهائي حسب منازل العملة، للعرض والتصدير فقط */
  toFixed(): string {
    return this.amount.toFixed(currencyScale(this.currency), D.ROUND_HALF_EVEN);
  }

  /** تمثيل الـ API: نص عشري بدقة التخزين NUMERIC(20,6) */
  toJSON(): { amount: string; currency: CurrencyCode } {
    return { amount: this.amount.toFixed(6), currency: this.currency };
  }
}

export function sumMoney(items: readonly Money[], currency: CurrencyCode): Money {
  return items.reduce((acc, m) => acc.plus(m), Money.zero(currency));
}
