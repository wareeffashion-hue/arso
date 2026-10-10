export function Topbar() {
  return (
    <header className="topbar">
      <div className="topbar-store">
        <span className="topbar-label">المتجر</span>
        <span className="topbar-value">لم يُربط متجر بعد</span>
      </div>
      <div className="topbar-period">
        <span className="topbar-label">الفترة</span>
        <span className="topbar-value">آخر 30 يومًا</span>
      </div>
    </header>
  );
}
