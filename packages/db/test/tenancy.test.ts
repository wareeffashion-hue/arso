import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant, TenantContextError } from '../src/index.js';
import { createTestDb, type TestDb } from './setup.js';

let db: TestDb;
const orgA = randomUUID();
const orgB = randomUUID();
let storeA = '';
let storeB = '';

async function seedOrg(org: string, name: string): Promise<string> {
  return withTenant(db.app, org, async (tx) => {
    await tx`INSERT INTO organizations (id, name) VALUES (${org}, ${name})`;
    const [s] = await tx<
      { id: string }[]
    >`INSERT INTO stores (organization_id, name) VALUES (${org}, ${name + ' store'}) RETURNING id`;
    return s!.id;
  });
}

function entry(org: string, store: string, overrides: Record<string, unknown> = {}) {
  return {
    organization_id: org,
    store_id: store,
    kind: 'product_revenue',
    amount: '200.000000',
    currency: 'SAR',
    economic_at: new Date('2026-10-01T10:00:00Z'),
    source: 'salla',
    source_record_id: 'order-1',
    line_id: 'line-1',
    revision: 1,
    calculation_version: '1.0',
    ...overrides,
  };
}

beforeAll(async () => {
  db = await createTestDb();
  storeA = await seedOrg(orgA, 'Org A');
  storeB = await seedOrg(orgB, 'Org B');
});
afterAll(async () => db?.drop());

describe('TENANT-001: عزل المؤسسات في قاعدة البيانات', () => {
  it('المؤسسة A ترى متجرها فقط', async () => {
    const rows = await withTenant(db.app, orgA, (tx) => tx`SELECT id FROM stores`);
    expect(rows.map((r) => r.id)).toEqual([storeA]);
  });

  it('بدون سياق مؤسسة لا تُرى أي صفوف (مغلق افتراضيًا)', async () => {
    const rows = await db.app`SELECT id FROM stores`;
    expect(rows).toHaveLength(0);
  });

  it('لا يمكن الكتابة باسم مؤسسة أخرى', async () => {
    await expect(
      withTenant(
        db.app,
        orgA,
        (tx) => tx`INSERT INTO stores (organization_id, name) VALUES (${orgB}, ${'intruder'})`,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('لا يمكن قراءة متجر مؤسسة أخرى حتى بمعرّفه المباشر', async () => {
    const rows = await withTenant(
      db.app,
      orgA,
      (tx) => tx`SELECT id FROM stores WHERE id = ${storeB}`,
    );
    expect(rows).toHaveLength(0);
  });

  it('لا يمكن نقل متجر إلى مؤسسة أخرى بالتعديل', async () => {
    await expect(
      withTenant(
        db.app,
        orgA,
        (tx) => tx`UPDATE stores SET organization_id = ${orgB} WHERE id = ${storeA}`,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('المفتاح المركب يمنع منحة على متجر مؤسسة أخرى', async () => {
    const admin = db.admin;
    const [u] = await admin<
      { id: string }[]
    >`INSERT INTO users (email) VALUES (${`a-${randomUUID()}@x.sa`}) RETURNING id`;
    const [m] = await admin<{ id: string }[]>`
      INSERT INTO memberships (organization_id, user_id, role, status) VALUES (${orgA}, ${u!.id}, 'analyst', 'active') RETURNING id`;
    await expect(
      admin`INSERT INTO store_grants (organization_id, membership_id, store_id) VALUES (${orgA}, ${m!.id}, ${storeB})`,
    ).rejects.toThrow(/foreign key/);
  });

  it('صلاحية غير معرّفة في المنحة مرفوضة', async () => {
    const [u] = await db.admin<
      { id: string }[]
    >`INSERT INTO users (email) VALUES (${`b-${randomUUID()}@x.sa`}) RETURNING id`;
    const [m] = await db.admin<{ id: string }[]>`
      INSERT INTO memberships (organization_id, user_id, role) VALUES (${orgA}, ${u!.id}, 'analyst') RETURNING id`;
    await expect(
      db.admin`INSERT INTO store_grants (organization_id, membership_id, store_id, permissions)
               VALUES (${orgA}, ${m!.id}, ${storeA}, ${['metrics.read', 'god.mode']})`,
    ).rejects.toThrow(/check constraint/);
  });

  it('السياق لا يتسرب بين المعاملات في نفس الـ pool', async () => {
    await withTenant(db.app, orgA, (tx) => tx`SELECT 1`);
    const [r] = await db.app<{ org: string | null }[]>`SELECT app_current_org() AS org`;
    expect(r!.org).toBeNull();
  });

  it('يرفض معرّف مؤسسة غير صالح قبل الوصول للقاعدة', async () => {
    await expect(withTenant(db.app, "x' OR 1=1 --", async () => 1)).rejects.toBeInstanceOf(
      TenantContextError,
    );
  });
});

describe('FIN-001: السجل المالي append-only', () => {
  it('يحفظ المبلغ بدقة NUMERIC ويعيده نصًا', async () => {
    const e = entry(orgA, storeA, {
      amount: '99999999999999.123456',
      source_record_id: 'precision',
    });
    const [row] = await withTenant(
      db.app,
      orgA,
      (tx) => tx`INSERT INTO financial_entries ${tx(e)} RETURNING amount`,
    );
    expect(row!.amount).toBe('99999999999999.123456');
  });

  it('دور التطبيق لا يملك صلاحية التعديل أو الحذف', async () => {
    await withTenant(
      db.app,
      orgA,
      (tx) =>
        tx`INSERT INTO financial_entries ${tx(entry(orgA, storeA, { source_record_id: 'immutable' }))}`,
    );
    await expect(
      withTenant(
        db.app,
        orgA,
        (tx) => tx`UPDATE financial_entries SET amount = 1 WHERE source_record_id = 'immutable'`,
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withTenant(
        db.app,
        orgA,
        (tx) => tx`DELETE FROM financial_entries WHERE source_record_id = 'immutable'`,
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('حتى المالك لا يستطيع التعديل: المحفّز يمنعه', async () => {
    await expect(
      db.admin`UPDATE financial_entries SET amount = 1 WHERE source_record_id = 'immutable'`,
    ).rejects.toThrow(/append-only/);
  });

  it('SYNC-001: الحدث المكرر يُسجل مرة واحدة', async () => {
    const e = entry(orgA, storeA, { source_record_id: 'dup-event' });
    await withTenant(db.app, orgA, async (tx) => {
      await tx`INSERT INTO financial_entries ${tx(e)} ON CONFLICT DO NOTHING`;
      await tx`INSERT INTO financial_entries ${tx(e)} ON CONFLICT DO NOTHING`;
    });
    const [c] = await withTenant(
      db.app,
      orgA,
      (tx) =>
        tx`SELECT count(*)::int AS n FROM financial_entries WHERE source_record_id = 'dup-event'`,
    );
    expect(c!.n).toBe(1);
  });

  it('مفتاح المصدر محصور بالمؤسسة: نفس الطلب في مؤسستين لا يتعارض', async () => {
    const e = { source_record_id: 'same-external-id' };
    await withTenant(
      db.app,
      orgA,
      (tx) => tx`INSERT INTO financial_entries ${tx(entry(orgA, storeA, e))}`,
    );
    await withTenant(
      db.app,
      orgB,
      (tx) => tx`INSERT INTO financial_entries ${tx(entry(orgB, storeB, e))}`,
    );
    const a = await withTenant(
      db.app,
      orgA,
      (tx) => tx`SELECT 1 FROM financial_entries WHERE source_record_id = 'same-external-id'`,
    );
    expect(a).toHaveLength(1);
  });

  it('لا يمكن تسجيل حركة على متجر مؤسسة أخرى', async () => {
    await expect(
      withTenant(
        db.app,
        orgA,
        (tx) =>
          tx`INSERT INTO financial_entries ${tx(entry(orgA, storeB, { source_record_id: 'cross' }))}`,
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it('التسوية اليدوية بلا مجموعة مرفوضة', async () => {
    await expect(
      withTenant(
        db.app,
        orgA,
        (tx) =>
          tx`INSERT INTO financial_entries ${tx(entry(orgA, storeA, { kind: 'manual_adjustment', source_record_id: 'adj' }))}`,
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it('سجل التدقيق لا يُعدَّل', async () => {
    await withTenant(
      db.app,
      orgA,
      (tx) =>
        tx`INSERT INTO audit_logs (organization_id, actor_type, actor_id, action, target_type) VALUES (${orgA}, 'user', 'u1', 'costs.update', 'cost_version')`,
    );
    await expect(db.admin`DELETE FROM audit_logs`).rejects.toThrow(/append-only/);
  });
});

describe('الترحيلات', () => {
  it('تشغيلها مرة ثانية لا يفعل شيئًا', async () => {
    const { migrate } = await import('../src/migrate.js');
    expect(await migrate(db.admin)).toEqual([]);
  });
});
