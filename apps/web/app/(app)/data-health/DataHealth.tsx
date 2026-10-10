'use client';

import type { Quality } from '@arso/domain';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { QualityBadge } from '@/components/QualityBadge';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/labels';
import { useSelection, withSelection } from '@/lib/store-context';

interface Status {
  orders: { lastImportAt: string | null; present: boolean };
  costs: { lastImportAt: string | null; variants: number };
  adSpend: { lastImportAt: string | null; present: boolean };
  ordersInPeriod: { eligible: number; excluded: number; needsReview: number };
}
interface Row {
  name: string;
  need: string;
  quality: Quality;
  detail: string;
  step: string;
  href?: string;
}

export function DataHealth() {
  const sel = useSelection();
  const [status, setStatus] = useState<{ key: string; data: Status | null; failed: boolean }>({
    key: '',
    data: null,
    failed: false,
  });
  const key = sel.state === 'ready' ? sel.store.id : '';

  useEffect(() => {
    if (sel.state !== 'ready') return;
    let live = true;
    const k = sel.store.id;
    api<{ dataStatus: Status }>(`/api/v1/organizations/${sel.org.id}/stores/${k}/overview?days=30`)
      .then((r) => live && setStatus({ key: k, data: r.dataStatus, failed: false }))
      .catch(() => live && setStatus({ key: k, data: null, failed: true }));
    return () => {
      live = false;
    };
  }, [sel]);

  if (sel.state === 'no-org' || sel.state === 'no-store') {
    return (
      <p className="card settings-note">
        أضف متجرًا من{' '}
        <Link href={sel.state === 'no-org' ? '/onboarding' : '/settings'}>الإعدادات</Link> لتظهر
        حالة مصادره.
      </p>
    );
  }
  const s = status.key === key ? status.data : null;
  if (sel.state === 'error' || (status.key === key && status.failed)) {
    return (
      <p className="alert alert-error" role="alert">
        <span aria-hidden="true">✕ </span>
        تعذّر تحميل حالة البيانات. أعد تحميل الصفحة بعد لحظة.
      </p>
    );
  }
  if (!s)
    return (
      <div className="card skeleton skeleton-card" aria-busy="true" aria-label="جارٍ التحميل" />
    );

  const imports = withSelection('/imports', sel);
  const at = (v: string | null) => (v ? `آخر استيراد ${formatDateTime(v)}` : 'لم يُستورد بعد');
  const rows: Row[] = [
    {
      name: 'الطلبات',
      need: 'البنود والحالة والإيراد دون ضريبة والشحن المحصّل',
      quality: s.orders.present
        ? s.ordersInPeriod.needsReview
          ? 'incomplete'
          : 'complete'
        : 'unavailable',
      detail: s.orders.present
        ? `${at(s.orders.lastImportAt)}${s.ordersInPeriod.needsReview ? ` · ${s.ordersInPeriod.needsReview} بحالة غير معروفة` : ''}`
        : 'لم يُستورد بعد',
      step: s.orders.present ? 'حدّث الملف دوريًا' : 'ارفع ملف الطلبات',
      href: imports,
    },
    {
      name: 'تكاليف المنتجات',
      need: 'تكلفة كل متغير دون ضريبة وتاريخ سريانها',
      quality: s.costs.variants ? 'complete' : 'unavailable',
      detail: s.costs.variants
        ? `${s.costs.variants} متغيرًا · ${at(s.costs.lastImportAt)}`
        : 'لم يُستورد بعد',
      step: 'التغطية تظهر في النظرة العامة',
      href: imports,
    },
    {
      name: 'الإنفاق الإعلاني',
      need: 'الإنفاق اليومي لكل حملة بمنطقة الحساب وعملته',
      quality: s.adSpend.present ? 'complete' : 'unavailable',
      detail: at(s.adSpend.lastImportAt),
      step: s.adSpend.present ? 'حدّث الملف دوريًا' : 'ارفع ملف الإنفاق',
      href: imports,
    },
    {
      name: 'تكاليف الطلب المتغيرة',
      need: 'شحن الناقل ورسوم الدفع والتغليف',
      quality: 'unavailable',
      detail: 'لا مصدر لها بعد',
      step: 'تأتي مع ربط سلة ومزودي الشحن',
    },
    {
      name: 'ربط سلة المباشر',
      need: 'مزامنة الطلبات والمرتجعات تلقائيًا',
      quality: 'unavailable',
      detail: 'قيد البناء',
      step: 'الاستيراد بالملفات متاح الآن',
    },
  ];
  return (
    <div className="table-wrap card">
      <table>
        <thead>
          <tr>
            <th scope="col">المصدر</th>
            <th scope="col">ما نحتاجه منه</th>
            <th scope="col">الحالة</th>
            <th scope="col">التفاصيل</th>
            <th scope="col">الخطوة التالية</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name}>
              <th scope="row">{r.name}</th>
              <td>{r.need}</td>
              <td>
                <QualityBadge quality={r.quality} />
              </td>
              <td>{r.detail}</td>
              <td>{r.href ? <Link href={r.href}>{r.step}</Link> : r.step}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
