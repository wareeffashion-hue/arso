import { z } from 'zod';

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    /** staging: بيئة اختبار منشورة قد تعمل بلا مزود بريد (الرسائل تُكتب في سجلات الخادم الخاصة) */
    DEPLOY_ENV: z.enum(['staging', 'production']).default('production'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    /** دور arso_app: بيانات المؤسسات عبر RLS */
    DATABASE_URL: z.string().url(),
    /** دور arso_auth: جداول الهوية والجلسات فقط */
    AUTH_DATABASE_URL: z.string().url(),
    /** يوقّع الجلسات. 32 حرفًا على الأقل: openssl rand -base64 32 */
    BETTER_AUTH_SECRET: z.string().min(32),
    /** أصل الواجهة. الـ API يُخدم من نفس الأصل عبر وكيل Next (/api/*)، فالكوكيز first-party */
    PUBLIC_WEB_URL: z.string().url().default('http://localhost:3000'),
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().default('أرسو <no-reply@arso.sa>'),
    INVITATION_TTL_HOURS: z.coerce.number().int().min(1).max(336).default(72),
    AUTH_RATE_LIMIT: z.enum(['on', 'off']).optional(),
  })
  .superRefine((c, ctx) => {
    if (c.NODE_ENV === 'production' && c.DEPLOY_ENV === 'production' && !c.RESEND_API_KEY) {
      ctx.addIssue({ code: 'custom', path: ['RESEND_API_KEY'], message: 'مطلوب في الإنتاج' });
    }
    if (c.NODE_ENV === 'production' && !c.PUBLIC_WEB_URL.startsWith('https://')) {
      ctx.addIssue({
        code: 'custom',
        path: ['PUBLIC_WEB_URL'],
        message: 'يجب أن يكون https في الإنتاج',
      });
    }
  });

export type AppConfig = z.infer<typeof schema>;

/** يفشل الإقلاع فورًا إن نقص إعداد، بدل أن يفشل لاحقًا عند أول طلب */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`إعدادات ناقصة أو غير صالحة: ${fields}`);
  }
  return parsed.data;
}
