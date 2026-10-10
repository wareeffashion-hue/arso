import { describe, expect, it } from 'vitest';
import {
  canTransition,
  percentOf,
  q01Impact,
  q03Impact,
  REASON_REQUIRED,
  RULES,
  totalScore,
} from '../src/index.js';

describe('قواعد التشخيص', () => {
  it('كل قاعدة بمعرف فريد وإصدار، وQ04–Q08 تنتظر بيانات', () => {
    expect(new Set(RULES.map((r) => r.id)).size).toBe(RULES.length);
    expect(RULES.filter((r) => !r.runnable).map((r) => r.id)).toEqual([
      'Q04',
      'Q05',
      'Q06',
      'Q07',
      'Q08',
    ]);
  });

  it('Q03 مالية: لا تُقرأ بلا ملخص المساهمة', () => {
    expect(RULES.find((r) => r.id === 'Q03')!.readPermission).toBe('finance.read_summary');
  });

  it('الترتيب 0–10 بمكوناته', () => {
    expect(totalScore({ impact: 3, evidence: 3, fit: 2, feasibility: 2 })).toBe(10);
    expect(q01Impact('35.0')).toBe(3);
    expect(q01Impact('12.5')).toBe(2);
    expect(q01Impact('0.4')).toBe(1);
    expect(q03Impact('9')).toBe(3);
    expect(q03Impact('3.2')).toBe(1);
  });

  it('الانتقالات محددة، والمغلق لا يُفتح', () => {
    expect(canTransition('new', 'accepted')).toBe(true);
    expect(canTransition('new', 'resolved')).toBe(false);
    expect(canTransition('resolved', 'new')).toBe(false);
    expect(REASON_REQUIRED.has('deferred')).toBe(true);
  });

  it('النسبة بلا قسمة على صفر', () => {
    expect(percentOf('1', '3')).toBe('33.3');
    expect(percentOf('1', '0')).toBeNull();
  });
});
