import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { linkFrom, signUpVerified, startApp, type TestApp } from './helpers.js';

let t: TestApp;
type Agent = Awaited<ReturnType<typeof signUpVerified>>;
let owner: Agent;
let manager: Agent;
let analyst: Agent;
let orgId = '';
let storeId = '';
let base = '';
const ids: Record<string, string> = {};

async function join(email: string, name: string, role: string): Promise<Agent> {
  await owner
    .post(`/api/v1/organizations/${orgId}/invitations`)
    .send({ email, role, storeIds: [storeId] })
    .expect(201);
  const token = linkFrom(t, email).searchParams.get('token')!;
  const agent = await signUpVerified(t, email, name);
  await agent.post('/api/v1/invitations/accept').send({ token }).expect(200);
  return agent;
}

async function problem(ruleId: string, title: string) {
  const [p] = await t.db.admin<{ id: string }[]>`
    INSERT INTO problems (organization_id, store_id, rule_id, rule_version, signature, kind,
      score_impact, score_evidence, score_fit, score_feasibility, quality, title, observation, action)
    VALUES (${orgId}, ${storeId}, ${ruleId}, '1', ${`${storeId}/${ruleId}`},
      ${ruleId === 'Q03' ? 'contribution' : 'quality'}, 2, 3, 2, 2, 'complete', ${title},
      ${t.db.admin.json({ text: 'ملاحظة', values: {} })}, 'أكمل التكاليف')
    RETURNING id`;
  return p!.id;
}

beforeAll(async () => {
  t = await startApp();
  owner = await signUpVerified(t, 'owner@tasks.sa', 'المالك');
  orgId = (await owner.post('/api/v1/organizations').send({ name: 'مهام' }).expect(201)).body.id;
  storeId = (
    await owner.post(`/api/v1/organizations/${orgId}/stores`).send({ name: 'المتجر' }).expect(201)
  ).body.id;
  base = `/api/v1/organizations/${orgId}/stores/${storeId}`;
  manager = await join('mm@tasks.sa', 'مدير التسويق', 'marketing_manager');
  analyst = await join('an@tasks.sa', 'المحلل', 'analyst');
  const people = (await owner.get(`${base}/problems/assignees`).expect(200)).body.items;
  for (const p of people) ids[p.name] = p.id;
});
afterAll(async () => t?.close());

describe('المهام (القسم 28)', () => {
  let taskId = '';
  let rev = 0;

  it('مهمة من بطاقة مشكلة: مسودة ثم إنشاء مسند بتكلفة', async () => {
    const q01 = await problem('Q01', 'متغيرات بلا تكلفة');
    const draft = (await owner.get(`${base}/problems/${q01}/task-draft`).expect(200)).body;
    expect(draft).toMatchObject({ title: 'أكمل التكاليف', problemId: q01 });
    const r = await owner
      .post(`${base}/tasks`)
      .send({
        ...draft,
        acceptanceCriteria: 'كل متغير مبيع له تكلفة سارية',
        ownerMembershipId: ids['المحلل'],
        dueOn: '2026-11-01',
        costAmount: '150.5',
      })
      .expect(201);
    expect(r.body).toMatchObject({
      status: 'assigned',
      owner: { name: 'المحلل' },
      cost: { amount: '150.50', currency: 'SAR' },
      problem: { id: q01 },
    });
    taskId = r.body.id;
    rev = r.body.revision;
    const p = (await owner.get(`${base}/problems/${q01}`).expect(200)).body;
    expect(p.events[0].body).toMatch(/أُنشئت مهمة/);
  });

  it('المحلل المسؤول يبدأ ويسلّم للمراجعة، ولا يقبل عمله ولا يرى التكلفة', async () => {
    const list = (await analyst.get(`${base}/tasks`).expect(200)).body;
    expect(list.canCreate).toBe(false);
    expect(list.items[0].cost).toBeUndefined();
    expect(list.items[0].nextStatuses).toEqual(['in_progress']);
    await analyst.post(`${base}/tasks`).send({ title: 'مهمة' }).expect(403);
    let r = await analyst
      .patch(`${base}/tasks/${taskId}`)
      .send({ revision: rev, status: 'in_progress' })
      .expect(200);
    r = await analyst
      .patch(`${base}/tasks/${taskId}`)
      .send({ revision: r.body.revision, status: 'review' })
      .expect(200);
    rev = r.body.revision;
    await analyst
      .patch(`${base}/tasks/${taskId}`)
      .send({ revision: rev, status: 'accepted', result: 'تم' })
      .expect(422);
    await analyst
      .patch(`${base}/tasks/${taskId}`)
      .send({ revision: rev, dueOn: '2026-12-01' })
      .expect(403);
  });

  it('القبول يحتاج نتيجة، والمراجعة المتفائلة تمنع الكتابة فوق تعديل أحدث', async () => {
    const none = await manager
      .patch(`${base}/tasks/${taskId}`)
      .send({ revision: rev, status: 'accepted' })
      .expect(422);
    expect(none.body.error.code).toBe('RESULT_REQUIRED');
    const ok = await manager
      .patch(`${base}/tasks/${taskId}`)
      .send({ revision: rev, status: 'accepted', result: 'أُضيفت تكاليف 5 متغيرات' })
      .expect(200);
    expect(ok.body).toMatchObject({
      status: 'accepted',
      final: true,
      result: 'أُضيفت تكاليف 5 متغيرات',
    });
    expect(ok.body.events[0]).toMatchObject({ kind: 'status', toStatus: 'accepted' });
    await manager.patch(`${base}/tasks/${taskId}`).send({ revision: rev, title: 'xx' }).expect(409);
    await manager
      .patch(`${base}/tasks/${taskId}`)
      .send({ revision: ok.body.revision, title: 'تعديل بعد الإغلاق' })
      .expect(409);
  });

  it('الإلغاء يحتاج سببًا، والإسناد لعضو يرى المتجر فقط', async () => {
    const r = await manager
      .post(`${base}/tasks`)
      .send({ title: 'صوّر المنتجات الجديدة' })
      .expect(201);
    expect(r.body.status).toBe('open');
    await manager
      .patch(`${base}/tasks/${r.body.id}`)
      .send({ revision: r.body.revision, status: 'cancelled' })
      .expect(422);
    const other = await signUpVerified(t, 'x@other.sa');
    await other.post('/api/v1/organizations').send({ name: 'أخرى' }).expect(201);
    const [foreign] = await t.db.admin`
      SELECT m.id FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.email = 'x@other.sa'`;
    await manager
      .patch(`${base}/tasks/${r.body.id}`)
      .send({ revision: r.body.revision, ownerMembershipId: foreign!.id })
      .expect(422);
    const c = await manager
      .patch(`${base}/tasks/${r.body.id}`)
      .send({ revision: r.body.revision, status: 'cancelled', cancelReason: 'المنتجات تأجلت' })
      .expect(200);
    expect(c.body.cancelReason).toBe('المنتجات تأجلت');
    await other.get(`${base}/tasks/${r.body.id}`).expect(404);
  });

  it('مهمة مرتبطة بمشكلة مالية لا تظهر لمن لا يقرأ المالية (AC02)، ومدير التسويق لا يحدد تكلفة', async () => {
    const q03 = await problem('Q03', 'هامش المنتجات تراجع');
    await analyst.get(`${base}/problems/${q03}`).expect(404);
    const r = await owner
      .post(`${base}/tasks`)
      .send({ title: 'راجع الخصومات', problemId: q03 })
      .expect(201);
    const list = (await analyst.get(`${base}/tasks`).expect(200)).body.items;
    expect(list.find((x: { id: string }) => x.id === r.body.id)).toBeUndefined();
    await analyst.get(`${base}/tasks/${r.body.id}`).expect(404);
    await manager.post(`${base}/tasks`).send({ title: 'راجع', problemId: q03 }).expect(422);
    await manager
      .post(`${base}/tasks`)
      .send({ title: 'إعلان جديد', costAmount: '500' })
      .expect(403);
  });

  it('التعليقات للقارئ، والسجل يحفظها', async () => {
    const c = await analyst
      .post(`${base}/tasks/${taskId}/comments`)
      .send({ body: 'رفعت الملف' })
      .expect(201);
    expect(c.body.events[0]).toMatchObject({
      kind: 'comment',
      body: 'رفعت الملف',
      actor: 'المحلل',
    });
    const [a] = await t.db
      .admin`SELECT count(*)::int AS n FROM audit_logs WHERE action LIKE 'task.%'`;
    expect(a!.n).toBeGreaterThanOrEqual(6);
  });
});
