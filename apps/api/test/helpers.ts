import type { INestApplication } from '@nestjs/common';
import { createTestDb, type TestDb } from '@arso/db/testing';
import request from 'supertest';
import { createApp } from '../src/bootstrap.js';
import { loadConfig } from '../src/config.js';
import { MemoryMailer } from '../src/mail/mailer.js';

export const WEB = 'http://localhost:3000';

export interface TestApp {
  app: INestApplication;
  db: TestDb;
  mailer: MemoryMailer;
  auth: Awaited<ReturnType<typeof createApp>>['auth'];
  close: () => Promise<void>;
}

export async function startApp(): Promise<TestApp> {
  const db = await createTestDb();
  const mailer = new MemoryMailer();
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: db.roleUrl('arso_app'),
    AUTH_DATABASE_URL: db.roleUrl('arso_auth'),
    BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-123',
    PUBLIC_WEB_URL: WEB,
  });
  const { app, auth } = await createApp(config, { mailer });
  await app.init();
  return {
    app,
    db,
    mailer,
    auth,
    close: async () => {
      await app.close();
      await db.drop();
    },
  };
}

/** يسجّل مستخدمًا ويؤكد بريده من رابط الرسالة، ويعيد وكيلًا يحمل كوكي الجلسة */
export async function signUpVerified(t: TestApp, email: string, name = 'مستخدم') {
  const server = t.app.getHttpServer();
  const agent = request.agent(server);
  await agent
    .post('/api/auth/sign-up/email')
    .set('Origin', WEB)
    .send({ email, password: 'correct-horse-battery', name })
    .expect(200);
  const mail = t.mailer.lastTo(email);
  if (!mail) throw new Error('لم تصل رسالة التحقق');
  const url = new URL(mail.text.match(/https?:\/\/\S+/)![0]);
  await agent.get(url.pathname + url.search).set('Origin', WEB);
  await agent
    .post('/api/auth/sign-in/email')
    .set('Origin', WEB)
    .send({ email, password: 'correct-horse-battery' })
    .expect(200);
  return agent;
}

export function linkFrom(t: TestApp, email: string): URL {
  const mail = t.mailer.lastTo(email);
  if (!mail) throw new Error(`لا رسالة إلى ${email}`);
  return new URL(mail.text.match(/https?:\/\/\S+/)![0]);
}
