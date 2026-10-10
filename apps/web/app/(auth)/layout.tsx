import type { ReactNode } from 'react';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main id="main" className="auth-page">
      <div className="auth-card card">
        <img src="/ARSO_Logo_Light.svg" alt="أرسو" className="auth-logo" width={96} height={92} />
        {children}
      </div>
      <p className="auth-tagline">نرسي نمو متجرك</p>
    </main>
  );
}
