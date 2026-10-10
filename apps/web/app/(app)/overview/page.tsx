import type { Metadata } from 'next';
import { Overview } from './Overview';

export const metadata: Metadata = { title: 'نظرة عامة' };

/**
 * النظرة العامة (القسم 13). الأرقام من بيانات مستوردة فقط، بجودتها ومصدرها؛
 * قبل الاستيراد لا أرقام تجريبية تُعرض كأنها حقيقية (AC10).
 */
export default function OverviewPage() {
  return <Overview />;
}
