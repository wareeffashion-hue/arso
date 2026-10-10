import type { Metadata } from 'next';
import { Tasks } from './Tasks';

export const metadata: Metadata = { title: 'المهام' };

/** المهام (القسم 28): مسؤول وموعد ومعيار تسليم ونتيجة، وقد تنشأ من بطاقة مشكلة */
export default function TasksPage() {
  return (
    <>
      <div className="page-head">
        <h1>المهام</h1>
        <p className="lead">كل خطوة لها مسؤول وموعد ومعيار تسليم، ونتيجة تُكتب عند القبول.</p>
      </div>
      <Tasks />
    </>
  );
}
