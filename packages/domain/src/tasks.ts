/**
 * المهام (القسم 28): حالات وانتقالات ومن يحق له كل انتقال. قبول العمل (accepted) يعني أنه
 * سُلّم حسب معياره، ولا يعني نجاحه التجاري؛ ذاك يُقاس بالتجربة أو المؤشر لاحقًا.
 */

export const TASK_STATUSES = [
  'open',
  'assigned',
  'in_progress',
  'review',
  'accepted',
  'cancelled',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_FINAL: ReadonlySet<TaskStatus> = new Set(['accepted', 'cancelled']);

const TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  open: ['assigned', 'cancelled'],
  assigned: ['in_progress', 'open', 'cancelled'],
  in_progress: ['review', 'cancelled'],
  review: ['accepted', 'in_progress', 'cancelled'],
  accepted: [],
  cancelled: [],
};

/** انتقالات يملكها المسؤول عن المهمة نفسه، دون صلاحية الإدارة */
const ASSIGNEE_TRANSITIONS: ReadonlySet<string> = new Set([
  'assigned>in_progress',
  'in_progress>review',
]);

export function taskNextStatuses(from: TaskStatus): readonly TaskStatus[] {
  return TASK_TRANSITIONS[from];
}

export function canMoveTask(
  from: TaskStatus,
  to: TaskStatus,
  actor: { canManage: boolean; isAssignee: boolean },
): boolean {
  if (!TASK_TRANSITIONS[from].includes(to)) return false;
  if (actor.canManage) return true;
  return actor.isAssignee && ASSIGNEE_TRANSITIONS.has(`${from}>${to}`);
}
