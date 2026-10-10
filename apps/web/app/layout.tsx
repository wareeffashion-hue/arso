import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@arso/brand/tokens.css';
import './globals.css';
import { SITE_URL } from '@/lib/site';

export const metadata: Metadata = {
  title: { default: 'أرسو', template: '%s · أرسو' },
  description:
    'منصة سعودية لربحية المتاجر الإلكترونية: اعرف ما يبقى لك من كل طلب، واكتشف أهم الفرص بالدليل.',
  metadataBase: new URL(SITE_URL),
  icons: { icon: '/favicon.ico' },
  openGraph: {
    type: 'website',
    locale: 'ar_SA',
    siteName: 'أرسو',
    title: 'أرسو · نرسي نمو متجرك',
    description: 'اعرف ما يبقى لك من كل طلب، واكتشف أهم الفرص بالدليل.',
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>
        <a href="#main" className="skip-link">
          انتقل إلى المحتوى
        </a>
        {children}
      </body>
    </html>
  );
}
