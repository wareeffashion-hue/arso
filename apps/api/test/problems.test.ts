import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { linkFrom, signUpVerified, startApp, type TestApp } from './helpers.js';

let t: TestApp;
let owner: Awaited<ReturnType<typeof signUpVerified>>;
let analyst: Awaited<ReturnType<typeof signUpVerified>>;
let orgId = '';
let storeId = '';
let base = '';

const day = (offset: number) =>
  new Date(Date.now() + 3 * 3_600_000 - offset * 86_400_000).toISOString().slice(0, 10);

const HEAD =
  'order_external_id,line_external_id,created_at,source_status,currency,variant_external_id,quantity,product_revenue_ex_tax,shipping_income_ex_tax';

/** 32 طلبًا في كل فترة: الفترة السابقة بسعر 100 والحالية بسعر 80، والتكلفة 40 */
function ordersCsv(withUncosted: boolean) {
  const rows = [HEAD];
  for (let i = 0; i < 32; i++) {
    rows.push(`P${i},1,${day(35 + (i % 20))}T12:00:00+03:00,تم التوصيل,SAR,V1,1,100,0`);
    rows.push(`C${i},1,${day(1 + (i % 20))}T12:00:00+03:00,تم التوصيل,SAR,V1,1,80,0`);
  }
  if (withUncosted) rows.push(`N1,1,${day(2)}T12:00:00+03:00,تم التوصيل,SAR,V9,1,500,0`);
  rows.push(`U1,1,${day(3)}T12:00:00+03:00,بانتظار الشحن الخاص,SAR,V1,1,80,0`);
  return rows.join('\n');
}

async function importCsv(kind: string, csv: string) {
  const p = await owner
    .post(`${base}/imports`)
    .send({ kind, fileName: `${kind}.csv`, csv })
    .expect(201);
  await owner.post(`${base}/imports/${p.body.id}/commit`).send({ csv }).expect(200);
}

interface Card {
  id: string;
  ruleId: string;
  revision: number;
  status: string;
  quality: string;
  canManage: boolean;
  conditionClearedAt: string | null;
  statusReason: string | null;
  score: { impact: number; total: number };
  observation: { text: string; values: Record<string, unknown> };
  evidence: { label: string; value: string }[];
  hypotheses: { text: string; signal: string }[];
}

const byRule = (items: Card[], id: string) => items.find((i) => i.ruleId === id);

beforeAll(async () => {
  t = await startApp();
  owner = await signUpVerified(t, 'owner@diag.sa', 'المالك');
  orgId = (await owner.post('/api/v1/organizations').send({ name: 'تشخيص' }).expect(201)).body.id;
  storeId = (
    await owner.post(`/api/v1/organizations/${orgId}/stores`).send({ name: 'المتجر' }).expect(201)
  ).body.id;
  base = `/api/v1/organizations/${orgId}/stores/${storeId}`;
  await owner
    .post(`/api/v1/organizations/${orgId}/invitations`)
    .send({ email: 'analyst@diag.sa', role: 'analyst', storeIds: [storeId] })
    .expect(201);
  const token = linkFrom(t, 'analyst@diag.sa').searchParams.get('token')!;
  analyst = await signUpVerified(t, 'analyst@diag.sa', 'المحلل');
  await analyst.post('/api/v1/invitations/accept').send({ token }).expect(200);
});
afterAll(async () => t?.close());

describe('قواعد التشخيص على بيانات مستوردة', () => {
  it('بلا بيانات: لا بطاقات، والقواعد Q04–Q08 تنتظر بيانات', async () => {
    const r = await owner.get(`${base}/problems`).expect(200);
    expect(r.body.items).toEqual([]);
    expect(r.body.waiting.map((w: { id: string }) => w.id)).toEqual([
      'Q04',
      'Q05',
      'Q06',
      'Q07',
      'Q08',
    ]);
  });

  it('Q01 وDQ01 تظهران بعد الاستيراد مباشرة، والملاحظة منفصلة عن الفرضيات', async () => {
    await importCsv('orders', ordersCsv(true));
    await importCsv(
      'costs',
      'variant_external_id,currency,cost_ex_tax,valid_from\nV1,SAR,40,2020-01-01',
    );
    const r = await owner.get(`${base}/problems`).expect(200);
    const q01 = byRule(r.body.items, 'Q01')!;
    expect(q01.observation.values).toMatchObject({
      uncoveredValue: '500.00',
      lines: 1,
      variants: 1,
    });
    expect(q01.evidence[0]).toMatchObject({ label: 'V9' });
    expect(q01.hypotheses.every((h: { signal: string }) => h.signal === 'unknown')).toBe(true);
    expect(q01.score).toMatchObject({ evidence: 3, total: q01.score.impact + 7 });
    const dq01 = byRule(r.body.items, 'DQ01')!;
    expect(dq01.observation.text).toMatch(/1 طلب/);
    expect(dq01.evidence[0]!.label).toBe('بانتظار الشحن الخاص');
    // التكلفة ناقصة في الفترة الحالية، فلا تشخيص للهامش بعد
    expect(byRule(r.body.items, 'Q03')).toBeUndefined();
  });

  it('اكتمال التكلفة يزيل شرط Q01 دون تغيير حالتها، ويظهر Q03 بتفكيك السعر والتكلفة', async () => {
    await importCsv(
      'costs',
      'variant_external_id,currency,cost_ex_tax,valid_from\nV9,SAR,200,2020-01-01',
    );
    const r = await owner.get(`${base}/problems`).expect(200);
    const q01 = byRule(r.body.items, 'Q01')!;
    expect(q01.conditionClearedAt).not.toBeNull();
    expect(q01.status).toBe('new');
    const q03 = byRule(r.body.items, 'Q03')!;
    expect(q03.quality).toBe('complete');
    expect(q03.observation.values).toMatchObject({ previousRate: '60.0', currentOrders: 33 });
    expect(q03.hypotheses[0]).toEqual({ text: 'خصومات أكبر أو سعر بيع أقل', signal: 'consistent' });
    // V9 الجديد يرفع متوسط تكلفة الوحدة، لكن تكلفة المورد لنفس المتغيرات لم تتغير
    expect(q03.hypotheses[1]!.signal).toBe('not_indicated');
    expect(q03.hypotheses[2]!.signal).toBe('unknown');
    const lfl = q03.evidence.find((e: { label: string }) => e.label === 'تكلفة الوحدة مثلًا بمثل');
    expect(lfl!.value).toBe('+0.0٪');
    // ترتيب داخلي بمكوناته، والأعلى أولًا
    const totals = r.body.items.map((i: { score: { total: number } }) => i.score.total);
    expect([...totals].sort((a, b) => b - a)).toEqual(totals);
  });

  it('إعادة الفحص لا تكرر البطاقات', async () => {
    const before = (await owner.get(`${base}/problems`).expect(200)).body.items.length;
    await owner.post(`${base}/problems/evaluate`).expect(200);
    await owner.post(`${base}/problems/evaluate`).expect(200);
    const after = (await owner.get(`${base}/problems`).expect(200)).body.items.length;
    expect(after).toBe(before);
  });

  it('DQ02: الإنفاق بعملة أخرى، وQ02: بيانات قديمة', async () => {
    await importCsv(
      'ad_spend',
      `provider,account_external_id,report_date,report_timezone,currency,spend\nsnapchat,A,${day(2)},Asia/Riyadh,USD,50`,
    );
    await t.db
      .admin`UPDATE import_batches SET committed_at = now() - interval '10 days' WHERE kind = 'orders'`;
    const r = await owner.post(`${base}/problems/evaluate`).expect(200);
    expect(byRule(r.body.items, 'DQ02')!.observation.values).toEqual({ USD: '50.000000' });
    expect(byRule(r.body.items, 'Q02')!.observation.values.daysSinceLastImport).toBe(10);
  });
});

describe('إدارة البطاقات والصلاحيات', () => {
  it('المحلل لا يرى Q03 المالية، ولا يدير البطاقات', async () => {
    const all = (await owner.get(`${base}/problems`).expect(200)).body.items;
    const q03 = byRule(all, 'Q03')!;
    const r = await analyst.get(`${base}/problems`).expect(200);
    expect(byRule(r.body.items, 'Q03')).toBeUndefined();
    expect(r.body.hiddenRules).toEqual(['Q03']);
    expect(JSON.stringify(r.body)).not.toMatch(/60\.0/);
    await analyst.get(`${base}/problems/${q03.id}`).expect(404);
    const dq01 = byRule(r.body.items, 'DQ01')!;
    expect(dq01.canManage).toBe(false);
    await analyst
      .patch(`${base}/problems/${dq01.id}`)
      .send({ revision: dq01.revision, status: 'triaged' })
      .expect(403);
  });

  it('الانتقالات والأسباب والمراجعة المتفائلة', async () => {
    const items = (await owner.get(`${base}/problems`).expect(200)).body.items;
    const p = byRule(items, 'DQ02')!;
    await owner
      .patch(`${base}/problems/${p.id}`)
      .send({ revision: p.revision, status: 'resolved' })
      .expect(422);
    const noReason = await owner
      .patch(`${base}/problems/${p.id}`)
      .send({ revision: p.revision, status: 'deferred' })
      .expect(422);
    expect(noReason.body.error.code).toBe('REASON_REQUIRED');
    const ok = await owner
      .patch(`${base}/problems/${p.id}`)
      .send({ revision: p.revision, status: 'accepted' })
      .expect(200);
    expect(ok.body).toMatchObject({ status: 'accepted', revision: p.revision + 1 });
    const stale = await owner
      .patch(`${base}/problems/${p.id}`)
      .send({ revision: p.revision, status: 'in_progress' })
      .expect(409);
    expect(stale.body.error.code).toBe('REVISION_CONFLICT');
  });

  it('الإسناد لعضو يرى المتجر فقط، والتعليقات في السجل', async () => {
    const items = (await owner.get(`${base}/problems`).expect(200)).body.items;
    const p = byRule(items, 'Q01')!;
    const people = (await owner.get(`${base}/problems/assignees`).expect(200)).body.items;
    const analystId = people.find((a: { name: string }) => a.name === 'المحلل').id;
    const r = await owner
      .patch(`${base}/problems/${p.id}`)
      .send({ revision: p.revision, ownerMembershipId: analystId, dueOn: '2026-12-01' })
      .expect(200);
    expect(r.body.owner).toEqual({ id: analystId, name: 'المحلل' });
    expect(JSON.stringify(people)).not.toMatch(/@/);

    const other = await signUpVerified(t, 'other@diag.sa');
    await other.post('/api/v1/organizations').send({ name: 'أخرى' }).expect(201);
    const [foreign] = await t.db.admin`
      SELECT m.id FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.email = 'other@diag.sa'`;
    await owner
      .patch(`${base}/problems/${p.id}`)
      .send({ revision: r.body.revision, ownerMembershipId: foreign!.id })
      .expect(422);

    const c = await analyst
      .post(`${base}/problems/${p.id}/comments`)
      .send({ body: 'أضفت V9 للمورد' })
      .expect(201);
    expect(c.body.events[0]).toMatchObject({
      kind: 'comment',
      body: 'أضفت V9 للمورد',
      actor: 'المحلل',
    });
    await other.get(`${base}/problems/${p.id}`).expect(404);
  });

  it('الرفض بسبب يحترم القرار: لا تعود نفس البطاقة ما دام الشرط قائمًا', async () => {
    const items = (await owner.get(`${base}/problems`).expect(200)).body.items;
    const p = byRule(items, 'DQ01')!;
    await owner
      .patch(`${base}/problems/${p.id}`)
      .send({ revision: p.revision, status: 'rejected', reason: 'حالة داخلية لطلبات تجريبية' })
      .expect(200);
    const r = await owner.post(`${base}/problems/evaluate`).expect(200);
    const dq01 = r.body.items.filter((i: { ruleId: string }) => i.ruleId === 'DQ01');
    expect(dq01).toHaveLength(1);
    expect(dq01[0]).toMatchObject({
      status: 'rejected',
      statusReason: 'حالة داخلية لطلبات تجريبية',
    });
    const [a] = await t.db
      .admin`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'problem.update'`;
    expect(a!.n).toBeGreaterThanOrEqual(3);
  });
});
