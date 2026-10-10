import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().url(),
  PUBLIC_WEB_URL: z.string().url().default('http://localhost:3000'),
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
