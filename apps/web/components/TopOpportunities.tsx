'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { KIND_LABELS, type Problem, type ProblemList } from '@/lib/problems';

/**
 * أهم ثلاث فرص (القسم 13): البطاقات المفتوحة الأعلى ترتيبًا. لكل بطاقة ما حدث والخطوة،
 * والتفاصيل في صفحة المشكلات والفرص. لا نولّد تفسيرًا قطعيًا هنا.
 */
export function TopOpportunities({ base, href }: { base: string; href: string }) {
  const [state, setState] = useState<
    { key: string; items: Problem[]; waiting: number } | { key: string; failed: true } | null
  >(null);

  useEffect(() => {
    let live = true;
    api<ProblemList>(base)
      .then(
        (r) =>
          live &&
          setState({
            key: base,
            items: r.items.filter((p) => p.open && !p.conditionClearedAt).slice(0, 3),
            waiting: r.waiting.length,
          }),
      )
      .catch(() => live && setState({ key: base, failed: true }));
    return () => {
      live = false;
    };
  }, [base]);

  const s = state?.key === base ? state : null;
  return (
    <section aria-labelledby="top-title" className="section">
      <h2 id="top-title" className="section-title">
        أهم ثلاث فرص
      </h2>
      {!s ? (
        <div className="card skeleton skeleton-card" aria-busy="true" />
      ) : 'failed' in s ? (
        <p className="alert alert-error" role="alert">
          <span aria-hidden="true">✕ </span>
          تعذّر تحميل الفرص الآن.
        </p>
      ) : s.items.length === 0 ? (
        <p className="card settings-note">
          لا مشكلات مفتوحة في البيانات المتاحة. {s.waiting} قواعد تنتظر بيانات إضافية (المخزون
          والتسليم والقمع). <Link href={href}>التفاصيل</Link>
        </p>
      ) : (
        <ol className="top-list">
          {s.items.map((p, i) => (
            <li key={p.id} className="card">
              <span className="top-rank num" aria-hidden="true">
                {i + 1}
              </span>
              <div>
                <p className="field-hint">
                  {KIND_LABELS[p.kind]} · <span className="num">{p.score.total}/10</span>
                  {p.quality === 'limited_sample' ? ' · عينة محدودة' : ''}
                </p>
                <h3>{p.title}</h3>
                <p className="top-fact">{p.observation.text}</p>
                <p className="top-action">
                  <b>الخطوة:</b> {p.action}
                </p>
                <Link href={`${href}#${p.id}`}>الدليل والفحوص</Link>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
