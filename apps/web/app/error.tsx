'use client';

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <section className="card empty" role="alert">
      <h2>تعذّر تحميل هذه الصفحة</h2>
      <p>بياناتك محفوظة. أعد المحاولة، وإن تكرر الخطأ فريقنا يتابعه.</p>
      <button type="button" className="btn btn-primary" onClick={reset}>
        إعادة المحاولة
      </button>
    </section>
  );
}
