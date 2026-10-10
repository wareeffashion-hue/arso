'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV } from '@/lib/nav';

export function Sidebar() {
  const pathname = usePathname();
  return (
    <nav className="sidebar" aria-label="القائمة الرئيسية">
      <Link href="/overview" className="sidebar-logo" aria-label="أرسو، الصفحة الرئيسية">
        <img src="/ARSO_Logo_Light.svg" alt="أرسو" width={88} height={84} />
      </Link>
      <ul>
        {NAV.filter((i) => i.available).map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={active ? 'nav-item active' : 'nav-item'}
                aria-current={active ? 'page' : undefined}
              >
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d={item.icon} />
                </svg>
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
