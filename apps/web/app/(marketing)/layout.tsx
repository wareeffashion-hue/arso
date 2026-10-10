import Link from 'next/link';
import type { ReactNode } from 'react';
import './marketing.css';

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mk">
      <div className="mk-beta" role="note">
        نسخة تجريبية: نبني أرسو الآن، وبعض القدرات المذكورة هنا قيد البناء وموسومة بذلك.
      </div>
      <header className="mk-header">
        <div className="mk-wrap mk-header-inner">
          <Link href="/" className="mk-brand" aria-label="أرسو، الصفحة الرئيسية">
            <img src="/ARSO_Symbol_Black.svg" alt="" width={36} height={36} />
            <span>أرسو</span>
          </Link>
          <nav className="mk-nav" aria-label="أقسام الصفحة">
            <a href="/#how">كيف يعمل</a>
            <a href="/#why">لماذا أرسو</a>
            <a href="/#faq">الأسئلة</a>
          </nav>
          <div className="mk-header-actions">
            <Link href="/sign-in" className="mk-link">
              دخول
            </Link>
            <Link href="/sign-up" className="btn btn-primary">
              ابدأ تشخيص متجرك
            </Link>
          </div>
        </div>
      </header>
      <main id="main">{children}</main>
      <footer className="mk-footer">
        <div className="mk-wrap mk-footer-inner">
          <div>
            <img src="/ARSO_Logo_Dark.svg" alt="أرسو" width={84} height={80} />
            <p>نرسي نمو متجرك</p>
          </div>
          <div>
            <nav className="mk-footer-links" aria-label="روابط قانونية">
              <Link href="/privacy">سياسة الخصوصية</Link>
              <Link href="/terms">شروط الاستخدام</Link>
            </nav>
            <p className="mk-footer-note">منصة سعودية لربحية المتاجر الإلكترونية · © 2026 أرسو</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
