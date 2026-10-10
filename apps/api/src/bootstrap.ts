import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import type { AppConfig } from './config.js';
import { requestId } from './request-id.js';

export async function createApp(config: AppConfig): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(config), {
    logger: config.NODE_ENV === 'test' ? false : ['log', 'warn', 'error'],
  });
  app.disable('x-powered-by');
  app.use(requestId);
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'health/ready'] });
  app.enableCors({ origin: config.PUBLIC_WEB_URL, credentials: true });
  app.enableShutdownHooks();
  return app;
}
