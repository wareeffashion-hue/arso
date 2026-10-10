/**
 * عرض الأرقام: غربية متساوية العرض (ADR-0007). القيمة null تعني «غير متوفر»، وليست صفرًا.
 * المدخل نص عشري من الـ API؛ لا نحوله إلى number حتى لا نفقد الدقة.
 */
export function formatDecimal(value: string | null, fractionDigits = 2): string | null {
  if (value === null) return null;
  if (!/^-?\d+(\.\d+)?$/.test(value)) throw new Error(`قيمة غير صالحة: ${value}`);
  const negative = value.startsWith('-');
  const [intPart = '0', frac = ''] = value.replace('-', '').split('.');
  let digits = frac.padEnd(fractionDigits + 1, '0');
  // تقريب نصف للأعلى على مستوى النص، دون المرور بـ float
  let whole = intPart;
  if (fractionDigits >= 0) {
    const keep = digits.slice(0, fractionDigits);
    const next = Number(digits[fractionDigits] ?? '0');
    let n = BigInt(whole + keep);
    if (next >= 5) n += 1n;
    const s = n.toString().padStart(fractionDigits + 1, '0');
    whole = s.slice(0, s.length - fractionDigits) || '0';
    digits = s.slice(s.length - fractionDigits);
  }
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = fractionDigits > 0 ? `${grouped}.${digits}` : grouped;
  const isZero = /^[0,.]+$/.test(body);
  return negative && !isZero ? `-${body}` : body;
}
