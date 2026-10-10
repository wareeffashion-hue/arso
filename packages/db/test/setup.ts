import { randomBytes } from 'node:crypto';
import postgres, { type Sql } from 'postgres';
import { migrate } from '../src/migrate.js';

/**
 * قاعدة PostgreSQL حقيقية لكل ملف اختبار (لا mocks، حسب CLAUDE.md).
 * TEST_DATABASE_URL يشير إلى مستخدم إداري؛ ننشئ قاعدة مؤقتة ونطبق الترحيلات
 * ونتصل بدور التطبيق arso_app الخاضع لـ RLS.
 */
export interface TestDb {
  admin: Sql;
  app: Sql;
  drop: () => Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const adminUrl = process.env.TEST_DATABASE_URL;
  if (!adminUrl) throw new Error('TEST_DATABASE_URL غير مضبوط');
  const name = `arso_test_${randomBytes(6).toString('hex')}`;
  const root = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await root.unsafe(`CREATE DATABASE ${name}`);
  await root.end();

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const admin = postgres(url.toString(), { max: 2, onnotice: () => {} });
  await migrate(admin);
  const password = randomBytes(12).toString('hex');
  await admin.unsafe(`ALTER ROLE arso_app LOGIN PASSWORD '${password}'`);

  const appUrl = new URL(url);
  appUrl.username = 'arso_app';
  appUrl.password = password;
  const app = postgres(appUrl.toString(), { max: 4, onnotice: () => {} });

  return {
    admin,
    app,
    drop: async () => {
      await app.end({ timeout: 5 });
      await admin.end({ timeout: 5 });
      const r = postgres(adminUrl, { max: 1, onnotice: () => {} });
      await r.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await r.end();
    },
  };
}
