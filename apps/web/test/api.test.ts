import { describe, expect, it } from 'vitest';
import { safeNext } from '../lib/api';

describe('safeNext: لا إعادة توجيه لموقع خارجي بعد الدخول', () => {
  it('يقبل المسارات الداخلية', () => {
    expect(safeNext('/invite/accept?token=x')).toBe('/invite/accept?token=x');
  });
  it('يرفض الروابط الخارجية والملتوية', () => {
    for (const bad of [
      'https://evil.sa',
      '//evil.sa',
      '/\\evil.sa',
      'javascript:alert(1)',
      '',
      null,
    ]) {
      expect(safeNext(bad)).toBe('/overview');
    }
  });
});
