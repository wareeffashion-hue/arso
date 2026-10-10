import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { TASK_STATUSES } from '@arso/domain';
import { z } from 'zod';
import { SessionGuard, type AuthedRequest } from '../auth/session.guard.js';
import { OrgService } from '../org/org.service.js';
import { parseBody, parseId } from '../validation.js';
import { TasksService } from './tasks.service.js';

const text = (max: number) => z.string().trim().max(max);
const fields = {
  brief: text(4000).nullable().optional(),
  acceptanceCriteria: text(2000).nullable().optional(),
  ownerMembershipId: z.string().uuid().nullable().optional(),
  dueOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  // مبلغ نصًا عشريًا، لا number (ADR-0009)
  costAmount: z
    .string()
    .regex(/^\d{1,14}(\.\d{1,6})?$/)
    .nullable()
    .optional(),
};
const Create = z
  .object({
    title: text(200).min(2),
    problemId: z.string().uuid().nullable().optional(),
    ...fields,
  })
  .strict();
const Update = z
  .object({
    revision: z.number().int().min(1),
    title: text(200).min(2).optional(),
    status: z.enum(TASK_STATUSES).optional(),
    result: text(4000).nullable().optional(),
    cancelReason: text(1000).nullable().optional(),
    ...fields,
  })
  .strict();
const Comment = z.object({ body: z.string().trim().min(1).max(2000) }).strict();

@Controller('organizations/:org/stores/:store')
@UseGuards(SessionGuard)
export class TasksController {
  constructor(
    private readonly orgs: OrgService,
    private readonly tasks: TasksService,
  ) {}

  private async scope(req: AuthedRequest, org: string, store: string) {
    const m = await this.orgs.requireMembership(parseId(org), req.user!.id);
    return { m, store: await this.orgs.requireStore(m, parseId(store), 'metrics.read') };
  }

  @Get('tasks')
  async list(@Req() req: AuthedRequest, @Param('org') org: string, @Param('store') store: string) {
    const s = await this.scope(req, org, store);
    return this.tasks.list(s.m, s.store);
  }

  @Post('tasks')
  async create(
    @Req() req: AuthedRequest,
    @Param('org') org: string,
    @Param('store') store: string,
    @Body() body: unknown,
  ) {
    const input = parseBody(Create, body);
    const s = await this.scope(req, org, store);
    return this.tasks.create(s.m, s.store, input);
  }

  @Get('problems/:id/task-draft')
  async draft(
    @Req() req: AuthedRequest,
    @Param('org') org: string,
    @Param('store') store: string,
    @Param('id') id: string,
  ) {
    const s = await this.scope(req, org, store);
    return this.tasks.draftFromProblem(s.m, s.store, parseId(id));
  }

  @Get('tasks/:id')
  async get(
    @Req() req: AuthedRequest,
    @Param('org') org: string,
    @Param('store') store: string,
    @Param('id') id: string,
  ) {
    const s = await this.scope(req, org, store);
    return this.tasks.get(s.m, s.store, parseId(id));
  }

  @Patch('tasks/:id')
  async update(
    @Req() req: AuthedRequest,
    @Param('org') org: string,
    @Param('store') store: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const input = parseBody(Update, body);
    const s = await this.scope(req, org, store);
    return this.tasks.update(s.m, s.store, parseId(id), input);
  }

  @Post('tasks/:id/comments')
  async comment(
    @Req() req: AuthedRequest,
    @Param('org') org: string,
    @Param('store') store: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const { body: text } = parseBody(Comment, body);
    const s = await this.scope(req, org, store);
    return this.tasks.comment(s.m, s.store, parseId(id), text);
  }
}
