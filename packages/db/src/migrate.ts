import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Sql } from 'postgres';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));

/**
 * مشغّل ترحيلات بسيط وصريح: ملفات SQL مرقمة، كل ملف في معاملة، ومجموع تحقق يمنع
 * تعديل ترحيل طُبّق سابقًا. يُشغَّل بدور المالك فقط، لا بدور التطبيق.
 */
export async function migrate(sql: Sql, dir = MIGRATIONS_DIR): Promise<string[]> {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`;
  const files = (await readdir(dir)).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
  const applied = new Map(
    (
      await sql<
        { version: string; checksum: string }[]
      >`SELECT version, checksum FROM schema_migrations`
    ).map((r) => [r.version, r.checksum]),
  );
  const ran: string[] = [];
  for (const file of files) {
    const body = await readFile(path.join(dir, file), 'utf8');
    const checksum = createHash('sha256').update(body).digest('hex');
    const prev = applied.get(file);
    if (prev) {
      if (prev !== checksum)
        throw new Error(`الترحيل ${file} عُدّل بعد تطبيقه. أنشئ ترحيلًا جديدًا بدلًا منه.`);
      continue;
    }
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`INSERT INTO schema_migrations (version, checksum) VALUES (${file}, ${checksum})`;
    });
    ran.push(file);
  }
  return ran;
}
