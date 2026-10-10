import { randomUUID } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { twoFactor } from 'better-auth/plugins';
import { Pool } from 'pg';
import type { AppConfig } from '../config.js';
import type { Mailer } from '../mail/mailer.js';

/**
 * Better Auth (ADR-0005) على جداول snake_case من الترحيل 0003، بدور arso_auth
 * الذي لا يرى بيانات المؤسسات. الجلسات كوكيز HttpOnly من نفس الأصل.
 */
export function createAuth(config: AppConfig, mailer: Mailer, pool?: Pool) {
  const database = pool ?? new Pool({ connectionString: config.AUTH_DATABASE_URL, max: 5 });
  const production = config.NODE_ENV === 'production';

  return betterAuth({
    appName: 'أرسو',
    database,
    secret: config.BETTER_AUTH_SECRET,
    baseURL: config.PUBLIC_WEB_URL,
    basePath: '/api/auth',
    trustedOrigins: [config.PUBLIC_WEB_URL],
    user: {
      modelName: 'users',
      fields: { emailVerified: 'email_verified', createdAt: 'created_at', updatedAt: 'updated_at' },
    },
    session: {
      modelName: 'auth_sessions',
      fields: {
        userId: 'user_id',
        expiresAt: 'expires_at',
        ipAddress: 'ip_address',
        userAgent: 'user_agent',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    account: {
      modelName: 'auth_accounts',
      fields: {
        userId: 'user_id',
        accountId: 'account_id',
        providerId: 'provider_id',
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        idToken: 'id_token',
        accessTokenExpiresAt: 'access_token_expires_at',
        refreshTokenExpiresAt: 'refresh_token_expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    verification: {
      modelName: 'auth_verifications',
      fields: { expiresAt: 'expires_at', createdAt: 'created_at', updatedAt: 'updated_at' },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await mailer.send({
          to: user.email,
          subject: 'إعادة تعيين كلمة المرور في أرسو',
          text: `طلبت إعادة تعيين كلمة المرور. افتح الرابط خلال ساعة:\n${url}\n\nإن لم تطلب ذلك، تجاهل هذه الرسالة.`,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await mailer.send({
          to: user.email,
          subject: 'أكّد بريدك في أرسو',
          text: `أهلًا ${user.name}،\nأكّد بريدك لتبدأ:\n${url}\n\nفريق أرسو`,
        });
      },
    },
    plugins: [
      twoFactor({
        issuer: 'ARSO',
        schema: {
          user: { fields: { twoFactorEnabled: 'two_factor_enabled' } },
          twoFactor: {
            modelName: 'auth_two_factors',
            fields: {
              backupCodes: 'backup_codes',
              userId: 'user_id',
              failedVerificationCount: 'failed_verification_count',
              lockedUntil: 'locked_until',
            },
          },
        },
      }),
    ],
    rateLimit: { enabled: config.AUTH_RATE_LIMIT ? config.AUTH_RATE_LIMIT === 'on' : production },
    advanced: {
      cookiePrefix: 'arso',
      useSecureCookies: production,
      database: { generateId: () => randomUUID() },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
export const AUTH = Symbol('AUTH');
