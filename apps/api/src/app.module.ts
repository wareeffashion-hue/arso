import { Inject, Module, type DynamicModule, type OnApplicationShutdown } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import type { Pool } from 'pg';
import { AUTH, createAuth } from './auth/auth.js';
import { SessionGuard } from './auth/session.guard.js';
import type { AppConfig } from './config.js';
import { createClient, SQL, type Sql } from './db.js';
import { ErrorFilter } from './errors.js';
import { HealthController } from './health.controller.js';
import { MAILER, type Mailer } from './mail/mailer.js';
import { ImportsController } from './imports/imports.controller.js';
import { ImportsService } from './imports/imports.service.js';
import { OrgController } from './org/org.controller.js';
import { OrgService } from './org/org.service.js';
import { OverviewService } from './overview/overview.service.js';
import { ProblemsController } from './problems/problems.controller.js';
import { ProblemsService } from './problems/problems.service.js';
import { TasksController } from './tasks/tasks.controller.js';
import { TasksService } from './tasks/tasks.service.js';
import { CONFIG } from './tokens.js';

const AUTH_POOL = Symbol('AUTH_POOL');

class DbLifecycle implements OnApplicationShutdown {
  constructor(
    @Inject(SQL) private readonly sql: Sql,
    @Inject(AUTH_POOL) private readonly authPool: Pool,
  ) {}
  async onApplicationShutdown() {
    await this.sql.end({ timeout: 5 });
    await this.authPool.end();
  }
}

export interface AppDeps {
  config: AppConfig;
  mailer: Mailer;
  auth: ReturnType<typeof createAuth>;
  authPool: Pool;
}

@Module({})
export class AppModule {
  static register(deps: AppDeps): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        HealthController,
        OrgController,
        ImportsController,
        ProblemsController,
        TasksController,
      ],
      providers: [
        { provide: CONFIG, useValue: deps.config },
        { provide: MAILER, useValue: deps.mailer },
        { provide: AUTH, useValue: deps.auth },
        { provide: AUTH_POOL, useValue: deps.authPool },
        { provide: SQL, useFactory: () => createClient(deps.config.DATABASE_URL) },
        { provide: APP_FILTER, useClass: ErrorFilter },
        SessionGuard,
        OrgService,
        ImportsService,
        OverviewService,
        ProblemsService,
        TasksService,
        DbLifecycle,
      ],
    };
  }
}
