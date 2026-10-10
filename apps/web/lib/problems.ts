import type { ProblemKind, ProblemStatus } from '@arso/domain';

export interface Problem {
  id: string;
  ruleId: string;
  ruleVersion: string;
  kind: ProblemKind;
  status: ProblemStatus;
  open: boolean;
  score: { impact: number; evidence: number; fit: number; feasibility: number; total: number };
  quality: 'complete' | 'limited_sample';
  title: string;
  observation: { text: string; values: Record<string, string | number | null> };
  evidence: { label: string; value: string; detail?: string }[];
  hypotheses: { text: string; signal: 'consistent' | 'not_indicated' | 'unknown' }[];
  checks: string[];
  action: string;
  period: { start: string | null; end: string | null };
  owner: { id: string; name: string } | null;
  dueOn: string | null;
  statusReason: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  conditionClearedAt: string | null;
  revision: number;
  canManage: boolean;
  events?: {
    kind: string;
    fromStatus: string | null;
    toStatus: string | null;
    body: string | null;
    actor: string | null;
    at: string;
  }[];
}

export interface ProblemList {
  evaluatedAt: string | null;
  items: Problem[];
  waiting: { id: string; title: string; kind: ProblemKind; needs: string }[];
  hiddenRules: string[];
}

export const STATUS_LABELS: Record<ProblemStatus, string> = {
  new: 'جديدة',
  triaged: 'فُرزت',
  accepted: 'مقبولة',
  in_progress: 'قيد التنفيذ',
  measuring: 'قيد القياس',
  resolved: 'حُلّت',
  deferred: 'مؤجلة',
  rejected: 'مرفوضة',
};

export const KIND_LABELS: Record<ProblemKind, string> = {
  quality: 'جودة بيانات',
  contribution: 'ربحية',
  availability: 'توفر',
  conversion: 'تحويل',
  fit: 'مقاس واختيار',
  delivery: 'تسليم',
  content: 'محتوى',
  retention: 'احتفاظ',
};

export const SIGNAL_LABELS = {
  consistent: { text: 'الأرقام تتسق معها', icon: '◆' },
  not_indicated: { text: 'الأرقام لا تشير إليها', icon: '◇' },
  unknown: { text: 'لم تُفحص بعد', icon: '?' },
} as const;

export const SCORE_PARTS = [
  { key: 'impact', label: 'الأثر', max: 3 },
  { key: 'evidence', label: 'قوة الدليل', max: 3 },
  { key: 'fit', label: 'ملاءمة الهدف', max: 2 },
  { key: 'feasibility', label: 'قابلية التنفيذ', max: 2 },
] as const;
