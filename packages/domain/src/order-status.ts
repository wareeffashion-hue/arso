/**
 * خريطة تأهيل حالات الطلب (القسم 30، `order_status_mapping`). الحالة المصدرية تُحفظ كما هي،
 * والتأهيل يُشتق بإصدار معلن. الحالة غير المعروفة تذهب لمراجعة، ولا تُصنَّف مدفوعة أو ملغاة تلقائيًا.
 * طلب الدفع عند الاستلام لا يصبح إيرادًا محققًا لمجرد إنشائه: «بانتظار الدفع» غير مؤهل.
 */

export const ORDER_STATUS_MAPPING_VERSION = 'salla-csv-1';

export type Eligibility = 'eligible' | 'excluded' | 'needs_review';

const normalize = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[ً-ْـ]/g, '') // التشكيل والتطويل
    .replace(/[إأآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[\s_-]+/g, ' ');

const ELIGIBLE = [
  'completed',
  'delivered',
  'shipped',
  'delivering',
  'in progress',
  'processing',
  'تم التنفيذ',
  'تم التوصيل',
  'تم الشحن',
  'جاري التوصيل',
  'قيد التنفيذ',
  'مكتمل',
];
const EXCLUDED = [
  'canceled',
  'cancelled',
  'payment pending',
  'pending payment',
  'draft',
  'restored',
  'refunded',
  'ملغي',
  'ملغى',
  'بانتظار الدفع',
  'مسترجع',
  'مسودة',
];

const ELIGIBLE_SET = new Set(ELIGIBLE.map(normalize));
const EXCLUDED_SET = new Set(EXCLUDED.map(normalize));

export function classifyOrderStatus(sourceStatus: string): Eligibility {
  const s = normalize(sourceStatus);
  if (ELIGIBLE_SET.has(s)) return 'eligible';
  if (EXCLUDED_SET.has(s)) return 'excluded';
  return 'needs_review';
}
