import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { withTenant, type TransactionSql } from '@arso/db';
import {
  CSV_LIMITS,
  CsvError,
  ORDER_STATUS_MAPPING_VERSION,
  parseCsv,
  validateImport,
  type AdSpendRow,
  type CostRow,
  type ImportKind,
  type OrderLineRow,
  type Permission,
  type RejectedRow,
} from '@arso/domain';
import type { AuthUser } from '../auth/session.guard.js';
import { SQL, type Sql } from '../db.js';
import { ApiError } from '../errors.js';
import type { Membership, StoreAccess } from '../org/org.service.js';
import { ProblemsService } from '../problems/problems.service.js';

/** صلاحية كل نوع استيراد: الطلبات والإنفاق مصادر بيانات (مالك)، والتكاليف للمالية أيضًا */
export const IMPORT_PERMISSION: Readonly<Record<ImportKind, Permission>> = {
  orders: 'connections.manage',
  costs: 'costs.write',
  ad_spend: 'connections.manage',
};

const REJECTED_SAMPLE = 200;
const CHUNK = 1000;

export type RowStatus = 'create' | 'update' | 'duplicate';

export interface PreviewInput {
  kind: ImportKind;
  fileName: string;
  csv: string;
  naiveTimezone: string | null;
}

interface Counts {
  create: number;
  update: number;
  duplicate: number;
}

const tally = (statuses: RowStatus[]): Counts => ({
  create: statuses.filter((s) => s === 'create').length,
  update: statuses.filter((s) => s === 'update').length,
  duplicate: statuses.filter((s) => s === 'duplicate').length,
});

/** مقارنة نصوص عشرية دون float: إزالة الأصفار الزائدة فقط */
function normalizeDecimal(v: string): string {
  if (!v.includes('.')) return v.replace(/^(-?)0+(?=\d)/, '$1');
  return v.replace(/^(-?)0+(?=\d)/, '$1').replace(/\.?0+$/, '');
}

function chunks<T>(list: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK));
  return out;
}

@Injectable()
export class ImportsService {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    private readonly problems: ProblemsService,
  ) {}

  private validate(
    store: StoreAccess,
    kind: ImportKind,
    csv: string,
    naiveTimezone: string | null,
  ) {
    if (Buffer.byteLength(csv, 'utf8') > CSV_LIMITS.maxBytes) {
      throw new ApiError(
        413,
        'IMPORT_TOO_LARGE',
        'الملف أكبر من 20 ميغابايت؛ قسّمه إلى ملفات أصغر',
      );
    }
    let table;
    try {
      table = parseCsv(csv);
    } catch (e) {
      if (e instanceof CsvError) {
        throw new ApiError(422, 'IMPORT_FILE_INVALID', `تعذّرت قراءة الملف: ${e.message}`, {
          line: e.line,
        });
      }
      throw e;
    }
    const v = validateImport(kind, table, {
      storeId: store.id,
      storeCurrency: store.currency,
      storeTimezone: store.timezone,
      naiveTimezone,
    });
    if (v.fileErrors.length) {
      throw new ApiError(422, 'IMPORT_FILE_INVALID', v.fileErrors.join('. '), {
        reasons: v.fileErrors,
      });
    }
    return { total: table.rows.length, ...v };
  }

  // ===== تصنيف الصفوف مقابل ما في القاعدة =====

  private async classifyOrders(
    tx: TransactionSql,
    store: StoreAccess,
    rows: readonly OrderLineRow[],
  ) {
    const ids = [...new Set(rows.map((r) => r.orderExternalId))];
    const existing = new Map<string, Record<string, string | null>>();
    for (const part of chunks(ids)) {
      const found = await tx<
        {
          external_id: string;
          placed_at: Date;
          source_status: string;
          shipping_income_ex_tax: string | null;
          customer_external_id: string | null;
          external_line_id: string | null;
          variant_external_id: string | null;
          quantity: string | null;
          product_revenue_ex_tax: string | null;
          tax_amount: string | null;
          product_external_id: string | null;
        }[]
      >`SELECT o.external_id, o.placed_at, o.source_status, o.shipping_income_ex_tax,
               o.customer_external_id, l.external_line_id, l.variant_external_id, l.quantity,
               l.product_revenue_ex_tax, l.tax_amount, l.product_external_id
        FROM orders o LEFT JOIN order_lines l ON l.order_id = o.id
        WHERE o.store_id = ${store.id} AND o.external_id = ANY(${part}::text[])`;
      for (const f of found) {
        const orderSig = [
          f.placed_at.toISOString(),
          f.source_status,
          f.shipping_income_ex_tax === null ? null : normalizeDecimal(f.shipping_income_ex_tax),
          f.customer_external_id,
        ].join('|');
        existing.set(`o:${f.external_id}`, { sig: orderSig });
        if (f.external_line_id !== null) {
          existing.set(`l:${f.external_id}\u0000${f.external_line_id}`, {
            sig: [
              f.variant_external_id,
              normalizeDecimal(f.quantity!),
              normalizeDecimal(f.product_revenue_ex_tax!),
              f.tax_amount === null ? null : normalizeDecimal(f.tax_amount),
              f.product_external_id,
            ].join('|'),
          });
        }
      }
    }
    return rows.map((r): RowStatus => {
      const order = existing.get(`o:${r.orderExternalId}`);
      const line = existing.get(`l:${r.orderExternalId}\u0000${r.lineExternalId}`);
      if (!order || !line) return order || line ? 'update' : 'create';
      const orderSig = [
        r.createdAt,
        r.sourceStatus,
        r.shippingIncomeExTax === null ? null : normalizeDecimal(r.shippingIncomeExTax),
        r.customerExternalId,
      ].join('|');
      const lineSig = [
        r.variantExternalId,
        normalizeDecimal(r.quantity),
        normalizeDecimal(r.productRevenueExTax),
        r.taxAmount === null ? null : normalizeDecimal(r.taxAmount),
        r.productExternalId,
      ].join('|');
      return order.sig === orderSig && line.sig === lineSig ? 'duplicate' : 'update';
    });
  }

  private async latestCosts(tx: TransactionSql, store: StoreAccess, rows: readonly CostRow[]) {
    const variants = [...new Set(rows.map((r) => r.variantExternalId))];
    const latest = new Map<string, { cost: string; revision: number }>();
    for (const part of chunks(variants)) {
      const found = await tx<
        { variant_external_id: string; valid_from: Date; cost_ex_tax: string; revision: number }[]
      >`SELECT DISTINCT ON (variant_external_id, valid_from)
               variant_external_id, valid_from, cost_ex_tax, revision
        FROM cost_versions
        WHERE store_id = ${store.id} AND variant_external_id = ANY(${part}::text[])
        ORDER BY variant_external_id, valid_from, revision DESC`;
      for (const f of found) {
        latest.set(`${f.variant_external_id}\u0000${f.valid_from.toISOString()}`, {
          cost: normalizeDecimal(f.cost_ex_tax),
          revision: f.revision,
        });
      }
    }
    return latest;
  }

  private async classifyCosts(tx: TransactionSql, store: StoreAccess, rows: readonly CostRow[]) {
    const latest = await this.latestCosts(tx, store, rows);
    return rows.map((r): RowStatus => {
      const prev = latest.get(`${r.variantExternalId}\u0000${r.validFrom}`);
      if (!prev) return 'create';
      return prev.cost === normalizeDecimal(r.costExTax) ? 'duplicate' : 'update';
    });
  }

  private adKey(r: {
    provider: string;
    accountExternalId: string;
    campaignExternalId: string;
    reportDate: string;
    reportTimezone: string;
    attributionWindow: string;
    conversionType: string;
  }) {
    return [
      r.provider,
      r.accountExternalId,
      r.campaignExternalId,
      r.reportDate,
      r.reportTimezone,
      r.attributionWindow,
      r.conversionType,
    ].join('\u0000');
  }

  private async classifyAdSpend(
    tx: TransactionSql,
    store: StoreAccess,
    rows: readonly AdSpendRow[],
  ) {
    const accounts = [...new Set(rows.map((r) => r.accountExternalId))];
    const existing = new Map<string, string>();
    for (const part of chunks(accounts)) {
      const found = await tx<
        {
          provider: string;
          account_external_id: string;
          campaign_external_id: string;
          report_date: string;
          report_timezone: string;
          attribution_window: string;
          conversion_type: string;
          currency: string;
          spend: string;
          attributed_value: string | null;
        }[]
      >`SELECT provider, account_external_id, campaign_external_id, report_date::text AS report_date,
               report_timezone, attribution_window, conversion_type, currency, spend, attributed_value
        FROM ad_spend_facts
        WHERE store_id = ${store.id} AND account_external_id = ANY(${part}::text[])`;
      for (const f of found) {
        existing.set(
          this.adKey({
            provider: f.provider,
            accountExternalId: f.account_external_id,
            campaignExternalId: f.campaign_external_id,
            reportDate: f.report_date,
            reportTimezone: f.report_timezone,
            attributionWindow: f.attribution_window,
            conversionType: f.conversion_type,
          }),
          [
            f.currency.trim(),
            normalizeDecimal(f.spend),
            f.attributed_value === null ? null : normalizeDecimal(f.attributed_value),
          ].join('|'),
        );
      }
    }
    return rows.map((r): RowStatus => {
      const prev = existing.get(this.adKey(r));
      if (prev === undefined) return 'create';
      const sig = [
        r.currency,
        normalizeDecimal(r.spend),
        r.attributedValue === null ? null : normalizeDecimal(r.attributedValue),
      ].join('|');
      return prev === sig ? 'duplicate' : 'update';
    });
  }

  private classify(
    tx: TransactionSql,
    store: StoreAccess,
    kind: ImportKind,
    rows: readonly unknown[],
  ) {
    if (kind === 'orders') return this.classifyOrders(tx, store, rows as OrderLineRow[]);
    if (kind === 'costs') return this.classifyCosts(tx, store, rows as CostRow[]);
    return this.classifyAdSpend(tx, store, rows as AdSpendRow[]);
  }

  /** ملخص يفيد قرار الاعتماد: الأثر، لا مجرد عدد الصفوف (الملحق ب) */
  private summarize(store: StoreAccess, kind: ImportKind, rows: readonly unknown[]) {
    const warnings: string[] = [];
    if (kind === 'orders') {
      const lines = rows as OrderLineRow[];
      const orders = new Map(lines.map((l) => [l.orderExternalId, l]));
      const by = (e: string) => [...orders.values()].filter((o) => o.eligibility === e).length;
      const dates = lines.map((l) => l.createdAt).sort();
      const review = by('needs_review');
      if (review) {
        const statuses = [
          ...new Set(
            lines.filter((l) => l.eligibility === 'needs_review').map((l) => l.sourceStatus),
          ),
        ];
        warnings.push(
          `${review} طلب بحالة غير معروفة (${statuses.slice(0, 5).join('، ')}) لن يُحتسب في المبيعات حتى تُراجع`,
        );
      }
      return {
        orders: orders.size,
        eligibleOrders: by('eligible'),
        excludedOrders: by('excluded'),
        needsReviewOrders: review,
        from: dates[0] ?? null,
        to: dates.at(-1) ?? null,
        warnings,
      };
    }
    if (kind === 'costs') {
      const costs = rows as CostRow[];
      return { variants: new Set(costs.map((c) => c.variantExternalId)).size, warnings };
    }
    const spend = rows as AdSpendRow[];
    const zones = [...new Set(spend.map((s) => s.reportTimezone))].filter(
      (z) => z !== store.timezone,
    );
    if (zones.length) {
      warnings.push(
        `أيام التقرير بمنطقة ${zones.join('، ')} تختلف عن منطقة المتجر ${store.timezone}؛ تُحفظ كما هي وتُقارن يومًا بيوم تقريبيًا`,
      );
    }
    const currencies = [...new Set(spend.map((s) => s.currency))].filter(
      (c) => c !== store.currency,
    );
    if (currencies.length) {
      warnings.push(
        `إنفاق بعملة ${currencies.join('، ')}: يُحفظ، ولا يدخل إجمالي المتجر بـ${store.currency} قبل تحويل موثق`,
      );
    }
    const dates = spend.map((s) => s.reportDate).sort();
    return {
      campaigns: new Set(spend.map((s) => `${s.provider}:${s.campaignExternalId}`)).size,
      from: dates[0] ?? null,
      to: dates.at(-1) ?? null,
      warnings,
    };
  }

  async preview(m: Membership, store: StoreAccess, input: PreviewInput) {
    const checksum = createHash('sha256').update(input.csv, 'utf8').digest('hex');
    const v = this.validate(store, input.kind, input.csv, input.naiveTimezone);
    const sample: RejectedRow[] = v.rejected.slice(0, REJECTED_SAMPLE);

    return withTenant(this.sql, m.organizationId, async (tx) => {
      const statuses = await this.classify(tx, store, input.kind, v.rows);
      const counts = tally(statuses);
      const [already] = await tx<{ id: string }[]>`
        SELECT id FROM import_batches
        WHERE store_id = ${store.id} AND kind = ${input.kind} AND file_checksum = ${checksum}
          AND status = 'completed'`;
      const [batch] = await tx<{ id: string; created_at: Date }[]>`
        INSERT INTO import_batches ${tx({
          organization_id: m.organizationId,
          store_id: store.id,
          kind: input.kind,
          file_name: input.fileName,
          file_checksum: checksum,
          naive_timezone: input.naiveTimezone,
          total_rows: v.total,
          rejected_rows: v.rejected.length,
          created_count: counts.create,
          updated_count: counts.update,
          duplicate_count: counts.duplicate,
          rejected_sample: tx.json(sample as never),
          created_by: m.id,
        })} RETURNING id, created_at`;
      return {
        id: batch!.id,
        kind: input.kind,
        status: 'preview_ready' as const,
        alreadyImported: Boolean(already),
        totalRows: v.total,
        counts: { ...counts, rejected: v.rejected.length },
        summary: this.summarize(store, input.kind, v.rows),
        rejected: sample,
      };
    });
  }

  async commit(m: Membership, user: AuthUser, store: StoreAccess, batchId: string, csv: string) {
    const result = await withTenant(this.sql, m.organizationId, async (tx) => {
      const [batch] = await tx<
        {
          id: string;
          kind: ImportKind;
          status: string;
          file_checksum: string;
          naive_timezone: string | null;
        }[]
      >`SELECT id, kind, status, file_checksum, naive_timezone FROM import_batches
        WHERE id = ${batchId} AND store_id = ${store.id} FOR UPDATE`;
      if (!batch) throw new ApiError(404, 'NOT_FOUND', 'العنصر غير موجود');
      if (batch.status !== 'preview_ready') {
        throw new ApiError(409, 'IMPORT_NOT_PENDING', 'هذه المعاينة اعتُمدت أو أُلغيت من قبل');
      }
      if (store.permissions.has(IMPORT_PERMISSION[batch.kind]) === false) {
        throw new ApiError(403, 'FORBIDDEN', 'لا تملك صلاحية هذا الإجراء');
      }
      const checksum = createHash('sha256').update(csv, 'utf8').digest('hex');
      if (checksum !== batch.file_checksum) {
        throw new ApiError(
          409,
          'IMPORT_FILE_CHANGED',
          'الملف تغيّر بعد المعاينة. عاين الملف من جديد',
        );
      }
      const [done] = await tx`
        SELECT 1 FROM import_batches WHERE store_id = ${store.id} AND kind = ${batch.kind}
          AND file_checksum = ${checksum} AND status = 'completed'`;
      if (done) {
        throw new ApiError(409, 'IMPORT_ALREADY_COMMITTED', 'هذا الملف اعتُمد من قبل لهذا المتجر');
      }

      const v = this.validate(store, batch.kind, csv, batch.naive_timezone);
      const statuses = await this.classify(tx, store, batch.kind, v.rows);
      const counts = tally(statuses);
      const changed = v.rows.filter((_, i) => statuses[i] !== 'duplicate');

      if (batch.kind === 'orders')
        await this.writeOrders(tx, m, store, batch.id, changed as OrderLineRow[]);
      else if (batch.kind === 'costs')
        await this.writeCosts(tx, m, store, batch.id, changed as CostRow[]);
      else await this.writeAdSpend(tx, m, store, batch.id, changed as AdSpendRow[]);

      await tx`
        UPDATE import_batches SET status = 'completed', committed_at = now(),
          created_count = ${counts.create}, updated_count = ${counts.update},
          duplicate_count = ${counts.duplicate}, rejected_rows = ${v.rejected.length}
        WHERE id = ${batch.id}`;
      await tx`
        INSERT INTO audit_logs (organization_id, store_id, actor_type, actor_id, action,
                                target_type, target_id, after_state)
        VALUES (${m.organizationId}, ${store.id}, 'user', ${user.id}, 'import.commit',
                'import_batch', ${batch.id},
                ${tx.json({ kind: batch.kind, ...counts, rejected: v.rejected.length } as never)})`;
      return {
        id: batch.id,
        kind: batch.kind,
        status: 'completed' as const,
        counts: { ...counts, rejected: v.rejected.length },
      };
    });
    // الفحص بعد الاعتماد خارج معاملة الكتابة؛ فشله لا يلغي الاستيراد
    await this.problems.evaluateQuietly(m, store);
    return result;
  }

  private async writeOrders(
    tx: TransactionSql,
    m: Membership,
    store: StoreAccess,
    batchId: string,
    lines: readonly OrderLineRow[],
  ) {
    const orders = new Map<string, OrderLineRow>();
    for (const l of lines) orders.set(l.orderExternalId, l);
    for (const part of chunks([...orders.values()])) {
      const values = part.map((o) => ({
        organization_id: m.organizationId,
        store_id: store.id,
        external_id: o.orderExternalId,
        placed_at: o.createdAt,
        source_status: o.sourceStatus,
        eligibility: o.eligibility,
        status_mapping_version: ORDER_STATUS_MAPPING_VERSION,
        currency: o.currency,
        shipping_income_ex_tax: o.shippingIncomeExTax,
        customer_external_id: o.customerExternalId,
        source: 'csv',
        import_batch_id: batchId,
      }));
      await tx`
        INSERT INTO orders ${tx(values)}
        ON CONFLICT (organization_id, store_id, external_id) DO UPDATE SET
          placed_at = EXCLUDED.placed_at, source_status = EXCLUDED.source_status,
          eligibility = EXCLUDED.eligibility, status_mapping_version = EXCLUDED.status_mapping_version,
          currency = EXCLUDED.currency, shipping_income_ex_tax = EXCLUDED.shipping_income_ex_tax,
          customer_external_id = EXCLUDED.customer_external_id, import_batch_id = EXCLUDED.import_batch_id,
          observed_at = now(), revision = orders.revision + 1`;
    }
    const ids = new Map<string, string>();
    for (const part of chunks([...orders.keys()])) {
      const found = await tx<{ id: string; external_id: string }[]>`
        SELECT id, external_id FROM orders WHERE store_id = ${store.id} AND external_id = ANY(${part}::text[])`;
      for (const f of found) ids.set(f.external_id, f.id);
    }
    for (const part of chunks(lines)) {
      const values = part.map((l) => ({
        organization_id: m.organizationId,
        store_id: store.id,
        order_id: ids.get(l.orderExternalId)!,
        external_line_id: l.lineExternalId,
        product_external_id: l.productExternalId,
        variant_external_id: l.variantExternalId,
        quantity: l.quantity,
        product_revenue_ex_tax: l.productRevenueExTax,
        tax_amount: l.taxAmount,
      }));
      await tx`
        INSERT INTO order_lines ${tx(values)}
        ON CONFLICT (order_id, external_line_id) DO UPDATE SET
          product_external_id = EXCLUDED.product_external_id,
          variant_external_id = EXCLUDED.variant_external_id, quantity = EXCLUDED.quantity,
          product_revenue_ex_tax = EXCLUDED.product_revenue_ex_tax, tax_amount = EXCLUDED.tax_amount`;
    }
  }

  /** التكلفة لا تُعدّل: التصحيح نسخة جديدة بنفس تاريخ السريان (AC05) */
  private async writeCosts(
    tx: TransactionSql,
    m: Membership,
    store: StoreAccess,
    batchId: string,
    rows: readonly CostRow[],
  ) {
    const latest = await this.latestCosts(tx, store, rows);
    for (const part of chunks(rows)) {
      const values = part.map((r) => ({
        organization_id: m.organizationId,
        store_id: store.id,
        variant_external_id: r.variantExternalId,
        currency: r.currency,
        cost_ex_tax: r.costExTax,
        valid_from: r.validFrom,
        revision: (latest.get(`${r.variantExternalId}\u0000${r.validFrom}`)?.revision ?? 0) + 1,
        source: 'csv',
        source_note: r.sourceNote,
        import_batch_id: batchId,
        created_by: m.id,
      }));
      await tx`INSERT INTO cost_versions ${tx(values)}`;
    }
  }

  private async writeAdSpend(
    tx: TransactionSql,
    m: Membership,
    store: StoreAccess,
    batchId: string,
    rows: readonly AdSpendRow[],
  ) {
    for (const part of chunks(rows)) {
      const values = part.map((r) => ({
        organization_id: m.organizationId,
        store_id: store.id,
        provider: r.provider,
        account_external_id: r.accountExternalId,
        campaign_external_id: r.campaignExternalId,
        report_date: r.reportDate,
        report_timezone: r.reportTimezone,
        currency: r.currency,
        spend: r.spend,
        attribution_window: r.attributionWindow,
        conversion_type: r.conversionType,
        attributed_value: r.attributedValue,
        import_batch_id: batchId,
      }));
      await tx`
        INSERT INTO ad_spend_facts ${tx(values)}
        ON CONFLICT (organization_id, store_id, provider, account_external_id, campaign_external_id,
                     report_date, report_timezone, attribution_window, conversion_type)
        DO UPDATE SET currency = EXCLUDED.currency, spend = EXCLUDED.spend,
          attributed_value = EXCLUDED.attributed_value, import_batch_id = EXCLUDED.import_batch_id,
          observed_at = now(), source_revision = ad_spend_facts.source_revision + 1`;
    }
  }

  async list(m: Membership, store: StoreAccess) {
    const rows = await withTenant(
      this.sql,
      m.organizationId,
      (tx) => tx<
        {
          id: string;
          kind: ImportKind;
          file_name: string;
          status: string;
          total_rows: number;
          rejected_rows: number;
          created_count: number;
          updated_count: number;
          duplicate_count: number;
          created_at: Date;
          committed_at: Date | null;
        }[]
      >`SELECT id, kind, file_name, status, total_rows, rejected_rows, created_count, updated_count,
               duplicate_count, created_at, committed_at
        FROM import_batches WHERE store_id = ${store.id} AND status = 'completed'
        ORDER BY committed_at DESC LIMIT 50`,
    );
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      fileName: r.file_name,
      status: r.status,
      totalRows: r.total_rows,
      counts: {
        create: r.created_count,
        update: r.updated_count,
        duplicate: r.duplicate_count,
        rejected: r.rejected_rows,
      },
      committedAt: r.committed_at?.toISOString() ?? null,
    }));
  }
}
