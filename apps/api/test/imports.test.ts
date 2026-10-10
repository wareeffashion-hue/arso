import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { linkFrom, signUpVerified, startApp, type TestApp } from './helpers.js';

let t: TestApp;
let owner: Awaited<ReturnType<typeof signUpVerified>>;
let orgId = '';
let storeId = '';
let base = '';

/** تاريخ اليوم بمنطقة الرياض، وتاريخ قبل n يومًا */
const riyadhDate = (offsetDays = 0) => {
  const d = new Date(Date.now() + 3 * 3_600_000 - offsetDays * 86_400_000);
  return d.toISOString().slice(0, 10);
};

const ORDERS_HEAD =
  'order_external_id,line_external_id,created_at,source_status,currency,variant_external_id,quantity,product_revenue_ex_tax,shipping_income_ex_tax';

// طلب القسم 33: قطعتان × 100، تكلفة 40، شحن محصل 10. وطلب ملغى وطلب بحالة غير معروفة
const ordersCsv = () =>
  [
    ORDERS_HEAD,
    `A1,L1,${riyadhDate(2)}T12:00:00+03:00,تم التوصيل,SAR,V1,2,200.00,10`,
    `A2,L1,${riyadhDate(0)}T00:30:00+03:00,تم التنفيذ,SAR,V2,1,150,0`,
    `A3,L1,${riyadhDate(1)}T09:00:00+03:00,ملغي,SAR,V1,1,100,0`,
    `A4,L1,${riyadhDate(1)}T09:00:00+03:00,حالة مخصصة,SAR,V1,1,100,0`,
    `A5,L1,not-a-date,تم التوصيل,SAR,V1,1,100,0`,
  ].join('\n');

function preview(agent = owner, kind: string, csv: string, extra = {}) {
  return agent.post(`${base}/imports`).send({ kind, fileName: `${kind}.csv`, csv, ...extra });
}

beforeAll(async () => {
  t = await startApp();
  owner = await signUpVerified(t, 'owner@shop.sa', 'المالك');
  orgId = (await owner.post('/api/v1/organizations').send({ name: 'متجر' }).expect(201)).body.id;
  storeId = (
    await owner
      .post(`/api/v1/organizations/${orgId}/stores`)
      .send({ name: 'المتجر الأول' })
      .expect(201)
  ).body.id;
  base = `/api/v1/organizations/${orgId}/stores/${storeId}`;
});
afterAll(async () => t?.close());

describe('النظرة العامة قبل أي بيانات (AC10)', () => {
  it('كل رقم غير متوفر: null لا صفر، ولا أرقام تجريبية', async () => {
    const r = await owner.get(`${base}/overview`).expect(200);
    for (const k of ['net_product_sales_ex_tax', 'ad_spend', 'eligible_order_count']) {
      expect(r.body.metrics[k]).toMatchObject({ value: null, quality: 'unavailable' });
    }
    expect(r.body.series.every((d: { netSales: null }) => d.netSales === null)).toBe(true);
    expect(r.body.series).toHaveLength(30);
  });
});

describe('استيراد الطلبات: معاينة ثم اعتماد', () => {
  let batch = '';

  it('المعاينة تصنف الصفوف وترفض غير الصالح بأسباب، ولا تكتب شيئًا', async () => {
    const r = await preview(owner, 'orders', ordersCsv()).expect(201);
    batch = r.body.id;
    expect(r.body.counts).toEqual({ create: 4, update: 0, duplicate: 0, rejected: 1 });
    expect(r.body.rejected[0]).toMatchObject({ line: 6 });
    expect(r.body.summary).toMatchObject({
      orders: 4,
      eligibleOrders: 2,
      excludedOrders: 1,
      needsReviewOrders: 1,
    });
    expect(r.body.summary.warnings[0]).toMatch(/حالة مخصصة/);
    const o = await owner.get(`${base}/overview`).expect(200);
    expect(o.body.metrics.net_product_sales_ex_tax.value).toBeNull();
  });

  it('ملف مختلف عن المعاين يُرفض عند الاعتماد', async () => {
    const r = await owner
      .post(`${base}/imports/${batch}/commit`)
      .send({ csv: ordersCsv() + '\n' })
      .expect(409);
    expect(r.body.error.code).toBe('IMPORT_FILE_CHANGED');
  });

  it('الاعتماد يكتب، والمبيعات للطلبات المؤهلة فقط بمنطقة المتجر', async () => {
    const r = await owner
      .post(`${base}/imports/${batch}/commit`)
      .send({ csv: ordersCsv() })
      .expect(200);
    expect(r.body.counts).toEqual({ create: 4, update: 0, duplicate: 0, rejected: 1 });
    const o = await owner.get(`${base}/overview`).expect(200);
    const m = o.body.metrics;
    expect(m.net_product_sales_ex_tax).toMatchObject({ value: '350.00', quality: 'incomplete' });
    expect(m.net_product_sales_ex_tax.warnings.join(' ')).toMatch(/حالة غير معروفة/);
    expect(m.eligible_order_count).toMatchObject({ value: '2', quality: 'incomplete' });
    expect(m.aov_products.value).toBe('175.00');
    expect(o.body.dataStatus.ordersInPeriod).toEqual({ eligible: 2, excluded: 1, needsReview: 1 });
    // طلب 00:30 بتوقيت الرياض = 21:30 UTC أمس، ويقع في يوم اليوم المحلي
    const today = o.body.series.at(-1);
    expect(today).toMatchObject({ date: riyadhDate(0), netSales: '150.00', orders: 1 });
  });

  it('المعاينة نفسها لا تُعتمد مرتين، ونفس الملف لا يُعتمد مرة ثانية', async () => {
    await owner.post(`${base}/imports/${batch}/commit`).send({ csv: ordersCsv() }).expect(409);
    const again = await preview(owner, 'orders', ordersCsv()).expect(201);
    expect(again.body.alreadyImported).toBe(true);
    expect(again.body.counts).toMatchObject({ create: 0, duplicate: 4 });
    const r = await owner
      .post(`${base}/imports/${again.body.id}/commit`)
      .send({ csv: ordersCsv() })
      .expect(409);
    expect(r.body.error.code).toBe('IMPORT_ALREADY_COMMITTED');
  });

  it('ملف معدّل يحدّث الطلب ولا يكرره', async () => {
    const csv = ordersCsv().replace('A4,L1', 'A4,L1').replace('حالة مخصصة', 'تم الشحن');
    const p = await preview(owner, 'orders', csv).expect(201);
    expect(p.body.counts).toMatchObject({ create: 0, update: 1, duplicate: 3 });
    await owner.post(`${base}/imports/${p.body.id}/commit`).send({ csv }).expect(200);
    const o = await owner.get(`${base}/overview`).expect(200);
    expect(o.body.metrics.eligible_order_count).toMatchObject({ value: '3', quality: 'complete' });
    expect(o.body.metrics.net_product_sales_ex_tax.value).toBe('450.00');
  });

  it('أعمدة ناقصة = 422 بسبب واضح', async () => {
    const r = await preview(owner, 'orders', 'order_external_id\nA1').expect(422);
    expect(r.body.error.code).toBe('IMPORT_FILE_INVALID');
    expect(r.body.error.message).toMatch(/ناقصة/);
  });
});

describe('التكاليف والهامش (AC01 وAC05)', () => {
  const costs = (rows: string[]) =>
    ['variant_external_id,currency,cost_ex_tax,valid_from,source_note', ...rows].join('\n');

  async function importCsv(kind: string, csv: string) {
    const p = await preview(owner, kind, csv).expect(201);
    await owner.post(`${base}/imports/${p.body.id}/commit`).send({ csv }).expect(200);
    return p.body;
  }

  it('تكلفة ناقصة لبعض البنود: لا هامش كامل، مع التغطية ورقم ثانوي موسوم', async () => {
    await importCsv('costs', costs([`V1,SAR,40,2026-01-01,فاتورة`]));
    const o = await owner.get(`${base}/overview`).expect(200);
    const m = o.body.metrics;
    expect(m.product_margin_after_cogs).toMatchObject({ value: null, quality: 'incomplete' });
    expect(m.product_margin_after_cogs.secondary).toEqual({
      label: 'على البنود ذات التكلفة فقط',
      value: '180.00', // (200 − 80) + (100 − 40): A1 وA4، دون A2 بلا تكلفة
    });
    expect(m.cost_coverage_value.value).toBe('0.6667');
    expect(m.contribution_post_marketing).toMatchObject({ value: null, quality: 'incomplete' });
  });

  it('اكتمال التكاليف يعطي الهامش، وتغيير التكلفة اليوم لا يمس الطلبات السابقة', async () => {
    await importCsv('costs', costs([`V2,SAR,60,2026-01-01,`]));
    let m = (await owner.get(`${base}/overview`).expect(200)).body.metrics;
    expect(m.product_margin_after_cogs.value).toBe('270.00'); // 450 − 40×3 − 60
    expect(m.cost_coverage_value.value).toBe('1');

    // سعر جديد يسري من الغد: الطلبات الحالية تبقى بتكلفتها التاريخية
    await importCsv('costs', costs([`V1,SAR,90,${riyadhDate(-1)},مورد جديد`]));
    m = (await owner.get(`${base}/overview`).expect(200)).body.metrics;
    expect(m.product_margin_after_cogs.value).toBe('270.00');

    // تصحيح معتمد لنفس تاريخ السريان: نسخة جديدة تُعيد البيان، والقديمة محفوظة
    const p = await importCsv('costs', costs([`V1,SAR,45,2026-01-01,تصحيح فاتورة`]));
    expect(p.counts).toMatchObject({ update: 1 });
    m = (await owner.get(`${base}/overview`).expect(200)).body.metrics;
    expect(m.product_margin_after_cogs.value).toBe('255.00'); // 450 − 45×3 − 60
    const versions = await t.db.admin`
      SELECT cost_ex_tax::text, revision FROM cost_versions
      WHERE variant_external_id = 'V1' AND valid_from = '2026-01-01T00:00:00+03:00' ORDER BY revision`;
    expect(versions.map((v) => [v.cost_ex_tax, v.revision])).toEqual([
      ['40.000000', 1],
      ['45.000000', 2],
    ]);
  });
});

describe('الإنفاق الإعلاني (AC15)', () => {
  it('عملة أخرى لا تُجمع، ومنطقة التقرير المختلفة تُذكر', async () => {
    const csv = [
      'provider,account_external_id,campaign_external_id,report_date,report_timezone,currency,spend',
      `snapchat,ACC,C1,${riyadhDate(1)},Asia/Riyadh,SAR,100`,
      `snapchat,ACC,C1,${riyadhDate(2)},Asia/Riyadh,SAR,50.5`,
      `meta,M1,C9,${riyadhDate(1)},America/Los_Angeles,USD,30`,
    ].join('\n');
    const p = await preview(owner, 'ad_spend', csv).expect(201);
    expect(p.body.summary.warnings.join(' ')).toMatch(/America\/Los_Angeles/);
    await owner.post(`${base}/imports/${p.body.id}/commit`).send({ csv }).expect(200);
    const m = (await owner.get(`${base}/overview`).expect(200)).body.metrics;
    expect(m.ad_spend).toMatchObject({ value: '150.50', quality: 'incomplete' });
    expect(m.ad_spend.warnings.join(' ')).toMatch(/USD/);
    expect(m.blended_sales_to_ad_spend.value).toBe('2.99');
  });
});

describe('الصلاحيات (AC02) والعزل', () => {
  it('المحلل يرى المبيعات بلا التكاليف والهامش، ولا يستورد', async () => {
    await owner
      .post(`/api/v1/organizations/${orgId}/invitations`)
      .send({ email: 'analyst@shop.sa', role: 'analyst', storeIds: [storeId] })
      .expect(201);
    const token = linkFrom(t, 'analyst@shop.sa').searchParams.get('token')!;
    const analyst = await signUpVerified(t, 'analyst@shop.sa');
    await analyst.post('/api/v1/invitations/accept').send({ token }).expect(200);

    const o = await analyst.get(`${base}/overview`).expect(200);
    expect(o.body.metrics.net_product_sales_ex_tax.value).toBe('450.00');
    expect(o.body.metrics.product_margin_after_cogs).toBeUndefined();
    expect(o.body.metrics.cost_coverage_value).toBeUndefined();
    expect(o.body.restricted).toContain('product_margin_after_cogs');
    expect(JSON.stringify(o.body)).not.toMatch(/cogs":|270\.00|255\.00/);
    await preview(analyst, 'orders', ordersCsv()).expect(403);
    await preview(
      analyst,
      'costs',
      'variant_external_id,currency,cost_ex_tax,valid_from\nV1,SAR,1,2026-01-01',
    ).expect(403);
  });

  it('المالية تستورد التكاليف، والإبداعي لا يقرأ المؤشرات', async () => {
    for (const [email, role] of [
      ['finance@shop.sa', 'finance'],
      ['creative@shop.sa', 'creative'],
    ] as const) {
      await owner
        .post(`/api/v1/organizations/${orgId}/invitations`)
        .send({ email, role, storeIds: [storeId] })
        .expect(201);
    }
    const accept = async (email: string) => {
      const token = linkFrom(t, email).searchParams.get('token')!;
      const agent = await signUpVerified(t, email);
      await agent.post('/api/v1/invitations/accept').send({ token }).expect(200);
      return agent;
    };
    const finance = await accept('finance@shop.sa');
    const creative = await accept('creative@shop.sa');

    const csv = 'variant_external_id,currency,cost_ex_tax,valid_from\nV9,SAR,5,2026-01-01';
    const p = await preview(finance, 'costs', csv).expect(201);
    await finance.post(`${base}/imports/${p.body.id}/commit`).send({ csv }).expect(200);
    await preview(finance, 'orders', ordersCsv()).expect(403);
    await creative.get(`${base}/overview`).expect(403);
  });

  it('مؤسسة أخرى لا ترى المتجر ولا تعتمد معاينته', async () => {
    const other = await signUpVerified(t, 'other@shop.sa');
    await other.post('/api/v1/organizations').send({ name: 'أخرى' }).expect(201);
    await other.get(`${base}/overview`).expect(404);
    const p = await preview(owner, 'orders', ordersCsv().replace('A1,', 'Z1,')).expect(201);
    await other.post(`${base}/imports/${p.body.id}/commit`).send({ csv: 'x' }).expect(404);
    await other.get(`${base}/imports`).expect(404);
  });

  it('سجل الاستيراد والتدقيق', async () => {
    const r = await owner.get(`${base}/imports`).expect(200);
    expect(r.body.items.length).toBeGreaterThanOrEqual(6);
    expect(JSON.stringify(r.body)).not.toMatch(/checksum/);
    const [a] = await t.db
      .admin`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'import.commit'`;
    expect(a!.n).toBe(r.body.items.length);
  });
});
