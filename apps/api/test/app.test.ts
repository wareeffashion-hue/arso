import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/bootstrap.js';
import { loadConfig } from '../src/config.js';

const dbUrl = process.env.TEST_DATABASE_URL;

describe('API: الصحة والأخطاء (القسم 42)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    if (!dbUrl) throw new Error('TEST_DATABASE_URL غير مضبوط');
    app = await createApp(loadConfig({ NODE_ENV: 'test', DATABASE_URL: dbUrl }));
    await app.init();
  });
  afterAll(async () => app?.close());

  it('GET /health حي', async () => {
    const r = await request(app.getHttpServer()).get('/health').expect(200);
    expect(r.body).toEqual({ status: 'ok' });
  });

  it('GET /health/ready يتحقق من القاعدة', async () => {
    const r = await request(app.getHttpServer()).get('/health/ready').expect(200);
    expect(r.body.database).toBe('ok');
  });

  it('المسار غير الموجود يعيد شكل الخطأ الموحد بالعربية', async () => {
    const r = await request(app.getHttpServer()).get('/api/v1/nope').expect(404);
    expect(r.body.error.code).toBe('NOT_FOUND');
    expect(r.body.error.message).toMatch(/غير موجود/);
    expect(r.body.error.retryable).toBe(false);
    expect(r.body.error.request_id).toBe(r.headers['x-request-id']);
    expect(JSON.stringify(r.body)).not.toMatch(/stack|at .*\.js/);
  });

  it('يعيد X-Request-ID الصالح كما هو', async () => {
    const r = await request(app.getHttpServer())
      .get('/health')
      .set('X-Request-ID', 'client-abc-123');
    expect(r.headers['x-request-id']).toBe('client-abc-123');
  });

  it('يستبدل X-Request-ID غير الآمن', async () => {
    const r = await request(app.getHttpServer())
      .get('/health')
      .set('X-Request-ID', '<script>alert(1)</script>');
    expect(r.headers['x-request-id']).toMatch(/^req_[0-9a-f-]{36}$/);
  });

  it('لا يكشف تقنية الخادم', async () => {
    const r = await request(app.getHttpServer()).get('/health');
    expect(r.headers['x-powered-by']).toBeUndefined();
  });
});

describe('الإعدادات', () => {
  it('يرفض الإقلاع بدون DATABASE_URL', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });
});

describe('قاعدة غير متاحة', () => {
  it('GET /health/ready يعيد 503 قابل لإعادة المحاولة', async () => {
    const app = await createApp(
      loadConfig({ NODE_ENV: 'test', DATABASE_URL: 'postgres://nobody:x@127.0.0.1:1/none' }),
    );
    await app.init();
    const r = await request(app.getHttpServer()).get('/health/ready').expect(503);
    expect(r.body.error).toMatchObject({ code: 'DATABASE_UNAVAILABLE', retryable: true });
    await app.close();
  });
});
