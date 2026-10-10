import { describe, expect, it } from 'vitest';
import { formatDecimal } from '../lib/format';

describe('formatDecimal', () => {
  it('null يبقى null (غير متوفر، لا صفر)', () => {
    expect(formatDecimal(null)).toBeNull();
  });
  it('يجمّع الآلاف ويثبت المنازل', () => {
    expect(formatDecimal('84320.5')).toBe('84,320.50');
    expect(formatDecimal('1284', 0)).toBe('1,284');
  });
  it('يقرّب دون المرور بـ float', () => {
    expect(formatDecimal('1.005')).toBe('1.01');
    expect(formatDecimal('99999999999999.995')).toBe('100,000,000,000,000.00');
  });
  it('يحافظ على الإشارة السالبة ولا يعرض -0', () => {
    expect(formatDecimal('-20')).toBe('-20.00');
    expect(formatDecimal('-0.001')).toBe('0.00');
  });
  it('يرفض القيم غير العشرية', () => {
    expect(() => formatDecimal('1e5')).toThrow();
  });
});
