import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request } from 'express';
import { ApiError } from '../errors.js';
import { AUTH, type Auth } from './auth.js';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
}

export type AuthedRequest = Request & { user?: AuthUser; requestId?: string };

/** كل مسار في /api/v1 يمر من هنا إلا ما يُستثنى صراحة: جلسة صالحة وبريد متحقق */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(AUTH) private readonly auth: Auth) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const session = await this.auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session) throw new ApiError(401, 'UNAUTHENTICATED', 'سجّل الدخول للمتابعة');
    if (!session.user.emailVerified) {
      throw new ApiError(403, 'EMAIL_NOT_VERIFIED', 'أكّد بريدك الإلكتروني أولًا');
    }
    const u = session.user as typeof session.user & { twoFactorEnabled?: boolean | null };
    req.user = {
      id: u.id,
      email: u.email,
      name: u.name,
      emailVerified: u.emailVerified,
      twoFactorEnabled: u.twoFactorEnabled === true,
    };
    return true;
  }
}
