export default function Loading() {
  return (
    <div className="skeleton-page" aria-busy="true" aria-label="جارٍ التحميل">
      <div className="skeleton skeleton-title" />
      <div className="kpi-grid">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card skeleton skeleton-card" />
        ))}
      </div>
    </div>
  );
}
