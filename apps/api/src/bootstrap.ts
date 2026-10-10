import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { toNodeHandler } from 'better-auth/node';
import express from 'express';
import { Pool } from 'pg';
import { AppModule } from './app.module.js';
import { createAuth } from './auth/auth.js';
import type { AppConfig } from './config.js';
import { ConsoleMailer, MemoryMailer, ResendMailer, type Mailer } from './mail/mailer.js';
import { requestId } from './request-id.js';

export interface CreateAppOptions {
  mailer?: Mailer;
}

export async function createApp(config: AppConfig, opts: CreateAppOptions = {}) {
  const mailer =
    opts.mailer ??
    (config.RESEND_API_KEY
      ? new ResendMailer(config.RESEND_API_KEY, config.EMAIL_FROM)
      : config.NODE_ENV === 'development' || config.DEPLOY_ENV === 'staging'
        ? new ConsoleMailer()
        : new MemoryMailer());
  const authPool = new Pool({ connectionString: config.AUTH_DATABASE_URL, max: 5 });
  const auth = createAuth(config, mailer, authPool);

  // bodyParser معطل: Better Auth يقرأ جسم طلباته بنفسه، ونضيف json بعده لبقية المسارات
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.register({ config, mailer, auth, authPool }),
    {
      logger: config.NODE_ENV === 'test' ? false : ['log', 'warn', 'error'],
      bodyParser: false,
    },
  );
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(requestId);
  app.use('/api/auth', toNodeHandler(auth));
  // ملفات الاستيراد حتى 20MiB نصًا، وقد يكبر الترميز في JSON؛ بقية المسارات 100kb
  app.use(
    /^\/api\/v1\/organizations\/[^/]+\/stores\/[^/]+\/imports/,
    express.json({ limit: '45mb' }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/ready'] });
  app.enableShutdownHooks();
  return { app, auth, mailer };
}
