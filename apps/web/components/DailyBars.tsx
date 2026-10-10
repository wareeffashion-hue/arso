import { formatDecimal } from '@/lib/format';

export interface DailyPoint {
  date: string;
  value: string | null;
}

/** أعلى قيمة نصية دون تحويل المبالغ إلى float للحساب؛ الارتفاع النسبي فقط تقريبي للرسم */
function ratio(value: string, max: string): number {
  const v = Number(value);
  const m = Number(max);
  return m > 0 ? v / m : 0;
}

/**
 * أعمدة يومية لسلسلة واحدة (لا محورين رأسيين: كل مقياس في رسم مستقل).
 * اللون من --series-N، والقيم والنصوص بألوان النص. جدول بديل للقراءة الدقيقة وقارئات الشاشة.
 */
export function DailyBars({
  title,
  points,
  series,
  money = false,
  unit,
}: {
  title: string;
  points: DailyPoint[];
  series: 1 | 2;
  money?: boolean;
  unit?: string;
}) {
  const known = points.filter((p): p is { date: string; value: string } => p.value !== null);
  const fmt = (v: string) => formatDecimal(v, money ? 2 : 0) ?? '';
  if (known.length === 0) {
    return (
      <figure className="card chart">
        <figcaption className="chart-title">{title}</figcaption>
        <p className="chart-empty">لا بيانات مستوردة لهذا الرسم بعد.</p>
      </figure>
    );
  }
  const max = known.reduce((m, p) => (Number(p.value) > Number(m) ? p.value : m), known[0]!.value);
  const total = known.length;
  const labelAt = new Set([0, Math.floor((total - 1) / 2), total - 1]);
  return (
    <figure className="card chart" aria-label={`${title}: ${total} يومًا`}>
      <figcaption className="chart-title">
        {title}
        {unit ? <span className="chart-unit"> · {unit}</span> : null}
      </figcaption>
      <div
        className="chart-plot"
        dir="ltr"
        style={{ ['--bar-color' as string]: `var(--series-${series})` }}
      >
        <span className="chart-max num">{fmt(max)}</span>
        <div className="chart-bars" aria-hidden="true">
          {points.map((p) => (
            <div key={p.date} className="chart-col">
              <div
                className="chart-bar"
                style={{
                  height: `${p.value === null ? 0 : Math.max(ratio(p.value, max) * 100, p.value === '0' || /^0(\.0+)?$/.test(p.value) ? 0 : 1.5)}%`,
                }}
              />
              <span className="chart-tip">
                <span className="num">{p.date}</span>
                <b className="num">{p.value === null ? 'غير متوفر' : fmt(p.value)}</b>
              </span>
            </div>
          ))}
        </div>
        <div className="chart-x num" aria-hidden="true">
          {points.map((p, i) => (
            <span key={p.date}>{labelAt.has(i) ? p.date.slice(5) : ''}</span>
          ))}
        </div>
      </div>
      <details className="chart-table">
        <summary>عرض الأرقام جدولًا</summary>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">اليوم</th>
                <th scope="col">{title}</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.date}>
                  <th scope="row">
                    <span className="num">{p.date}</span>
                  </th>
                  <td>
                    <span className="num">{p.value === null ? '—' : fmt(p.value)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
