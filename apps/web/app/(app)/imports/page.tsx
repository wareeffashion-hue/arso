import type { Metadata } from 'next';
import { Imports } from './Imports';

export const metadata: Metadata = { title: 'استيراد البيانات' };

/** استيراد CSV (الملحق ب): معاينة بأسباب الرفض، ثم اعتماد مرتبط ببصمة الملف */
export default function ImportsPage() {
  return (
    <>
      <div className="page-head">
        <h1>استيراد البيانات</h1>
        <p className="lead">
          ارفع ملفاتك بقوالب أرسو. نعرض لك ما سيتغير قبل أن يُكتب أي شيء، والملف نفسه لا يُحتسب
          مرتين.
        </p>
      </div>
      <Imports />
    </>
  );
}
