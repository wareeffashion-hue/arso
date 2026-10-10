import { getMigrations } from 'better-auth/db/migration';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { linkFrom, signUpVerified, startApp, WEB, type TestApp } from './helpers.js';

let t: TestApp;
let owner: Awaited<ReturnType<typeof signUpVerified>>;
let orgId = '';
let storeA = '';
let storeB = '';

beforeAll(async () => {
  t = await startApp();
});
afterAll(async () => t?.close());

describe('مخطط Better Auth يطابق ترحيلاتنا', () => {
  it('لا جداول ولا أعمدة ناقصة', async () => {
    const { toBeCreated, toBeAdded } = await getMigrations(t.auth.options);
    expect(toBeCreated.map((x) => x.table)).toEqual([]);
    expect(toBeAdded.map((x) => `${x.table}: ${Object.keys(x.fields).join(',')}`)).toEqual([]);
  });
});

describe('التسجيل والتحقق (القسم 10)', () => {
  it('بلا جلسة: 401', async () => {
    const r = await request(t.app.getHttpServer()).get('/api/v1/me').expect(401);
    expect(r.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('لا دخول قبل تأكيد البريد', async () => {
    const server = t.app.getHttpServer();
    await request(server)
      .post('/api/auth/sign-up/email')
      .set('Origin', WEB)
      .send({ email: 'pending@arso.sa', password: 'correct-horse-battery', name: 'Pending' })
      .expect(200);
    const r = await request(server)
      .post('/api/auth/sign-in/email')
      .set('Origin', WEB)
      .send({ email: 'pending@arso.sa', password: 'correct-horse-battery' });
    expect(r.status).toBe(403);
    expect(linkFrom(t, 'pending@arso.sa').pathname).toBe('/api/auth/verify-email');
  });

  it('كلمة مرور قصيرة مرفوضة', async () => {
    const r = await request(t.app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .set('Origin', WEB)
      .send({ email: 'short@arso.sa', password: 'short', name: 'S' });
    expect(r.status).toBe(400);
  });

  it('بعد التأكيد: الجلسة تعمل والكوكي آمنة', async () => {
    owner = await signUpVerified(t, 'owner@arso.sa', 'المالك');
    const r = await owner.get('/api/v1/me').expect(200);
    expect(r.body.user).toMatchObject({ email: 'owner@arso.sa', emailVerified: true });
    expect(r.body.organizations).toEqual([]);
  });

  it('لا يُخزَّن كلمة المرور نصًا', async () => {
    const [row] = await t.db
      .admin`SELECT password FROM auth_accounts a JOIN users u ON u.id = a.user_id
                                   WHERE u.email = 'owner@arso.sa'`;
    expect(row!.password).not.toContain('correct-horse-battery');
  });
});

describe('المؤسسات والمتاجر', () => {
  it('ينشئ مؤسسة ويصبح مالكها', async () => {
    const r = await owner.post('/api/v1/organizations').send({ name: 'وريف' }).expect(201);
    orgId = r.body.id;
    const me = await owner.get('/api/v1/me').expect(200);
    expect(me.body.organizations).toEqual([{ id: orgId, name: 'وريف', role: 'owner' }]);
  });

  it('يرفض اسمًا غير صالح بـ 422 ويذكر الحقل فقط', async () => {
    const r = await owner.post('/api/v1/organizations').send({ name: 'x', extra: 1 }).expect(422);
    expect(r.body.error.details.fields).toEqual(expect.arrayContaining(['name']));
  });

  it('المالك ينشئ متاجر ويراها', async () => {
    storeA = (
      await owner
        .post(`/api/v1/organizations/${orgId}/stores`)
        .send({ name: 'وريف الرئيسي' })
        .expect(201)
    ).body.id;
    storeB = (
      await owner
        .post(`/api/v1/organizations/${orgId}/stores`)
        .send({ name: 'وريف دبي', timezone: 'Asia/Dubai', currency: 'AED' })
        .expect(201)
    ).body.id;
    const r = await owner.get(`/api/v1/organizations/${orgId}/stores`).expect(200);
    expect(r.body.items.map((s: { id: string }) => s.id)).toEqual([storeA, storeB]);
  });

  it('منطقة زمنية غير معروفة مرفوضة', async () => {
    await owner
      .post(`/api/v1/organizations/${orgId}/stores`)
      .send({ name: 'X Store', timezone: 'Mars/Base' })
      .expect(422);
  });

  it('معرّف مؤسسة غير صالح = 404 لا خطأ خادم', async () => {
    await owner.get('/api/v1/organizations/not-a-uuid/stores').expect(404);
  });
});

describe('الدعوات والمنح والسحب', () => {
  let analyst: Awaited<ReturnType<typeof signUpVerified>>;
  let analystMembership = '';
  let token = '';

  it('المالك يدعو محللًا لمتجر واحد، ولا يُعاد الرمز في الرد', async () => {
    const r = await owner
      .post(`/api/v1/organizations/${orgId}/invitations`)
      .send({ email: 'Analyst@Arso.sa', role: 'analyst', storeIds: [storeA] })
      .expect(201);
    expect(JSON.stringify(r.body)).not.toMatch(/token/);
    token = linkFrom(t, 'analyst@arso.sa').searchParams.get('token')!;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('لا يمكن الدعوة إلى متجر من مؤسسة أخرى', async () => {
    const other = await signUpVerified(t, 'other-owner@arso.sa');
    const otherOrg = (
      await other.post('/api/v1/organizations').send({ name: 'Other Org' }).expect(201)
    ).body.id;
    const otherStore = (
      await other
        .post(`/api/v1/organizations/${otherOrg}/stores`)
        .send({ name: 'Other Store' })
        .expect(201)
    ).body.id;
    await owner
      .post(`/api/v1/organizations/${orgId}/invitations`)
      .send({ email: 'x@arso.sa', role: 'analyst', storeIds: [otherStore] })
      .expect(422);
    // ولا يرى متاجر مؤسسة الآخر
    await owner.get(`/api/v1/organizations/${otherOrg}/stores`).expect(404);
  });

  it('مستخدم ببريد آخر لا يقبل الدعوة', async () => {
    const intruder = await signUpVerified(t, 'intruder@evil.sa');
    const r = await intruder.post('/api/v1/invitations/accept').send({ token }).expect(404);
    expect(r.body.error.code).toBe('INVITATION_INVALID');
  });

  it('المدعو يقبل مرة واحدة ويرى متجره الممنوح فقط', async () => {
    analyst = await signUpVerified(t, 'analyst@arso.sa');
    await analyst.post('/api/v1/invitations/accept').send({ token }).expect(200);
    await analyst.post('/api/v1/invitations/accept').send({ token }).expect(404);
    const r = await analyst.get(`/api/v1/organizations/${orgId}/stores`).expect(200);
    expect(r.body.items.map((s: { id: string }) => s.id)).toEqual([storeA]);
  });

  it('المحلل لا يدعو ولا يرى الأعضاء ولا ينشئ متاجر', async () => {
    await analyst
      .post(`/api/v1/organizations/${orgId}/invitations`)
      .send({ email: 'y@arso.sa', role: 'analyst' })
      .expect(403);
    await analyst.get(`/api/v1/organizations/${orgId}/members`).expect(403);
    await analyst
      .post(`/api/v1/organizations/${orgId}/stores`)
      .send({ name: 'Sneaky Store' })
      .expect(403);
  });

  it('المالك يعدّل منح المحلل، ويُسجَّل قبل وبعد في التدقيق', async () => {
    const members = await owner.get(`/api/v1/organizations/${orgId}/members`).expect(200);
    analystMembership = members.body.items.find(
      (m: { email: string }) => m.email === 'analyst@arso.sa',
    ).id;
    await owner
      .put(`/api/v1/organizations/${orgId}/members/${analystMembership}/grants`)
      .send({ grants: [{ storeId: storeB, permissions: ['finance.read_summary'] }] })
      .expect(200);
    const r = await analyst.get(`/api/v1/organizations/${orgId}/stores`).expect(200);
    expect(r.body.items.map((s: { id: string }) => s.id)).toEqual([storeB]);

    const [audit] = await t.db.admin`
      SELECT before_state, after_state FROM audit_logs WHERE action = 'grants.update' ORDER BY id DESC LIMIT 1`;
    expect(audit!.before_state).toEqual([{ store_id: storeA, permissions: [] }]);
    expect(audit!.after_state).toEqual([
      { storeId: storeB, permissions: ['finance.read_summary'] },
    ]);
  });

  it('منحة على متجر من مؤسسة أخرى مرفوضة بـ 422 لا 500', async () => {
    const other = await signUpVerified(t, 'third-owner@arso.sa');
    const otherOrg = (
      await other.post('/api/v1/organizations').send({ name: 'Third Org' }).expect(201)
    ).body.id;
    const foreign = (
      await other
        .post(`/api/v1/organizations/${otherOrg}/stores`)
        .send({ name: 'Foreign Store' })
        .expect(201)
    ).body.id;
    await owner
      .put(`/api/v1/organizations/${orgId}/members/${analystMembership}/grants`)
      .send({ grants: [{ storeId: foreign, permissions: [] }] })
      .expect(422);
    const r = await analyst.get(`/api/v1/organizations/${orgId}/stores`).expect(200);
    expect(r.body.items.map((s: { id: string }) => s.id)).toEqual([storeB]);
  });

  it('صلاحية غير معروفة في المنحة مرفوضة', async () => {
    await owner
      .put(`/api/v1/organizations/${orgId}/members/${analystMembership}/grants`)
      .send({ grants: [{ storeId: storeA, permissions: ['god.mode'] }] })
      .expect(422);
  });

  it('صلاحيات المالك لا تُعدَّل ولا يسحب نفسه', async () => {
    const members = await owner.get(`/api/v1/organizations/${orgId}/members`).expect(200);
    const ownerMembership = members.body.items.find((m: { role: string }) => m.role === 'owner').id;
    await owner
      .put(`/api/v1/organizations/${orgId}/members/${ownerMembership}/grants`)
      .send({ grants: [] })
      .expect(409);
    await owner
      .post(`/api/v1/organizations/${orgId}/members/${ownerMembership}/revoke`)
      .expect(409);
  });

  it('السحب فوري: المحلل يفقد الوصول في الطلب التالي', async () => {
    await owner
      .post(`/api/v1/organizations/${orgId}/members/${analystMembership}/revoke`)
      .expect(200);
    await analyst.get(`/api/v1/organizations/${orgId}/stores`).expect(404);
    const me = await analyst.get('/api/v1/me').expect(200);
    expect(me.body.organizations).toEqual([]);
  });
});
