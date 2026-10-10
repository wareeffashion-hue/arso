/**
 * الملاحة (القسم 12). تظهر فقط الصفحات المتاحة في الإصدار الحالي؛
 * لا نعرض صفحة مستقبلية توحي بأنها ميزة متاحة (القسم 5).
 */
export interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: string;
  readonly available: boolean;
}

export const NAV: readonly NavItem[] = [
  { href: '/overview', label: 'نظرة عامة', icon: 'M3 12l9-8 9 8M5 10v10h14V10', available: true },
  {
    href: '/opportunities',
    label: 'المشكلات والفرص',
    icon: 'M12 3l9 16H3zM12 10v4M12 17h.01',
    available: true,
  },
  {
    href: '/campaigns',
    label: 'الحملات',
    icon: 'M3 11v2l13 5V6zM16 9a3 3 0 010 6',
    available: false,
  },
  {
    href: '/products',
    label: 'المنتجات',
    icon: 'M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 4 8-4M12 11v10',
    available: false,
  },
  {
    href: '/customers',
    label: 'العملاء',
    icon: 'M16 19v-1a4 4 0 00-8 0v1M12 11a3 3 0 100-6 3 3 0 000 6',
    available: false,
  },
  {
    href: '/experiments',
    label: 'التجارب',
    icon: 'M9 3h6M10 3v6l-5 9a2 2 0 002 3h10a2 2 0 002-3l-5-9V3',
    available: false,
  },
  {
    href: '/tasks',
    label: 'المهام',
    icon: 'M9 11l3 3 8-8M20 12v7a2 2 0 01-2 2H6a2 2 0 01-2-2V5a2 2 0 012-2h9',
    available: true,
  },
  {
    href: '/reports',
    label: 'التقارير',
    icon: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
    available: false,
  },
  {
    href: '/imports',
    label: 'استيراد البيانات',
    icon: 'M12 3v12M7 10l5 5 5-5M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2',
    available: true,
  },
  { href: '/data-health', label: 'صحة البيانات', icon: 'M3 12h4l3-7 4 14 3-7h4', available: true },
  {
    href: '/settings',
    label: 'الإعدادات',
    icon: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
    available: true,
  },
];
