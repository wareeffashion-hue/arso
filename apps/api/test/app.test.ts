import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import { loadConfig } from '../src/config.js';
import { startApp, type TestApp } from './helpers.js';

describe('API: الصحة والأخطاء (القسم 42)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startApp();
  });
  afterAll(async () => t?.close());

  it('GET /health حي', async () => {
    const r = await request(t.app.getHttpServer()).get('/health').expect(200);
    expect(r.body).toEqual({ status: 'ok' });
  });

  it('GET /health/ready يتحقق من القاعدة', async () => {
    const r = await request(t.app.getHttpServer()).get('/health/ready').expect(200);
    expect(r.body.database).toBe('ok');
  });

  it('المسار غير الموجود يعيد شكل الخطأ الموحد بالعربية', async () => {
    const r = await request(t.app.getHttpServer()).get('/api/v1/nope').expect(404);
    expect(r.body.error.code).toBe('NOT_FOUND');
    expect(r.body.error.message).toMatch(/غير موجود/);
    expect(r.body.error.request_id).toBe(r.headers['x-request-id']);
    expect(JSON.stringify(r.body)).not.toMatch(/stack|at .*\.js/);
  });

  it('يعيد X-Request-ID الصالح كما هو ويستبدل غير الآمن', async () => {
    const ok = await request(t.app.getHttpServer())
      .get('/health')
      .set('X-Request-ID', 'client-abc-123');
    expect(ok.headers['x-request-id']).toBe('client-abc-123');
    const bad = await request(t.app.getHttpServer())
      .get('/health')
      .set('X-Request-ID', '<script>x</script>');
    expect(bad.headers['x-request-id']).toMatch(/^req_[0-9a-f-]{36}$/);
  });

  it('لا يكشف تقنية الخادم', async () => {
    const r = await request(t.app.getHttpServer()).get('/health');
    expect(r.headers['x-powered-by']).toBeUndefined();
  });
});

describe('الإعدادات', () => {
  it('يرفض الإقلاع بدون DATABASE_URL أو سر المصادقة', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
    expect(() =>
      loadConfig({
        DATABASE_URL: 'postgres://a@b/c',
        AUTH_DATABASE_URL: 'postgres://a@b/c',
        BETTER_AUTH_SECRET: 'short',
      }),
    ).toThrow(/BETTER_AUTH_SECRET/);
  });

  it('الإنتاج يتطلب https ومزود بريد', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://a@b/c',
        AUTH_DATABASE_URL: 'postgres://a@b/c',
        BETTER_AUTH_SECRET: 'x'.repeat(40),
        PUBLIC_WEB_URL: 'http://insecure.example',
      }),
    ).toThrow(/RESEND_API_KEY.*PUBLIC_WEB_URL|PUBLIC_WEB_URL.*RESEND_API_KEY/);
  });
});

describe('بيئة الاختبار المنشورة (staging)', () => {
  it('تقبل الإقلاع بلا مزود بريد، والإنتاج يرفضه', () => {
    const base = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://a@b/c',
      AUTH_DATABASE_URL: 'postgres://a@b/c',
      BETTER_AUTH_SECRET: 'x'.repeat(40),
      PUBLIC_WEB_URL: 'https://arso.example',
    };
    expect(loadConfig({ ...base, DEPLOY_ENV: 'staging' }).DEPLOY_ENV).toBe('staging');
    expect(() => loadConfig(base)).toThrow(/RESEND_API_KEY/);
  });
});

describe('قاعدة غير متاحة', () => {
  it('GET /health/ready يعيد 503 قابل لإعادة المحاولة', async () => {
    const { app } = await createApp(
      loadConfig({
        NODE_ENV: 'test',
        DATABASE_URL: 'postgres://nobody:x@127.0.0.1:1/none',
        AUTH_DATABASE_URL: 'postgres://nobody:x@127.0.0.1:1/none',
        BETTER_AUTH_SECRET: 'x'.repeat(40),
      }),
    );
    await app.init();
    const r = await request(app.getHttpServer()).get('/health/ready').expect(503);
    expect(r.body.error).toMatchObject({ code: 'DATABASE_UNAVAILABLE', retryable: true });
    await app.close();
  });
});
