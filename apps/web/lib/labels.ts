import type { Permission, Role } from '@arso/domain';

/** أسماء الأدوار كما يراها التاجر (القسم 9) */
export const ROLE_LABELS: Readonly<Record<Role, string>> = {
  owner: 'مالك',
  marketing_manager: 'مدير تسويق',
  analyst: 'محلل',
  finance: 'مالية',
  creative: 'منتج إبداعي',
  operations: 'تشغيل وخدمة',
  agency: 'وكالة',
};

/** شرح الصلاحيات بلغة التاجر، لا بأسمائها التقنية */
export const PERMISSION_LABELS: Readonly<Record<Permission, string>> = {
  'metrics.read': 'قراءة المؤشرات',
  'finance.read_summary': 'ملخص المساهمة والربحية',
  'costs.read': 'قراءة التكاليف التفصيلية',
  'costs.write': 'تعديل التكاليف',
  'pii.read': 'بيانات العملاء الشخصية',
  'creative.write': 'إدارة المواد الإبداعية',
  'experiments.write': 'إعداد التجارب',
  'connections.manage': 'إدارة الربط',
  'campaigns.read': 'قراءة الحملات',
  'actions.prepare': 'تحضير الإجراءات',
  'actions.approve': 'اعتماد الإجراءات',
  'rules.manage': 'إدارة القواعد',
  'members.manage': 'إدارة الفريق',
  'exports.create': 'التصدير',
  'services.manage': 'إدارة الخدمات',
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role as Role] ?? role;
}

/** المناطق الزمنية المعروضة لإنشاء متجر؛ الخادم يقبل أي منطقة IANA صحيحة */
export const TIMEZONE_OPTIONS = [
  { value: 'Asia/Riyadh', label: 'الرياض' },
  { value: 'Asia/Dubai', label: 'دبي' },
  { value: 'Asia/Kuwait', label: 'الكويت' },
  { value: 'Asia/Bahrain', label: 'البحرين' },
  { value: 'Asia/Qatar', label: 'قطر' },
  { value: 'Asia/Muscat', label: 'مسقط' },
] as const;

export const CURRENCY_OPTIONS = [
  { value: 'SAR', label: 'ريال سعودي' },
  { value: 'AED', label: 'درهم إماراتي' },
  { value: 'KWD', label: 'دينار كويتي' },
  { value: 'BHD', label: 'دينار بحريني' },
  { value: 'QAR', label: 'ريال قطري' },
  { value: 'OMR', label: 'ريال عماني' },
  { value: 'USD', label: 'دولار أمريكي' },
  { value: 'EUR', label: 'يورو' },
] as const;

/** تاريخ انتهاء الدعوة بتوقيت الرياض، بأرقام غربية */
export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('ar-SA-u-nu-latn-ca-gregory', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Riyadh',
  }).format(new Date(iso));
}
