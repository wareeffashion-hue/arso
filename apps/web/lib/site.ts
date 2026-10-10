/**
 * العنوان العام للموقع في الروابط المطلقة (sitemap وOpen Graph). يُضبط وقت البناء
 * بـ PUBLIC_SITE_URL؛ والافتراضي الدومين المعتمد.
 */
export const SITE_URL = (process.env.PUBLIC_SITE_URL ?? 'https://arso.sa').replace(/\/$/, '');
