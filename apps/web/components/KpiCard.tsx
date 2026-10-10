import type { Quality } from '@arso/domain';
import { formatDecimal } from '@/lib/format';
import { QualityBadge } from './QualityBadge';
import { Riyal } from './Riyal';

export interface KpiCardProps {
  label: string;
  value: string | null;
  quality: Quality;
  money?: boolean;
  fractionDigits?: number;
  /** سبب غياب القيمة أو حدودها، يظهر تحت الرقم */
  note?: string;
}

/**
 * بطاقة مقياس (القسم 13). القيمة null تظهر «غير متوفر» بوضوح،
 * ولا تُرسم صفرًا أبدًا (مبدأ: الغياب ليس صفرًا).
 */
export function KpiCard({
  label,
  value,
  quality,
  money = false,
  fractionDigits = 2,
  note,
}: KpiCardProps) {
  const formatted = formatDecimal(value, money ? fractionDigits : 0);
  return (
    <article className="card kpi" aria-label={label}>
      <header className="kpi-label">
        <span>{label}</span>
        <QualityBadge quality={quality} />
      </header>
      {formatted === null ? (
        <p className="kpi-value kpi-missing">غير متوفر</p>
      ) : (
        <p className="kpi-value">
          <span className="num">{formatted}</span>
          {money ? <Riyal /> : null}
        </p>
      )}
      {note ? <p className="kpi-note">{note}</p> : null}
    </article>
  );
}
