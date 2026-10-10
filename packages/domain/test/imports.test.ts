import { describe, expect, it } from 'vitest';
import {
  classifyOrderStatus,
  CsvError,
  parseCsv,
  validateAdSpend,
  validateCosts,
  validateOrders,
  zonedToUtc,
  type ImportOptions,
} from '../src/index.js';

const STORE = '6f1c2a8e-0000-4000-8000-000000000001';
const opts: ImportOptions = {
  storeId: STORE,
  storeCurrency: 'SAR',
  storeTimezone: 'Asia/Riyadh',
  naiveTimezone: null,
};

describe('قارئ CSV', () => {
  it('يقرأ الاقتباس والفواصل والأسطر داخل الحقل وBOM وCRLF', () => {
    const t = parseCsv('﻿A,B\r\n"x, y","say ""hi"""\r\n"multi\nline",2\r\n\r\n');
    expect(t.header).toEqual(['a', 'b']);
    expect(t.rows.map((r) => r.cells)).toEqual([
      ['x, y', 'say "hi"'],
      ['multi\nline', '2'],
    ]);
    expect(t.rows[1]!.line).toBe(3);
  });

  it('يرفض اقتباسًا لم يُغلق وعمودًا مكررًا وملفًا فارغًا', () => {
    expect(() => parseCsv('a,b\n"x,1')).toThrow(CsvError);
    expect(() => parseCsv('a,a\n1,2')).toThrow(/مكرر/);
    expect(() => parseCsv('')).toThrow(/فارغ/);
  });
});

describe('خريطة حالات الطلب', () => {
  it('المعروف يُصنف، وغير المعروف للمراجعة لا للإيراد', () => {
    expect(classifyOrderStatus('تم التوصيل')).toBe('eligible');
    expect(classifyOrderStatus('Completed')).toBe('eligible');
    expect(classifyOrderStatus('ملغي')).toBe('excluded');
    expect(classifyOrderStatus('بإنتظار الدفع')).toBe('excluded');
    expect(classifyOrderStatus('حالة مخصصة')).toBe('needs_review');
  });
});

describe('المنطقة الزمنية', () => {
  it('منتصف الليل في الرياض = 21:00 UTC من اليوم السابق', () => {
    expect(zonedToUtc(2026, 10, 1, 0, 0, 0, 'Asia/Riyadh').toISOString()).toBe(
      '2026-09-30T21:00:00.000Z',
    );
  });
  it('يحترم التوقيت الصيفي', () => {
    expect(zonedToUtc(2026, 7, 1, 12, 0, 0, 'Europe/London').toISOString()).toBe(
      '2026-07-01T11:00:00.000Z',
    );
  });
});

const ORDERS_HEAD =
  'order_external_id,line_external_id,created_at,source_status,currency,variant_external_id,quantity,product_revenue_ex_tax,shipping_income_ex_tax';

describe('ملف الطلبات', () => {
  it('ينقّي الصفوف الصالحة ويرفض غيرها بأسباب، والغياب يبقى null', () => {
    const t = parseCsv(
      [
        ORDERS_HEAD,
        'o1,l1,2026-10-01T10:00:00+03:00,تم التوصيل,SAR,v1,2,200.00,10',
        'o1,l2,2026-10-01T10:00:00+03:00,تم التوصيل,SAR,v2,1,50,10',
        'o2,l1,2026-10-02T10:00:00Z,حالة غريبة,SAR,v1,1,100,',
        'o3,l1,2026-10-02 10:00,تم التوصيل,SAR,v1,0,-5,0',
        'o4,l1,2026-10-02T10:00:00Z,تم التوصيل,USD,v1,1,100,0',
      ].join('\n'),
    );
    const v = validateOrders(t, opts);
    expect(v.rows).toHaveLength(3);
    expect(v.rows[0]).toMatchObject({ eligibility: 'eligible', shippingIncomeExTax: '10' });
    expect(v.rows[2]).toMatchObject({ eligibility: 'needs_review', shippingIncomeExTax: null });
    expect(v.rows[0]!.createdAt).toBe('2026-10-01T07:00:00.000Z');
    const r3 = v.rejected.find((r) => r.line === 5)!;
    expect(r3.reasons.join(' ')).toMatch(/منطقة زمنية/);
    expect(r3.reasons.join(' ')).toMatch(/quantity/);
    expect(r3.reasons.join(' ')).toMatch(/سالبة/);
    expect(v.rejected.find((r) => r.line === 6)!.reasons[0]).toMatch(/USD/);
  });

  it('الوقت بلا منطقة يُقبل بعد اختيار المنطقة صراحة', () => {
    const t = parseCsv(`${ORDERS_HEAD}\no1,l1,2026-10-01 10:00,تم التوصيل,SAR,v1,1,10,`);
    const v = validateOrders(t, { ...opts, naiveTimezone: 'Asia/Riyadh' });
    expect(v.rows[0]!.createdAt).toBe('2026-10-01T07:00:00.000Z');
  });

  it('شحن مختلف بين بنود نفس الطلب يرفض الطلب كله', () => {
    const t = parseCsv(
      [
        ORDERS_HEAD,
        'o1,l1,2026-10-01T10:00:00Z,تم التوصيل,SAR,v1,1,10,10',
        'o1,l2,2026-10-01T10:00:00Z,تم التوصيل,SAR,v2,1,10,15',
      ].join('\n'),
    );
    const v = validateOrders(t, opts);
    expect(v.rows).toEqual([]);
    expect(v.rejected).toHaveLength(2);
    expect(v.rejected[0]!.reasons).toEqual(['الشحن المحصّل يختلف بين بنود الطلب o1']);
  });

  it('بند مكرر في الملف وصف لمتجر آخر مرفوضان', () => {
    const t = parseCsv(
      [
        `store_external_id,${ORDERS_HEAD}`,
        `${STORE},o1,l1,2026-10-01T10:00:00Z,تم التوصيل,SAR,v1,1,10,`,
        `${STORE},o1,l1,2026-10-01T10:00:00Z,تم التوصيل,SAR,v1,1,10,`,
        `other-store,o2,l1,2026-10-01T10:00:00Z,تم التوصيل,SAR,v1,1,10,`,
      ].join('\n'),
    );
    const v = validateOrders(t, opts);
    expect(v.rows).toHaveLength(1);
    expect(v.rejected.map((r) => r.reasons[0])).toEqual([
      'بند مكرر في نفس الملف',
      'الصف لمتجر آخر غير الذي صدر له القالب',
    ]);
  });

  it('أعمدة ناقصة ترفض الملف كله', () => {
    const v = validateOrders(parseCsv('order_external_id\no1'), opts);
    expect(v.fileErrors[0]).toMatch(/ناقصة/);
  });

  it('لا يقبل فواصل الآلاف لأنها ملتبسة', () => {
    const t = parseCsv(`${ORDERS_HEAD}\no1,l1,2026-10-01T10:00:00Z,تم,SAR,v1,1,"1,200",`);
    expect(validateOrders(t, opts).rejected[0]!.reasons[0]).toMatch(/رقم عشري/);
  });
});

describe('ملف التكاليف', () => {
  it('التاريخ وحده يبدأ من منتصف ليل المتجر، والعملة الأخرى مرفوضة', () => {
    const t = parseCsv(
      [
        'variant_external_id,currency,cost_ex_tax,valid_from,source_note',
        'v1,SAR,40,2026-09-01,فاتورة المورد',
        'v2,USD,10,2026-09-01,',
        'v3,SAR,0,2026-09-01,هدية',
      ].join('\n'),
    );
    const v = validateCosts(t, opts);
    expect(v.rows).toEqual([
      {
        variantExternalId: 'v1',
        currency: 'SAR',
        costExTax: '40',
        validFrom: '2026-08-31T21:00:00.000Z',
        sourceNote: 'فاتورة المورد',
      },
      {
        variantExternalId: 'v3',
        currency: 'SAR',
        costExTax: '0',
        validFrom: '2026-08-31T21:00:00.000Z',
        sourceNote: 'هدية',
      },
    ]);
    expect(v.rejected[0]!.reasons[0]).toMatch(/لا تحويل/);
  });
});

describe('ملف الإنفاق', () => {
  it('يحفظ يوم التقرير ومنطقته كما هما، والقيمة المنسوبة الفارغة null', () => {
    const t = parseCsv(
      [
        'provider,account_external_id,campaign_external_id,report_date,report_timezone,currency,spend,attributed_value',
        'snapchat,acc1,c1,2026-10-01,America/Los_Angeles,USD,120.5,',
        'facebook,acc1,c1,2026-10-01,Asia/Riyadh,SAR,10,',
        'meta,acc1,,2026-02-30,Mars/Base,SAR,-1,',
      ].join('\n'),
    );
    const v = validateAdSpend(t, opts);
    expect(v.rows).toEqual([
      {
        provider: 'snapchat',
        accountExternalId: 'acc1',
        campaignExternalId: 'c1',
        reportDate: '2026-10-01',
        reportTimezone: 'America/Los_Angeles',
        currency: 'USD',
        spend: '120.5',
        attributionWindow: 'unknown',
        conversionType: 'unknown',
        attributedValue: null,
      },
    ]);
    expect(v.rejected[0]!.reasons[0]).toMatch(/provider/);
    expect(v.rejected[1]!.reasons).toHaveLength(3);
  });
});
