import postgres, { type Sql } from 'postgres';

/** اتصال دور التطبيق. NUMERIC يعود نصًا عشريًا كما هو، ولا يتحول إلى number. */
export function createClient(url: string, options: { max?: number } = {}): Sql {
  return postgres(url, {
    max: options.max ?? 10,
    onnotice: () => {},
    // أي استعلام أطول من هذا خلل يجب أن يظهر، لا أن يعلّق الطلب
    connection: { statement_timeout: 15_000 },
  });
}
