import { randomBytes } from 'node:crypto';
import postgres, { type Sql } from 'postgres';
import { migrate } from './migrate.js';

/**
 * قاعدة PostgreSQL حقيقية مؤقتة للاختبارات (لا mocks، حسب CLAUDE.md).
 * TEST_DATABASE_URL يشير إلى مستخدم إداري. الأدوار arso_app وarso_auth على مستوى
 * الخادم كله، فنسلسل إنشاءها بقفل استشاري حتى لا تتعارض ملفات أو حزم تعمل بالتوازي.
 */
export interface TestDb {
  url: string;
  admin: Sql;
  app: Sql;
  auth: Sql;
  roleUrl: (role: 'arso_app' | 'arso_auth') => string;
  drop: () => Promise<void>;
}

const SETUP_LOCK = 4_242_001;

export async function createTestDb(adminUrl = process.env.TEST_DATABASE_URL): Promise<TestDb> {
  if (!adminUrl) throw new Error('TEST_DATABASE_URL غير مضبوط');
  const name = `arso_test_${randomBytes(6).toString('hex')}`;
  const password = randomBytes(12).toString('hex');
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;

  const root = postgres(adminUrl, { max: 1, onnotice: () => {} });
  const admin = postgres(url.toString(), { max: 2, onnotice: () => {} });
  try {
    await root`SELECT pg_advisory_lock(${SETUP_LOCK})`;
    await root.unsafe(`CREATE DATABASE ${name}`);
    await migrate(admin);
    // كلمة مرور عشوائية لكل تشغيل؛ الاسم والقيمة مولّدان هنا لا من مدخل خارجي
    await admin.unsafe(`ALTER ROLE arso_app LOGIN PASSWORD '${password}'`);
    await admin.unsafe(`ALTER ROLE arso_auth LOGIN PASSWORD '${password}'`);
  } finally {
    await root`SELECT pg_advisory_unlock(${SETUP_LOCK})`;
    await root.end();
  }

  const roleUrl = (role: 'arso_app' | 'arso_auth') => {
    const u = new URL(url);
    u.username = role;
    u.password = password;
    return u.toString();
  };
  const app = postgres(roleUrl('arso_app'), { max: 4, onnotice: () => {} });
  const auth = postgres(roleUrl('arso_auth'), { max: 2, onnotice: () => {} });

  return {
    url: url.toString(),
    admin,
    app,
    auth,
    roleUrl,
    drop: async () => {
      await app.end({ timeout: 5 });
      await auth.end({ timeout: 5 });
      await admin.end({ timeout: 5 });
      const r = postgres(adminUrl, { max: 1, onnotice: () => {} });
      await r.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await r.end();
    },
  };
}

/** مستخدم متحقق البريد، كما ينشئه Better Auth بعد التحقق */
export async function createVerifiedUser(db: TestDb, email: string): Promise<string> {
  const [u] = await db.auth<{ id: string }[]>`
    INSERT INTO users (id, email, email_verified, name) VALUES (gen_random_uuid(), ${email}, true, 'Test')
    RETURNING id`;
  return u!.id;
}

/** مؤسسة عبر المسار الوحيد المسموح: create_organization */
export async function createOrganization(
  db: TestDb,
  name: string,
  ownerId: string,
): Promise<string> {
  const [r] = await db.app<{ id: string }[]>`SELECT create_organization(${name}, ${ownerId}) AS id`;
  return r!.id;
}
