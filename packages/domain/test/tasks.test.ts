import { describe, expect, it } from 'vitest';
import { canMoveTask, taskNextStatuses } from '../src/index.js';

const manager = { canManage: true, isAssignee: false };
const assignee = { canManage: false, isAssignee: true };
const other = { canManage: false, isAssignee: false };

describe('انتقالات المهام', () => {
  it('المسار الكامل للإدارة، والنهائي لا يُفتح', () => {
    expect(canMoveTask('open', 'assigned', manager)).toBe(true);
    expect(canMoveTask('review', 'accepted', manager)).toBe(true);
    expect(canMoveTask('open', 'accepted', manager)).toBe(false);
    expect(taskNextStatuses('accepted')).toEqual([]);
  });

  it('المسؤول يبدأ ويسلّم للمراجعة فقط، ولا يقبل عمله بنفسه', () => {
    expect(canMoveTask('assigned', 'in_progress', assignee)).toBe(true);
    expect(canMoveTask('in_progress', 'review', assignee)).toBe(true);
    expect(canMoveTask('review', 'accepted', assignee)).toBe(false);
    expect(canMoveTask('assigned', 'cancelled', assignee)).toBe(false);
  });

  it('غير المسؤول بلا صلاحية لا يحرك شيئًا', () => {
    expect(canMoveTask('assigned', 'in_progress', other)).toBe(false);
  });
});
