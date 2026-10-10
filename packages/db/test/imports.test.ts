import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/index.js';
import { createOrganization, createTestDb, createVerifiedUser, type TestDb } from './setup.js';

let db: TestDb;
const orgs: { org: string; store: string; member: string }[] = [];

async function seed(name: string) {
  const owner = await createVerifiedUser(db, `${randomUUID()}@owner.sa`);
  const org = await createOrganization(db, name, owner);
  return withTenant(db.app, org, async (tx) => {
    const [s] = await tx<{ id: string }[]>`
      INSERT INTO stores (organization_id, name) VALUES (${org}, ${name + ' store'}) RETURNING id`;
    const [m] = await tx<{ id: string }[]>`SELECT id FROM memberships`;
    return { org, store: s!.id, member: m!.id };
  });
}

const batch = (o: (typeof orgs)[number], checksum = 'a'.repeat(64)) => ({
  organization_id: o.org,
  store_id: o.store,
  kind: 'orders',
  file_name: 'orders.csv',
  file_checksum: checksum,
  total_rows: 1,
  rejected_rows: 0,
  created_by: o.member,
});

beforeAll(async () => {
  db = await createTestDb();
  orgs.push(await seed('Org A'), await seed('Org B'));
});
afterAll(async () => db?.drop());

describe('عزل جداول الاستيراد والطلبات', () => {
  it('طلب المؤسسة A لا يُرى من B، ولا يُكتب باسمها', async () => {
    const [a, b] = orgs as [(typeof orgs)[number], (typeof orgs)[number]];
    await withTenant(
      db.app,
      a.org,
      (tx) => tx`
      INSERT INTO orders (organization_id, store_id, external_id, placed_at, source_status,
                          eligibility, status_mapping_version, currency, source)
      VALUES (${a.org}, ${a.store}, 'o1', now(), 'تم التوصيل', 'eligible', 'v', 'SAR', 'csv')`,
    );
    const seen = await withTenant(db.app, b.org, (tx) => tx`SELECT id FROM orders`);
    expect(seen).toHaveLength(0);
    await expect(
      withTenant(
        db.app,
        b.org,
        (tx) => tx`
        INSERT INTO orders (organization_id, store_id, external_id, placed_at, source_status,
                            eligibility, status_mapping_version, currency, source)
        VALUES (${a.org}, ${a.store}, 'o2', now(), 's', 'eligible', 'v', 'SAR', 'csv')`,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('لا يُربط طلب مؤسسة بمتجر مؤسسة أخرى حتى من داخل سياقها', async () => {
    const [a, b] = orgs as [(typeof orgs)[number], (typeof orgs)[number]];
    await expect(
      withTenant(
        db.app,
        a.org,
        (tx) => tx`
        INSERT INTO orders (organization_id, store_id, external_id, placed_at, source_status,
                            eligibility, status_mapping_version, currency, source)
        VALUES (${a.org}, ${b.store}, 'o3', now(), 's', 'eligible', 'v', 'SAR', 'csv')`,
      ),
    ).rejects.toThrow(/foreign key/);
  });
});

describe('التكاليف التاريخية', () => {
  it('append-only: لا تعديل ولا حذف، والتصحيح نسخة جديدة', async () => {
    const a = orgs[0]!;
    await withTenant(db.app, a.org, async (tx) => {
      await tx`
        INSERT INTO cost_versions (organization_id, store_id, variant_external_id, currency,
                                   cost_ex_tax, valid_from, source, created_by)
        VALUES (${a.org}, ${a.store}, 'v1', 'SAR', 40, '2026-09-01', 'csv', ${a.member})`;
      await tx`
        INSERT INTO cost_versions (organization_id, store_id, variant_external_id, currency,
                                   cost_ex_tax, valid_from, revision, source, created_by)
        VALUES (${a.org}, ${a.store}, 'v1', 'SAR', 42, '2026-09-01', 2, 'csv', ${a.member})`;
    });
    await expect(
      withTenant(db.app, a.org, (tx) => tx`UPDATE cost_versions SET cost_ex_tax = 1`),
    ).rejects.toThrow(/permission denied|append-only/);
    await expect(withTenant(db.app, a.org, (tx) => tx`DELETE FROM cost_versions`)).rejects.toThrow(
      /permission denied|append-only/,
    );
    // حتى المالك (بلا قيود الصلاحيات) يصطدم بالمحفّز
    await expect(db.admin`UPDATE cost_versions SET cost_ex_tax = 1`).rejects.toThrow(/append-only/);
  });
});

describe('دفعات الاستيراد', () => {
  it('نفس الملف لا يُعتمد مرتين لنفس المتجر والنوع', async () => {
    const a = orgs[0]!;
    await withTenant(db.app, a.org, async (tx) => {
      await tx`INSERT INTO import_batches ${tx({ ...batch(a), status: 'completed' })}`;
      await tx`INSERT INTO import_batches ${tx(batch(a))}`; // معاينة جديدة لنفس الملف مسموحة
    });
    await expect(
      withTenant(
        db.app,
        a.org,
        (tx) => tx`INSERT INTO import_batches ${tx({ ...batch(a), status: 'completed' })}`,
      ),
    ).rejects.toThrow(/import_batches_once/);
  });

  it('بصمة غير صالحة مرفوضة', async () => {
    const a = orgs[0]!;
    await expect(
      withTenant(
        db.app,
        a.org,
        (tx) => tx`INSERT INTO import_batches ${tx(batch(a, 'not-a-hash'))}`,
      ),
    ).rejects.toThrow(/check constraint/);
  });
});

describe('المشكلات (0005)', () => {
  const problem = (o: (typeof orgs)[number], extra: Record<string, unknown> = {}) => ({
    organization_id: o.org,
    store_id: o.store,
    rule_id: 'Q01',
    rule_version: '1',
    signature: `${o.store}/Q01/1/store/rolling_30d`,
    kind: 'quality',
    score_impact: 2,
    score_evidence: 3,
    score_fit: 2,
    score_feasibility: 2,
    quality: 'complete',
    title: 't',
    observation: { text: 'x' },
    action: 'a',
    ...extra,
  });

  it('بطاقة مفتوحة واحدة لكل توقيع، والمحلولة تسمح ببطاقة جديدة', async () => {
    const a = orgs[0]!;
    await withTenant(db.app, a.org, async (tx) => {
      await tx`INSERT INTO problems ${tx(problem(a))}`;
    });
    await expect(
      withTenant(db.app, a.org, (tx) => tx`INSERT INTO problems ${tx(problem(a))}`),
    ).rejects.toThrow(/problems_open_signature/);
    await withTenant(db.app, a.org, async (tx) => {
      await tx`UPDATE problems SET status = 'resolved', status_reason = 'أكملنا التكاليف'`;
      await tx`INSERT INTO problems ${tx(problem(a))}`;
    });
  });

  it('الرفض والتأجيل والحل تحتاج سببًا', async () => {
    const a = orgs[0]!;
    await expect(
      withTenant(
        db.app,
        a.org,
        (tx) => tx`UPDATE problems SET status = 'rejected' WHERE status = 'new'`,
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it('مؤسسة أخرى لا ترى المشكلات، والسجل append-only', async () => {
    const [a, b] = orgs as [(typeof orgs)[number], (typeof orgs)[number]];
    const seen = await withTenant(db.app, b.org, (tx) => tx`SELECT id FROM problems`);
    expect(seen).toHaveLength(0);
    await withTenant(db.app, a.org, async (tx) => {
      const [p] = await tx<{ id: string }[]>`SELECT id FROM problems LIMIT 1`;
      await tx`INSERT INTO problem_events (organization_id, problem_id, kind, body)
               VALUES (${a.org}, ${p!.id}, 'comment', 'ملاحظة')`;
    });
    await expect(
      withTenant(db.app, a.org, (tx) => tx`UPDATE problem_events SET body = 'x'`),
    ).rejects.toThrow(/permission denied|append-only/);
  });
});
