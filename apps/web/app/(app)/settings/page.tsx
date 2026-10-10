import type { Metadata } from 'next';
import { Settings } from './Settings';

export const metadata: Metadata = { title: 'الإعدادات' };

/** الإعدادات: المتاجر والفريق والصلاحيات. التحقق من الصلاحية في الخادم مع كل طلب */
export default function SettingsPage() {
  return <Settings />;
}
