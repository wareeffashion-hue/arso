import Link from 'next/link';

export default function NotFound() {
  return (
    <section className="card empty">
      <h2>الصفحة غير موجودة</h2>
      <p>ربما نُقلت أو لم تُطلق بعد.</p>
      <Link className="btn btn-primary" href="/overview">
        العودة للنظرة العامة
      </Link>
    </section>
  );
}
