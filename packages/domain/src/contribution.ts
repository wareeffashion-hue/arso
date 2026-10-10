import { totalsByGroup, type FinancialEntry } from './ledger.js';
import type { MetricValue } from './metric.js';
import { Money, type CurrencyCode } from './money.js';

export const CONTRIBUTION_DEFINITION_VERSION = '1.0';

/**
 * تغطية التكلفة (cost_coverage_value): قيمة البنود ذات تكلفة موثقة ÷ قيمة البنود التي تحتاج تكلفة.
 * منتج بلا تكلفة يبقى بلا تكلفة، و«مجاني» يحتاج تكلفة صفر مؤكدة (القسم 31).
 */
export interface CostCoverage {
  readonly linesRequiringCost: number;
  readonly linesWithCost: number;
  readonly valueRequiringCost: Money;
  readonly valueWithCost: Money;
}

export interface ContributionResult {
  readonly preMarketing: MetricValue;
  readonly postMarketing: MetricValue;
  /** مساهمة البنود المكتملة فقط: رقم ثانوي يُعرض بعنوان «على البنود المكتملة فقط» (القسم 43) */
  readonly completeLinesOnly: { preMarketing: string; postMarketing: string } | null;
  readonly coverageRatio: string | null;
}

function coverageRatio(c: CostCoverage): string | null {
  if (c.valueRequiringCost.isZero()) return c.linesRequiringCost === 0 ? '1' : null;
  return c.valueWithCost.amount.div(c.valueRequiringCost.amount).toDecimalPlaces(4).toString();
}

/**
 * مساهمة قبل التسويق = الإيراد المعتمد − تكلفة البضاعة الصافية − تكاليف الطلب المتغيرة الصافية.
 * مساهمة بعد التسويق = ما سبق − تكاليف التسويق المحددة.
 * إن نقصت التكلفة لأي بند، القيمة null وجودتها incomplete؛ لا تُحسب ربحية على تكاليف صفرية (AC01).
 */
export function computeContribution(
  entries: readonly FinancialEntry[],
  coverage: CostCoverage,
  currency: CurrencyCode,
  /** حركات البنود ذات التكلفة الموثقة فقط، لحساب الرقم الثانوي. بدونها لا يُعرض رقم ثانوي */
  completeLineEntries?: readonly FinancialEntry[],
): ContributionResult {
  const t = totalsByGroup(entries, currency);
  const pre = t.revenue.minus(t.variableCost);
  const post = pre.minus(t.marketing);
  const ratio = coverageRatio(coverage);
  const complete = coverage.linesWithCost >= coverage.linesRequiringCost && ratio === '1';

  const base = { currency, definitionVersion: CONTRIBUTION_DEFINITION_VERSION };
  if (complete) {
    return {
      preMarketing: {
        ...base,
        key: 'contribution_pre_marketing',
        value: pre.toFixed(),
        quality: 'complete',
        warnings: [],
      },
      postMarketing: {
        ...base,
        key: 'contribution_post_marketing',
        value: post.toFixed(),
        quality: 'complete',
        warnings: [],
      },
      completeLinesOnly: null,
      coverageRatio: ratio,
    };
  }

  const missing = coverage.linesRequiringCost - coverage.linesWithCost;
  const warning = `تكلفة ${missing} من البنود مفقودة`;
  return {
    preMarketing: {
      ...base,
      key: 'contribution_pre_marketing',
      value: null,
      quality: 'incomplete',
      warnings: [warning],
    },
    postMarketing: {
      ...base,
      key: 'contribution_post_marketing',
      value: null,
      quality: 'incomplete',
      warnings: [warning],
    },
    completeLinesOnly: completeLineEntries ? subtotal(completeLineEntries, currency) : null,
    coverageRatio: ratio,
  };
}

function subtotal(entries: readonly FinancialEntry[], currency: CurrencyCode) {
  const t = totalsByGroup(entries, currency);
  const pre = t.revenue.minus(t.variableCost);
  return { preMarketing: pre.toFixed(), postMarketing: pre.minus(t.marketing).toFixed() };
}
