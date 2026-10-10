import { describe, expect, it } from 'vitest';
import {
  computeContribution,
  Money,
  type CostCoverage,
  type FinancialEntry,
} from '../src/index.js';

/**
 * مثال القسم 33 الإلزامي: طلب قطعتين × 100، تكلفة كل قطعة 40، شحن محصل 10،
 * ناقل 25، دفع 6، تغليف 4، تسويق 35. كل المبالغ دون ضريبة.
 */
const SAR = (a: string) => Money.of(a, 'SAR');
const e = (kind: FinancialEntry['kind'], amount: string, sourceKey: string): FinancialEntry => ({
  kind,
  amount: SAR(amount),
  sourceKey,
});

const order: FinancialEntry[] = [
  e('product_revenue', '200', 'salla:o1:l1:product_revenue:1'),
  e('shipping_revenue', '10', 'salla:o1:-:shipping_revenue:1'),
  e('cogs_charge', '80', 'arso:o1:l1:cogs_charge:1'),
  e('shipping_cost', '25', 'carrier:o1:-:shipping_cost:1'),
  e('payment_fee', '6', 'gateway:o1:-:payment_fee:1'),
  e('packaging_cost', '4', 'arso:o1:-:packaging_cost:1'),
  e('marketing_cost', '35', 'arso:o1:-:marketing_cost:1'),
];

const refundOneItem: FinancialEntry[] = [
  e('product_refund', '-100', 'salla:r1:l1:product_refund:1'),
  e('return_shipping_cost', '15', 'carrier:r1:-:return_shipping_cost:1'),
  e('repair_cost', '5', 'arso:r1:l1:repair_cost:1'),
];
const sellableRecovery = e('cogs_recovery', '-40', 'arso:r1:l1:cogs_recovery:1');

const fullCoverage: CostCoverage = {
  linesRequiringCost: 1,
  linesWithCost: 1,
  valueRequiringCost: SAR('200'),
  valueWithCost: SAR('200'),
};

describe('القسم 33: مثال حساب واجب اختباره', () => {
  it('قبل المرتجع: مساهمة 95 قبل التسويق و60 بعده', () => {
    const r = computeContribution(order, fullCoverage, 'SAR');
    expect(r.preMarketing.value).toBe('95.00');
    expect(r.postMarketing.value).toBe('60.00');
    expect(r.preMarketing.quality).toBe('complete');
  });

  it('بعد إعادة قطعة قابلة للبيع: 15 قبل التسويق و-20 بعده', () => {
    const r = computeContribution(
      [...order, ...refundOneItem, sellableRecovery],
      fullCoverage,
      'SAR',
    );
    expect(r.preMarketing.value).toBe('15.00');
    expect(r.postMarketing.value).toBe('-20.00');
  });

  it('إذا لم تعد القطعة قابلة للبيع: لا استعادة تكلفة، -25 و-60', () => {
    const r = computeContribution([...order, ...refundOneItem], fullCoverage, 'SAR');
    expect(r.preMarketing.value).toBe('-25.00');
    expect(r.postMarketing.value).toBe('-60.00');
  });

  it('AC03: حدث الاسترداد المكرر لا يستعيد التكلفة مرتين', () => {
    const r = computeContribution(
      [...order, ...refundOneItem, sellableRecovery, ...refundOneItem, sellableRecovery],
      fullCoverage,
      'SAR',
    );
    expect(r.preMarketing.value).toBe('15.00');
    expect(r.postMarketing.value).toBe('-20.00');
  });

  it('الإنفاق التسويقي لا يُسترد تلقائيًا عند الاسترجاع', () => {
    const r = computeContribution(
      [...order, ...refundOneItem, sellableRecovery],
      fullCoverage,
      'SAR',
    );
    expect(r.preMarketing.value).not.toBe(r.postMarketing.value);
  });
});

describe('AC01: التكلفة الناقصة لا تنتج ربحية مكتملة', () => {
  it('مساهمة null وجودة incomplete، مع رقم ثانوي للبنود المكتملة فقط', () => {
    const partial: CostCoverage = {
      linesRequiringCost: 10,
      linesWithCost: 8,
      valueRequiringCost: SAR('1000'),
      valueWithCost: SAR('820'),
    };
    const r = computeContribution(order, partial, 'SAR', order);
    expect(r.preMarketing.value).toBeNull();
    expect(r.postMarketing.value).toBeNull();
    expect(r.preMarketing.quality).toBe('incomplete');
    expect(r.coverageRatio).toBe('0.82');
    expect(r.preMarketing.warnings[0]).toContain('2');
    expect(r.completeLinesOnly).toEqual({ preMarketing: '95.00', postMarketing: '60.00' });
  });

  it('بدون حركات البنود المكتملة لا يُعرض رقم ثانوي مضلل', () => {
    const partial: CostCoverage = {
      linesRequiringCost: 2,
      linesWithCost: 1,
      valueRequiringCost: SAR('300'),
      valueWithCost: SAR('200'),
    };
    expect(computeContribution(order, partial, 'SAR').completeLinesOnly).toBeNull();
  });
});
