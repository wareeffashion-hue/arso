import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@arso/brand/tokens.css';
import './globals.css';
import { Sidebar } from '@/components/Sidebar';
import { Topbar } from '@/components/Topbar';

export const metadata: Metadata = {
  title: { default: 'أرسو', template: '%s · أرسو' },
  description: 'نرسي نمو متجرك',
  icons: { icon: '/favicon.ico' },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>
        <a href="#main" className="skip-link">
          انتقل إلى المحتوى
        </a>
        <div className="shell">
          <Sidebar />
          <div className="shell-main">
            <Topbar />
            <main id="main" className="content">
              {children}
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}
