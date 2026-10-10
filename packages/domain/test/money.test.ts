import { describe, expect, it } from 'vitest';
import {
  allocateProRata,
  CurrencyMismatchError,
  dedupeEntries,
  InvalidAmountError,
  LedgerValidationError,
  Money,
  percentChange,
  safeRatio,
  sumMoney,
  validateEntry,
} from '../src/index.js';

describe('Money', () => {
  it('يرفض الأرقام العائمة والنصوص غير العشرية', () => {
    expect(() => Money.of(0.1 as unknown as string, 'SAR')).toThrow(InvalidAmountError);
    expect(() => Money.of('1e3', 'SAR')).toThrow(InvalidAmountError);
    expect(() => Money.of('abc', 'SAR')).toThrow(InvalidAmountError);
  });

  it('لا يخطئ في 0.1 + 0.2', () => {
    expect(Money.of('0.1', 'SAR').plus(Money.of('0.2', 'SAR')).toFixed()).toBe('0.30');
  });

  it('يمنع جمع عملتين مختلفتين', () => {
    expect(() => Money.of('1', 'SAR').plus(Money.of('1', 'USD'))).toThrow(CurrencyMismatchError);
  });

  it('يرفض عملة غير مدعومة', () => {
    expect(() => Money.of('1', 'XXX')).toThrow();
  });

  it('يعتمد دقة العملة: الدينار الكويتي 3 منازل', () => {
    expect(Money.of('1.23456', 'KWD').toFixed()).toBe('1.235');
  });

  it('يتحمل القيم الكبيرة دون overflow', () => {
    const big = Money.of('99999999999999.999999', 'SAR');
    expect(sumMoney([big, big], 'SAR').toJSON().amount).toBe('199999999999999.999998');
  });
});

describe('allocateProRata: توزيع خصم الطلب على البنود (القسم 31)', () => {
  it('المجموع يطابق الأصل تمامًا مع كسور غير منتهية', () => {
    const parts = allocateProRata(Money.of('10.00', 'SAR'), [
      Money.of('1', 'SAR'),
      Money.of('1', 'SAR'),
      Money.of('1', 'SAR'),
    ]);
    expect(parts.map((p) => p.toFixed())).toEqual(['3.34', '3.33', '3.33']);
    expect(sumMoney(parts, 'SAR').toFixed()).toBe('10.00');
  });

  it('حتمي: نفس المدخلات تعطي نفس النتيجة', () => {
    const w = [Money.of('150', 'SAR'), Money.of('49.99', 'SAR'), Money.of('0.01', 'SAR')];
    const a = allocateProRata(Money.of('25.00', 'SAR'), w).map((m) => m.toFixed());
    const b = allocateProRata(Money.of('25.00', 'SAR'), w).map((m) => m.toFixed());
    expect(a).toEqual(b);
    expect(
      sumMoney(
        a.map((x) => Money.of(x, 'SAR')),
        'SAR',
      ).toFixed(),
    ).toBe('25.00');
  });

  it('يوزع المبالغ السالبة بنفس الدقة', () => {
    const parts = allocateProRata(Money.of('-10.00', 'SAR'), [
      Money.of('1', 'SAR'),
      Money.of('2', 'SAR'),
    ]);
    expect(sumMoney(parts, 'SAR').toFixed()).toBe('-10.00');
  });

  it('يرفض أوزانًا مجموعها صفر', () => {
    expect(() => allocateProRata(Money.of('1', 'SAR'), [Money.zero('SAR')])).toThrow();
  });
});

describe('قواعد السجل المالي', () => {
  it('يرفض استردادًا بإشارة موجبة', () => {
    expect(() =>
      validateEntry({ kind: 'product_refund', amount: Money.of('100', 'SAR'), sourceKey: 'k' }),
    ).toThrow(LedgerValidationError);
  });

  it('يقبل الحركة العكسية بالإشارة المعاكسة', () => {
    expect(() =>
      validateEntry({
        kind: 'payment_fee',
        amount: Money.of('-6', 'SAR'),
        sourceKey: 'k2',
        reversesKey: 'k1',
      }),
    ).not.toThrow();
  });

  it('التسوية اليدوية تحتاج مجموعة صريحة', () => {
    expect(() =>
      validateEntry({ kind: 'manual_adjustment', amount: Money.of('5', 'SAR'), sourceKey: 'm' }),
    ).toThrow(LedgerValidationError);
  });

  it('نفس المفتاح بقيمة مختلفة تعارض وليس تكرارًا', () => {
    expect(() =>
      dedupeEntries([
        { kind: 'payment_fee', amount: Money.of('6', 'SAR'), sourceKey: 'k' },
        { kind: 'payment_fee', amount: Money.of('7', 'SAR'), sourceKey: 'k' },
      ]),
    ).toThrow(LedgerValidationError);
  });
});

describe('المقاييس: الغياب ليس صفرًا', () => {
  it('لا نسبة تغير على أساس صفر', () => {
    expect(percentChange('50', '0')).toEqual({ absolute: '50', percent: null });
  });
  it('لا تغير إذا كانت قيمة مفقودة', () => {
    expect(percentChange(null, '10')).toEqual({ absolute: null, percent: null });
  });
  it('نسبة صحيحة على أساس سالب', () => {
    expect(percentChange('-5', '-10').percent).toBe('50');
  });
  it('متوسط الطلب مع صفر طلبات = null', () => {
    expect(safeRatio('1000', '0')).toBeNull();
  });
});
