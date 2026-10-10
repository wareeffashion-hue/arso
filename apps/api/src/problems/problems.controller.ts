import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PROBLEM_STATUSES } from '@arso/domain';
import { z } from 'zod';
import { SessionGuard, type AuthedRequest } from '../auth/session.guard.js';
import { OrgService } from '../org/org.service.js';
import { parseBody, parseId } from '../validation.js';
import { ProblemsService } from './problems.service.js';

const Update = z
  .object({
    revision: z.number().int().min(1),
    status: z.enum(PROBLEM_STATUSES).optional(),
    reason: z.string().trim().max(1000).nullable().optional(),
    ownerMembershipId: z.string().uuid().nullable().optional(),
    dueOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
  })
  .strict();
const Comment = z.object({ body: z.string().trim().min(1).max(2000) }).strict();

@Controller('organizations/:org/stores/:store/problems')
@UseGuards(SessionGuard)
export class ProblemsController {
  constructor(
    private readonly orgs: OrgService,
    private readonly problems: ProblemsService,
  ) {}

  private async scope(req: AuthedRequest, org: string, store: string) {
    const m = await this.orgs.requireMembership(parseId(org), req.user!.id);
    return { m, store: await this.orgs.requireStore(m, parseId(store), 'metrics.read') };
  }

  @Get()
  async list(@Req() req: AuthedRequest, @Param('org') org: string, @Param('store') store: string) {
    const s = await this.scope(req, org, store);
    return this.problems.list(s.m, s.store);
  }

  @Post('evaluate')
  @HttpCode(200)
  async evaluate(
    @Req() req: AuthedRequest,
    @Param('org') org: string,
    @Param('store') store: string,
  ) {
    const s = await this.scope(req, org, store);
    await this.problems.evaluate(s.m, s.store);
    return this.problems.list(s.m, s.store);
  }

  @Get('assignees')
  async assignees(
    @Req() req: AuthedRequest,
    @Param('org') org: string,
    @Param('store') store: string,
  ) {
    const s = await this.scope(req, org, store);
    return { items: await this.problems.assignees(s.m, s.store) };
  }

  @Get(':id')
  async get(
    @Req() req: AuthedRequest,
    @Param('org') org: string,
    @Param('store') store: string,
    @Param('id') id: string,
  ) {
    const s = await this.scope(req, org, store);
    return this.problems.get(s.m, s.store, parseId(id));
  }

  @Patch(':id')
  async update(
    @Req() req: AuthedRequest,
    @Param('org') org: string,
    @Param('store') store: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const input = parseBody(Update, body);
    const s = await this.scope(req, org, store);
    return this.problems.update(s.m, s.store, parseId(id), input);
  }

  @Post(':id/comments')
  async comment(
    @Req() req: AuthedRequest,
    @Param('org') org: string,
    @Param('store') store: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const { body: text } = parseBody(Comment, body);
    const s = await this.scope(req, org, store);
    return this.problems.comment(s.m, s.store, parseId(id), text);
  }
}
