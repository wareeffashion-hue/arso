import type { Metadata } from 'next';
import { QualityBadge } from '@/components/QualityBadge';

export const metadata: Metadata = { title: 'صحة البيانات' };

const SOURCES = [
  {
    name: 'متجر سلة',
    need: 'الطلبات والبنود والمنتجات والمتغيرات والمخزون',
    step: 'ربط عبر سلة (قريبًا في هذه البيئة)',
  },
  { name: 'سناب شات', need: 'الحملات والإنفاق اليومي', step: 'ربط حساب الإعلانات' },
  {
    name: 'تكاليف المنتجات',
    need: 'تكلفة كل متغير وتاريخ سريانها',
    step: 'رفع ملف التكاليف أو إدخالها',
  },
];

export default function DataHealthPage() {
  return (
    <>
      <div className="page-head">
        <h1>صحة البيانات</h1>
        <p className="lead">ثقتك بأي رقم تبدأ من هنا: حالة كل مصدر، وما ينقصه، وكيف يُكمَّل.</p>
      </div>
      <div className="table-wrap card">
        <table>
          <thead>
            <tr>
              <th scope="col">المصدر</th>
              <th scope="col">ما نحتاجه منه</th>
              <th scope="col">الحالة</th>
              <th scope="col">الخطوة التالية</th>
            </tr>
          </thead>
          <tbody>
            {SOURCES.map((s) => (
              <tr key={s.name}>
                <th scope="row">{s.name}</th>
                <td>{s.need}</td>
                <td>
                  <QualityBadge quality="unavailable" />
                </td>
                <td>{s.step}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
