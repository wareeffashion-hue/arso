import { Decimal } from './money.js';
import type { Permission } from './permissions.js';

/**
 * المشكلات والفرص (القسمان 14 و15). القواعد حتمية وبإصدارات، ولا يحسب الذكاء الاصطناعي
 * أي رقم هنا. البطاقة تفصل الملاحظة الرقمية (حقيقة لها مصدر) عن التفسيرات المحتملة (فرضيات).
 */

export const RULES_VERSION = 'rules-1';

export type ProblemKind =
  | 'quality'
  | 'contribution'
  | 'availability'
  | 'conversion'
  | 'fit'
  | 'delivery'
  | 'content'
  | 'retention';

export const PROBLEM_STATUSES = [
  'new',
  'triaged',
  'accepted',
  'in_progress',
  'measuring',
  'resolved',
  'deferred',
  'rejected',
] as const;
export type ProblemStatus = (typeof PROBLEM_STATUSES)[number];

/** حالات تتطلب سببًا مكتوبًا (القسم 14) */
export const REASON_REQUIRED: ReadonlySet<ProblemStatus> = new Set([
  'resolved',
  'deferred',
  'rejected',
]);
/** حالات مغلقة: لا تظهر في «أهم ثلاث فرص» */
export const CLOSED: ReadonlySet<ProblemStatus> = new Set(['resolved', 'rejected', 'deferred']);

const TRANSITIONS: Readonly<Record<ProblemStatus, readonly ProblemStatus[]>> = {
  new: ['triaged', 'accepted', 'deferred', 'rejected'],
  triaged: ['accepted', 'deferred', 'rejected'],
  accepted: ['in_progress', 'deferred', 'rejected'],
  in_progress: ['measuring', 'resolved', 'deferred'],
  measuring: ['resolved', 'in_progress'],
  deferred: ['triaged', 'accepted'],
  resolved: [],
  rejected: [],
};

export function canTransition(from: ProblemStatus, to: ProblemStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function nextStatuses(from: ProblemStatus): readonly ProblemStatus[] {
  return TRANSITIONS[from];
}

export interface RuleDefinition {
  readonly id: string;
  readonly version: string;
  readonly kind: ProblemKind;
  readonly title: string;
  /** ما يلزم لتشغيل القاعدة؛ يُعرض حين لا تتوفر المدخلات */
  readonly needs: string;
  /** صلاحية قراءة البطاقة (فوق metrics.read) */
  readonly readPermission: Permission | null;
  /** صلاحيات تكفي لإدارة البطاقة (تغيير الحالة والمسؤول) */
  readonly managePermissions: readonly Permission[];
  /** القاعدة قابلة للتشغيل بالمصادر المتاحة الآن */
  readonly runnable: boolean;
}

export const RULES: readonly RuleDefinition[] = [
  {
    id: 'Q01',
    version: '1',
    kind: 'quality',
    title: 'بنود مبيعة بلا تكلفة موثقة',
    needs: 'بنود الطلبات وتكلفة تاريخية لكل متغير',
    readPermission: null,
    managePermissions: ['actions.prepare', 'costs.write'],
    runnable: true,
  },
  {
    id: 'Q02',
    version: '1',
    kind: 'quality',
    title: 'بيانات الطلبات متأخرة',
    needs: 'وقت آخر استيراد أو مزامنة ناجحة',
    readPermission: null,
    managePermissions: ['actions.prepare', 'connections.manage'],
    runnable: true,
  },
  {
    id: 'Q03',
    version: '1',
    kind: 'contribution',
    title: 'تراجع هامش المنتجات بعد تكلفة البضاعة',
    needs: 'فترتان متتاليتان باكتمال تكلفة، و30 طلبًا مؤهلًا في كل فترة',
    readPermission: 'finance.read_summary',
    managePermissions: ['actions.prepare'],
    runnable: true,
  },
  {
    id: 'DQ01',
    version: '1',
    kind: 'quality',
    title: 'طلبات بحالة غير معروفة',
    needs: 'حالات الطلب المصدرية',
    readPermission: null,
    managePermissions: ['actions.prepare', 'connections.manage'],
    runnable: true,
  },
  {
    id: 'DQ02',
    version: '1',
    kind: 'quality',
    title: 'إنفاق بعملة أخرى غير محتسب',
    needs: 'عملة الإنفاق وعملة المتجر',
    readPermission: null,
    managePermissions: ['actions.prepare', 'connections.manage'],
    runnable: true,
  },
  {
    id: 'Q04',
    version: '1',
    kind: 'availability',
    title: 'حملة تقود إلى متغير نافد',
    needs: 'مخزون المتغيرات وربط موثوق بين الحملة والمنتج',
    readPermission: null,
    managePermissions: ['actions.prepare'],
    runnable: false,
  },
  {
    id: 'Q05',
    version: '1',
    kind: 'fit',
    title: 'زيادة استبدال المقاس',
    needs: 'أسباب المرتجع والاستبدال المصنفة، و30 طلبًا مسلّمًا في كل فوج',
    readPermission: null,
    managePermissions: ['actions.prepare'],
    runnable: false,
  },
  {
    id: 'Q06',
    version: '1',
    kind: 'delivery',
    title: 'تأخر عن وعد التسليم',
    needs: 'الوعد المعروض عند الطلب وتوقيت التسليم الفعلي',
    readPermission: null,
    managePermissions: ['actions.prepare'],
    runnable: false,
  },
  {
    id: 'Q07',
    version: '1',
    kind: 'conversion',
    title: 'تراجع مرحلة في القمع',
    needs: 'أحداث متجر متسقة وقياس صالح',
    readPermission: null,
    managePermissions: ['actions.prepare'],
    runnable: false,
  },
  {
    id: 'Q08',
    version: '1',
    kind: 'content',
    title: 'تراجع أداء مادة إعلانية',
    needs: 'نسخ المواد وتوزيعها على الحملات والمخزون في الفترة',
    readPermission: null,
    managePermissions: ['actions.prepare'],
    runnable: false,
  },
];

export function ruleById(id: string): RuleDefinition | undefined {
  return RULES.find((r) => r.id === id);
}

export interface Score {
  readonly impact: number;
  readonly evidence: number;
  readonly fit: number;
  readonly feasibility: number;
}

/** ترتيب داخلي 0–10 بمكوناته؛ لا يُعرض كاحتمال نجاح (القسم 14) */
export function totalScore(s: Score): number {
  return s.impact + s.evidence + s.fit + s.feasibility;
}

/** حد العرض المرصود لـ Q03 (القسم 15): دونه «عينة محدودة» */
export const Q03_MIN_ORDERS = 30;
/** تراجع بالنقاط المئوية يكفي لفتح تشخيص */
export const Q03_MIN_DROP_POINTS = '3';
/** أيام بلا استيراد طلبات تُعد تأخرًا لمصدر ملفات */
export const Q02_STALE_DAYS = 7;

/** نسبة مئوية بمنزلة واحدة من نصين عشريين، أو null */
export function percentOf(part: string, whole: string): string | null {
  const w = new Decimal(whole);
  if (w.isZero()) return null;
  return new Decimal(part).div(w).times(100).toFixed(1);
}

/** أثر Q01 من نسبة القيمة غير المغطاة */
export function q01Impact(uncoveredSharePercent: string): number {
  const s = new Decimal(uncoveredSharePercent);
  if (s.gte(30)) return 3;
  if (s.gte(10)) return 2;
  return s.isZero() ? 0 : 1;
}

/** أثر Q03 من حجم التراجع بالنقاط */
export function q03Impact(dropPoints: string): number {
  const d = new Decimal(dropPoints);
  if (d.gte(8)) return 3;
  if (d.gte(5)) return 2;
  return 1;
}
