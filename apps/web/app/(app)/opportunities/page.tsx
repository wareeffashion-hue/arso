import type { Metadata } from 'next';
import { Opportunities } from './Opportunities';

export const metadata: Metadata = { title: 'المشكلات والفرص' };

/** المشكلات والفرص (القسمان 14 و15): قواعد بإصدارات على بياناتك، والحقيقة منفصلة عن الفرضية */
export default function OpportunitiesPage() {
  return (
    <>
      <div className="page-head">
        <h1>المشكلات والفرص</h1>
        <p className="lead">
          ما تكشفه القواعد في بياناتك، مرتبًا حسب الأثر وقوة الدليل. لكل بطاقة دليلها وفحوصها قبل أي
          قرار.
        </p>
      </div>
      <Opportunities />
    </>
  );
}
