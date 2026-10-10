import type { Metadata } from 'next';
import { DataHealth } from './DataHealth';

export const metadata: Metadata = { title: 'صحة البيانات' };

export default function DataHealthPage() {
  return (
    <>
      <div className="page-head">
        <h1>صحة البيانات</h1>
        <p className="lead">ثقتك بأي رقم تبدأ من هنا: حالة كل مصدر، وما ينقصه، وكيف يُكمَّل.</p>
      </div>
      <DataHealth />
    </>
  );
}
