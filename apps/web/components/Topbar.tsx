'use client';

import { PERIODS, useSelection, type Period } from '@/lib/store-context';

const PERIOD_LABELS: Record<Period, string> = {
  7: 'آخر 7 أيام',
  30: 'آخر 30 يومًا',
  90: 'آخر 90 يومًا',
};

/** الشريط العلوي (القسم 12): المتجر والفترة ظاهران دائمًا، وتغييرهما يغيّر الرابط */
export function Topbar() {
  const sel = useSelection();
  return (
    <header className="topbar">
      <div className="topbar-store">
        <label className="topbar-label" htmlFor="topbar-store">
          المتجر
        </label>
        {sel.state === 'ready' ? (
          sel.stores.length > 1 ? (
            <select
              id="topbar-store"
              className="topbar-select"
              value={sel.store.id}
              onChange={(e) => sel.setStore(e.target.value)}
            >
              {sel.stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          ) : (
            <span id="topbar-store" className="topbar-value">
              {sel.store.name}
            </span>
          )
        ) : (
          <span id="topbar-store" className="topbar-value">
            {sel.state === 'loading' ? '…' : 'لا متجر بعد'}
          </span>
        )}
      </div>
      <div className="topbar-period">
        <label className="topbar-label" htmlFor="topbar-period">
          الفترة
        </label>
        {sel.state === 'ready' ? (
          <select
            id="topbar-period"
            className="topbar-select"
            value={sel.days}
            onChange={(e) => sel.setDays(Number(e.target.value) as Period)}
          >
            {PERIODS.map((p) => (
              <option key={p} value={p}>
                {PERIOD_LABELS[p]}
              </option>
            ))}
          </select>
        ) : (
          <span id="topbar-period" className="topbar-value">
            آخر 30 يومًا
          </span>
        )}
      </div>
    </header>
  );
}
