import { Module, type DynamicModule, type OnApplicationShutdown, Inject } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import type { AppConfig } from './config.js';
import { createClient, SQL, type Sql } from './db.js';
import { ErrorFilter } from './errors.js';
import { HealthController } from './health.controller.js';

class SqlLifecycle implements OnApplicationShutdown {
  constructor(@Inject(SQL) private readonly sql: Sql) {}
  async onApplicationShutdown() {
    await this.sql.end({ timeout: 5 });
  }
}

@Module({})
export class AppModule {
  static register(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController],
      providers: [
        { provide: SQL, useFactory: () => createClient(config.DATABASE_URL) },
        { provide: APP_FILTER, useClass: ErrorFilter },
        SqlLifecycle,
      ],
    };
  }
}
