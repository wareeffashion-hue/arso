'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiRequestError } from './api';

export interface Org {
  id: string;
  name: string;
  role: string;
}
export interface Store {
  id: string;
  name: string;
  timezone: string;
  currency: string;
}

export const PERIODS = [7, 30, 90] as const;
export type Period = (typeof PERIODS)[number];

export type Selection =
  | { state: 'loading' }
  | { state: 'error'; retry: () => void }
  | { state: 'no-org' }
  | { state: 'no-store'; org: Org }
  | {
      state: 'ready';
      org: Org;
      stores: Store[];
      store: Store;
      days: Period;
      setStore: (id: string) => void;
      setDays: (d: Period) => void;
    };

const Ctx = createContext<Selection>({ state: 'loading' });
const LAST_STORE = 'arso.lastStore';

function readLast(): string | null {
  try {
    return localStorage.getItem(LAST_STORE);
  } catch {
    return null;
  }
}
function writeLast(id: string) {
  try {
    localStorage.setItem(LAST_STORE, id);
  } catch {
    // تفضيل محلي فقط؛ غيابه لا يعطل شيئًا
  }
}

/**
 * المتجر والفترة المختاران (القسم 12). المصدر هو الرابط (?store=&days=) فيُشارك ويُحفظ،
 * والصفحات تجلب بياناتها بمفتاح المتجر، فلا تظهر بيانات متجر سابق بعد التبديل (AC14).
 */
export function StoreProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [base, setBase] = useState<
    { state: 'loading' | 'error' | 'no-org' } | { state: 'loaded'; org: Org; stores: Store[] }
  >({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const me = await api<{ organizations: Org[] }>('/api/v1/me');
        const org = me.organizations[0];
        if (!org) {
          if (live) setBase({ state: 'no-org' });
          return;
        }
        const s = await api<{ items: Store[] }>(`/api/v1/organizations/${org.id}/stores`);
        if (live) setBase({ state: 'loaded', org, stores: s.items });
      } catch (e) {
        if (e instanceof ApiRequestError && e.status === 401) {
          router.push(`/sign-in?next=${encodeURIComponent(pathname)}`);
          return;
        }
        if (live) setBase({ state: 'error' });
      }
    })();
    return () => {
      live = false;
    };
  }, [attempt, pathname, router]);

  const navigate = useCallback(
    (next: { store?: string; days?: number }) => {
      const q = new URLSearchParams(params.toString());
      if (next.store) q.set('store', next.store);
      if (next.days) q.set('days', String(next.days));
      router.replace(`${pathname}?${q.toString()}`, { scroll: false });
    },
    [params, pathname, router],
  );

  const value = useMemo<Selection>(() => {
    if (base.state === 'loading') return { state: 'loading' };
    if (base.state === 'error') return { state: 'error', retry: () => setAttempt((a) => a + 1) };
    if (base.state !== 'loaded') return { state: 'no-org' };
    const { org, stores } = base;
    if (stores.length === 0) return { state: 'no-store', org };
    const wanted = params.get('store') ?? readLast();
    const store = stores.find((s) => s.id === wanted) ?? stores[0]!;
    const d = Number(params.get('days'));
    const days = (PERIODS as readonly number[]).includes(d) ? (d as Period) : 30;
    return {
      state: 'ready',
      org,
      stores,
      store,
      days,
      setStore: (id) => {
        writeLast(id);
        navigate({ store: id });
      },
      setDays: (n) => navigate({ days: n }),
    };
  }, [base, params, navigate]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSelection(): Selection {
  return useContext(Ctx);
}

/** رابط داخلي يحفظ المتجر والفترة الحاليين */
export function withSelection(href: string, sel: Selection): string {
  if (sel.state !== 'ready') return href;
  return `${href}?store=${sel.store.id}&days=${sel.days}`;
}
