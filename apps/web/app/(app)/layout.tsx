import { Suspense, type ReactNode } from 'react';
import { Sidebar } from '@/components/Sidebar';
import { Topbar } from '@/components/Topbar';
import { StoreProvider } from '@/lib/store-context';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <Sidebar />
      <Suspense>
        <StoreProvider>
          <div className="shell-main">
            <Topbar />
            <main id="main" className="content">
              {children}
            </main>
          </div>
        </StoreProvider>
      </Suspense>
    </div>
  );
}
