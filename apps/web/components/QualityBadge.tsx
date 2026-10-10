import type { Quality } from '@arso/domain';

const LABELS: Record<Quality, { text: string; icon: string; tone: string }> = {
  complete: { text: 'مكتمل', icon: '✓', tone: 'ok' },
  incomplete: { text: 'جزئي', icon: '◐', tone: 'partial' },
  unavailable: { text: 'غير متوفر', icon: '○', tone: 'missing' },
  stale: { text: 'متأخر', icon: '↻', tone: 'stale' },
  limited_sample: { text: 'عينة محدودة', icon: '◔', tone: 'partial' },
};

/** شارة الجودة: أيقونة ونص دائمًا، فاللون لا يحمل المعنى وحده */
export function QualityBadge({ quality }: { quality: Quality }) {
  const l = LABELS[quality];
  return (
    <span className={`badge badge-${l.tone}`}>
      <span aria-hidden="true">{l.icon}</span> {l.text}
    </span>
  );
}
