import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/index.js';
import { createOrganization, createTestDb, createVerifiedUser, type TestDb } from './setup.js';

let db: TestDb;
let ownerId = '';
let orgId = '';
let ownerMembership = '';
let storeId = '';

const hash = (token: Buffer) => createHash('sha256').update(token).digest();

async function invite(email: string, opts: { expiresInMs?: number; storeIds?: string[] } = {}) {
  const token = randomBytes(32);
  await withTenant(
    db.app,
    orgId,
    (tx) => tx`
    INSERT INTO invitations (organization_id, email, role, store_ids, token_hash, invited_by, expires_at, created_at)
    VALUES (${orgId}, ${email}, 'analyst', ${opts.storeIds ?? [storeId]}, ${hash(token)}, ${ownerMembership},
            ${new Date(Date.now() + (opts.expiresInMs ?? 86_400_000))}, ${new Date(Date.now() - 1000)})`,
  );
  return token;
}

beforeAll(async () => {
  db = await createTestDb();
  ownerId = await createVerifiedUser(db, 'owner@arso.sa');
  orgId = await createOrganization(db, 'متجر وريف', ownerId);
  await withTenant(db.app, orgId, async (tx) => {
    const [m] = await tx<{ id: string }[]>`SELECT id FROM memberships WHERE user_id = ${ownerId}`;
    ownerMembership = m!.id;
    const [s] = await tx<
      { id: string }[]
    >`INSERT INTO stores (organization_id, name) VALUES (${orgId}, 'وريف') RETURNING id`;
    storeId = s!.id;
  });
});
afterAll(async () => db?.drop());

describe('إنشاء المؤسسة (ملاحظة المراجعة الأمنية #2)', () => {
  it('ينشئ المؤسسة والعضوية المالكة وسجل التدقيق معًا', async () => {
    const rows = await withTenant(
      db.app,
      orgId,
      (tx) => tx`
      SELECT (SELECT role FROM memberships WHERE user_id = ${ownerId}) AS role,
             (SELECT count(*)::int FROM audit_logs WHERE action = 'organization.create') AS audits`,
    );
    expect(rows[0]).toEqual({ role: 'owner', audits: 1 });
  });

  it('دور التطبيق لا يستطيع إنشاء مؤسسة مباشرة', async () => {
    const id = randomUUID();
    await expect(
      withTenant(
        db.app,
        id,
        (tx) => tx`INSERT INTO organizations (id, name) VALUES (${id}, 'bypass')`,
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('دور التطبيق لا يستطيع منح نفسه عضوية مباشرة', async () => {
    await expect(
      withTenant(
        db.app,
        orgId,
        (tx) => tx`
        INSERT INTO memberships (organization_id, user_id, role, status) VALUES (${orgId}, ${ownerId}, 'owner', 'active')`,
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('يرفض مالكًا لم يتحقق بريده', async () => {
    const [u] = await db.auth<{ id: string }[]>`
      INSERT INTO users (id, email, email_verified, name) VALUES (gen_random_uuid(), 'unverified@x.sa', false, 'U') RETURNING id`;
    await expect(createOrganization(db, 'Nope', u!.id)).rejects.toThrow(/not verified/);
  });
});

describe('جدول المستخدمين (ملاحظة المراجعة الأمنية #1)', () => {
  it('دور التطبيق لا يقرأ جدول المستخدمين', async () => {
    await expect(db.app`SELECT email FROM users`).rejects.toThrow(/permission denied/);
  });

  it('أعضاء المؤسسة الحالية فقط عبر current_org_members', async () => {
    const other = await createVerifiedUser(db, 'other-owner@x.sa');
    await createOrganization(db, 'Other Org', other);
    const members = await withTenant(
      db.app,
      orgId,
      (tx) => tx`SELECT email FROM current_org_members()`,
    );
    expect(members.map((m) => m.email)).toEqual(['owner@arso.sa']);
    const none = await db.app`SELECT email FROM current_org_members()`;
    expect(none).toHaveLength(0);
  });

  it('user_memberships يعيد مؤسسات المستخدم نفسه فقط', async () => {
    const rows = await db.app`SELECT organization_name, role FROM user_memberships(${ownerId})`;
    expect(rows).toEqual([{ organization_name: 'متجر وريف', role: 'owner' }]);
  });

  it('دور المصادقة لا يرى بيانات المؤسسات', async () => {
    await expect(db.auth`SELECT id FROM stores`).rejects.toThrow(/permission denied/);
    await expect(db.auth`SELECT id FROM financial_entries`).rejects.toThrow(/permission denied/);
  });
});

describe('الدعوات (القسم 10)', () => {
  it('تُقبل مرة واحدة فقط وتنشئ العضوية والمنحة', async () => {
    const userId = await createVerifiedUser(db, 'analyst@arso.sa');
    const token = await invite('analyst@arso.sa');
    const [r] = await db.app<
      { org: string }[]
    >`SELECT accept_invitation(${hash(token)}, ${userId}) AS org`;
    expect(r!.org).toBe(orgId);
    const grants = await withTenant(
      db.app,
      orgId,
      (tx) => tx`
      SELECT g.store_id, m.role FROM store_grants g JOIN memberships m ON m.id = g.membership_id
      WHERE m.user_id = ${userId}`,
    );
    expect(grants).toEqual([{ store_id: storeId, role: 'analyst' }]);
    await expect(db.app`SELECT accept_invitation(${hash(token)}, ${userId})`).rejects.toThrow(
      /invitation invalid/,
    );
  });

  it('لا تُقبل ببريد مختلف عن المدعو', async () => {
    const intruder = await createVerifiedUser(db, 'intruder@evil.sa');
    const token = await invite('someone@arso.sa');
    await expect(db.app`SELECT accept_invitation(${hash(token)}, ${intruder})`).rejects.toThrow(
      /email mismatch/,
    );
  });

  it('لا تُقبل بعد انتهاء صلاحيتها', async () => {
    const userId = await createVerifiedUser(db, 'late@arso.sa');
    const token = await invite('late@arso.sa', { expiresInMs: 1 });
    await new Promise((r) => setTimeout(r, 20));
    await expect(db.app`SELECT accept_invitation(${hash(token)}, ${userId})`).rejects.toThrow(
      /invitation invalid/,
    );
  });

  it('رمز عشوائي غير موجود مرفوض', async () => {
    const userId = await createVerifiedUser(db, 'guess@arso.sa');
    await expect(
      db.app`SELECT accept_invitation(${hash(randomBytes(32))}, ${userId})`,
    ).rejects.toThrow(/invitation invalid/);
  });

  it('لا يمكن دعوة شخص كمالك', async () => {
    await expect(
      withTenant(
        db.app,
        orgId,
        (tx) => tx`
        INSERT INTO invitations (organization_id, email, role, token_hash, invited_by, expires_at)
        VALUES (${orgId}, 'x@x.sa', 'owner', ${hash(randomBytes(32))}, ${ownerMembership}, now() + interval '1 day')`,
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it('الدعوة لا تمنح متجرًا من مؤسسة أخرى', async () => {
    const other = await createVerifiedUser(db, 'owner-c@x.sa');
    const otherOrg = await createOrganization(db, 'Org C', other);
    const otherStore = await withTenant(db.app, otherOrg, async (tx) => {
      const [s] = await tx<
        { id: string }[]
      >`INSERT INTO stores (organization_id, name) VALUES (${otherOrg}, 'Store C') RETURNING id`;
      return s!.id;
    });
    const userId = await createVerifiedUser(db, 'cross@arso.sa');
    const token = await invite('cross@arso.sa', { storeIds: [otherStore] });
    await expect(db.app`SELECT accept_invitation(${hash(token)}, ${userId})`).rejects.toThrow(
      /foreign key/,
    );
  });

  it('مؤسسة أخرى لا ترى دعوات هذه المؤسسة', async () => {
    const other = await createVerifiedUser(db, 'owner-d@x.sa');
    const otherOrg = await createOrganization(db, 'Org D', other);
    const rows = await withTenant(db.app, otherOrg, (tx) => tx`SELECT id FROM invitations`);
    expect(rows).toHaveLength(0);
  });
});
