import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState } from '@/components/EmptyState';
import { KpiCard } from '@/components/KpiCard';

export const metadata: Metadata = { title: 'نظرة عامة' };

/**
 * النظرة العامة (القسم 13). قبل ربط المتجر لا نعرض أرقامًا تجريبية كأنها حقيقية
 * (AC10): كل بطاقة «غير متوفر» مع الخطوة اللازمة.
 */
export default function OverviewPage() {
  return (
    <>
      <div className="page-head">
        <h1>نظرة عامة</h1>
        <p className="lead">صورة متجرك الحقيقية: ما تبيعه، وما تنفقه، وما يبقى لك.</p>
      </div>

      <EmptyState
        title="اربط متجرك لترى أول قراءة حقيقية"
        body="أرسو يستورد آخر 90 يومًا من طلباتك ومنتجاتك، ثم يطابقها مع إنفاقك الإعلاني وتكاليفك. لن نعرض أي رقم قبل أن يكون له مصدر."
        action={
          <div className="actions">
            <Link className="btn btn-primary" href="/data-health">
              ابدأ الربط
            </Link>
            <Link className="btn btn-ghost" href="/data-health">
              ما البيانات التي نحتاجها؟
            </Link>
          </div>
        }
      />

      <section aria-labelledby="kpis-title" className="section">
        <h2 id="kpis-title" className="section-title">
          المؤشرات الأساسية
        </h2>
        <div className="kpi-grid">
          <KpiCard
            label="صافي مبيعات المنتجات"
            value={null}
            quality="unavailable"
            money
            note="يظهر بعد ربط المتجر"
          />
          <KpiCard
            label="الإنفاق الإعلاني"
            value={null}
            quality="unavailable"
            money
            note="يظهر بعد ربط حساب إعلاني"
          />
          <KpiCard
            label="المساهمة بعد التسويق"
            value={null}
            quality="unavailable"
            money
            note="تحتاج المبيعات والإنفاق والتكاليف"
          />
          <KpiCard
            label="طلبات مؤهلة"
            value={null}
            quality="unavailable"
            note="يظهر بعد ربط المتجر"
          />
        </div>
      </section>
    </>
  );
}
