import { Decimal, Money, currencyScale, sumMoney } from './money.js';

/**
 * توزيع مبلغ على بنود بنسبة أوزانها (القسم 31): خصم الطلب يوزع على البنود المؤهلة
 * بنسبة قيمتها قبل الخصم. التقريب لأصغر وحدة في العملة بطريقة "أكبر باقٍ"،
 * فيكون التوزيع حتميًا ومجموعه يطابق الأصل تمامًا.
 */
export function allocateProRata(total: Money, weights: readonly Money[]): Money[] {
  if (weights.length === 0) throw new Error('لا توجد بنود للتوزيع');
  const currency = total.currency;
  const scale = currencyScale(currency);
  const unit = new Decimal(10).pow(-scale);
  const weightSum = sumMoney(weights, currency).amount;
  if (weightSum.isZero()) throw new Error('مجموع الأوزان صفر');
  if (weights.some((w) => w.isNegative())) throw new Error('وزن سالب غير مسموح');

  const totalUnits = total.amount.div(unit);
  if (!totalUnits.isInteger()) throw new Error('المبلغ أدق من منازل العملة');

  const exact = weights.map((w) => totalUnits.times(w.amount).div(weightSum));
  const floors = exact.map((e) => (totalUnits.isNegative() ? e.ceil() : e.floor()));
  let remainder = totalUnits.minus(floors.reduce((a, b) => a.plus(b), new Decimal(0)));

  // الباقي يذهب للبنود ذات أكبر كسر، والتعادل يُحسم بترتيب البند (حتمي)
  const order = exact
    .map((e, i) => ({ i, frac: e.minus(floors[i]!).abs() }))
    .sort((a, b) => b.frac.comparedTo(a.frac) || a.i - b.i);

  const step = remainder.isNegative() ? -1 : 1;
  const units = [...floors];
  for (const { i } of order) {
    if (remainder.isZero()) break;
    units[i] = units[i]!.plus(step);
    remainder = remainder.minus(step);
  }
  return units.map((u) => Money.of(u.times(unit).toFixed(scale), currency));
}
