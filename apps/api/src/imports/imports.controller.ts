import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IMPORT_KINDS, isValidTimezone } from '@arso/domain';
import { z } from 'zod';
import { SessionGuard, type AuthedRequest } from '../auth/session.guard.js';
import { OrgService } from '../org/org.service.js';
import { OverviewService } from '../overview/overview.service.js';
import { parseBody, parseId } from '../validation.js';
import { IMPORT_PERMISSION, ImportsService } from './imports.service.js';

const Preview = z
  .object({
    kind: z.enum(IMPORT_KINDS),
    fileName: z.string().trim().min(1).max(255),
    csv: z.string().min(1),
    naiveTimezone: z
      .string()
      .refine((t) => isValidTimezone(t))
      .nullable()
      .default(null),
  })
  .strict();
const Commit = z.object({ csv: z.string().min(1) }).strict();
const OverviewQuery = z.object({ days: z.coerce.number().int().min(1).max(366).default(30) });

@Controller('organizations/:org/stores/:store')
@UseGuards(SessionGuard)
export class ImportsController {
  constructor(
    private readonly orgs: OrgService,
    private readonly imports: ImportsService,
    private readonly overviews: OverviewService,
  ) {}

  private async access(req: AuthedRequest, org: string) {
    return this.orgs.requireMembership(parseId(org), req.user!.id);
  }

  @Post('imports')
  async preview(
    @Req() req: AuthedRequest,
    @Param('org') org: string,
    @Param('store') storeId: string,
    @Body() body: unknown,
  ) {
    const input = parseBody(Preview, body);
    const m = await this.access(req, org);
    const store = await this.orgs.requireStore(m, parseId(storeId), IMPORT_PERMISSION[input.kind]);
    return this.imports.preview(m, store, input);
  }

  @Post('imports/:batch/commit')
  @HttpCode(200)
  async commit(
    @Req() req: AuthedRequest,
    @Param('org') org: string,
    @Param('store') storeId: string,
    @Param('batch') batch: string,
    @Body() body: unknown,
  ) {
    const { csv } = parseBody(Commit, body);
    const m = await this.access(req, org);
    const store = await this.orgs.requireStore(m, parseId(storeId), 'metrics.read');
    return this.imports.commit(m, req.user!, store, parseId(batch), csv);
  }

  @Get('imports')
  async list(
    @Req() req: AuthedRequest,
    @Param('org') org: string,
    @Param('store') storeId: string,
  ) {
    const m = await this.access(req, org);
    const store = await this.orgs.requireStore(m, parseId(storeId), 'metrics.read');
    return { items: await this.imports.list(m, store) };
  }

  @Get('overview')
  async overview(
    @Req() req: AuthedRequest,
    @Param('org') org: string,
    @Param('store') storeId: string,
    @Query() query: unknown,
  ) {
    const { days } = parseBody(OverviewQuery, query);
    const m = await this.access(req, org);
    const store = await this.orgs.requireStore(m, parseId(storeId), 'metrics.read');
    return this.overviews.overview(m, store, days);
  }
}
