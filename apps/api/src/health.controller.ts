import { Controller, Get, Inject } from '@nestjs/common';
import { ApiError } from './errors.js';
import { SQL, type Sql } from './db.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(SQL) private readonly sql: Sql) {}

  /** حيّ: العملية تعمل (يستخدمه Railway) */
  @Get()
  live() {
    return { status: 'ok' };
  }

  /** جاهز: القاعدة تستجيب */
  @Get('ready')
  async ready() {
    try {
      await this.sql`SELECT 1`;
      return { status: 'ok', database: 'ok' };
    } catch {
      throw new ApiError(503, 'DATABASE_UNAVAILABLE', 'قاعدة البيانات لا تستجيب', undefined, true);
    }
  }
}
