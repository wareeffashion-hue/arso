import { Body, Controller, Get, HttpCode, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { SessionGuard, type AuthedRequest, type AuthUser } from '../auth/session.guard.js';
import { parseBody, parseId } from '../validation.js';
import { OrgService } from './org.service.js';

const TIMEZONES = new Set(Intl.supportedValuesOf('timeZone'));
const CURRENCIES = ['SAR', 'AED', 'KWD', 'BHD', 'OMR', 'QAR', 'USD', 'EUR'] as const;
const name = z.string().trim().min(2).max(100);
const uuid = z.string().uuid();

const CreateOrg = z.object({ name }).strict();
const CreateStore = z
  .object({
    name,
    timezone: z
      .string()
      .refine((t) => TIMEZONES.has(t))
      .default('Asia/Riyadh'),
    currency: z.enum(CURRENCIES).default('SAR'),
  })
  .strict();
const Invite = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    role: z.enum(['marketing_manager', 'analyst', 'finance', 'creative', 'operations', 'agency']),
    storeIds: z.array(uuid).max(200).default([]),
  })
  .strict();
const Accept = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();
const Grants = z
  .object({
    grants: z
      .array(z.object({ storeId: uuid, permissions: z.array(z.string()).max(20) }).strict())
      .max(200),
  })
  .strict();

const me = (req: AuthedRequest): AuthUser => req.user!;

@Controller()
@UseGuards(SessionGuard)
export class OrgController {
  constructor(private readonly orgs: OrgService) {}

  @Get('me')
  async getMe(@Req() req: AuthedRequest) {
    const user = me(req);
    return { user, organizations: await this.orgs.listMyOrganizations(user.id) };
  }

  @Post('organizations')
  createOrganization(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.orgs.createOrganization(me(req), parseBody(CreateOrg, body).name);
  }

  @Get('organizations/:org/stores')
  async listStores(@Req() req: AuthedRequest, @Param('org') org: string) {
    const m = await this.orgs.requireMembership(parseId(org), me(req).id);
    return { items: await this.orgs.listStores(m) };
  }

  @Post('organizations/:org/stores')
  async createStore(@Req() req: AuthedRequest, @Param('org') org: string, @Body() body: unknown) {
    const m = await this.orgs.requireMembership(parseId(org), me(req).id);
    return this.orgs.createStore(m, parseBody(CreateStore, body));
  }

  @Get('organizations/:org/members')
  async listMembers(@Req() req: AuthedRequest, @Param('org') org: string) {
    const m = await this.orgs.requireMembership(parseId(org), me(req).id);
    return { items: await this.orgs.listMembers(m) };
  }

  @Post('organizations/:org/invitations')
  async invite(@Req() req: AuthedRequest, @Param('org') org: string, @Body() body: unknown) {
    const m = await this.orgs.requireMembership(parseId(org), me(req).id);
    return this.orgs.invite(m, me(req), parseBody(Invite, body));
  }

  @Post('invitations/accept')
  @HttpCode(200)
  accept(@Req() req: AuthedRequest, @Body() body: unknown) {
    return this.orgs.acceptInvitation(me(req), parseBody(Accept, body).token);
  }

  @Put('organizations/:org/members/:member/grants')
  async setGrants(
    @Req() req: AuthedRequest,
    @Param('org') org: string,
    @Param('member') member: string,
    @Body() body: unknown,
  ) {
    const m = await this.orgs.requireMembership(parseId(org), me(req).id);
    return this.orgs.setGrants(m, parseId(member), parseBody(Grants, body).grants);
  }

  @Post('organizations/:org/members/:member/revoke')
  @HttpCode(200)
  async revoke(
    @Req() req: AuthedRequest,
    @Param('org') org: string,
    @Param('member') member: string,
  ) {
    const m = await this.orgs.requireMembership(parseId(org), me(req).id);
    return this.orgs.revokeMember(m, parseId(member));
  }
}
