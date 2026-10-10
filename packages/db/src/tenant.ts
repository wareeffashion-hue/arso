import type { Sql, TransactionSql } from 'postgres';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class TenantContextError extends Error {
  constructor() {
    super('سياق المؤسسة غير صالح');
    this.name = 'TenantContextError';
  }
}

/**
 * كل عمل على بيانات عميل يمر من هنا (TENANT-001): يفتح معاملة ويضبط سياق المؤسسة
 * محليًا لها فقط (set_config ... true)، فلا يتسرب السياق إلى اتصال آخر في الـ pool.
 * سياسات RLS في القاعدة هي خط الدفاع الأخير، وتُغلق تلقائيًا إن غاب السياق.
 */
export async function withTenant<T>(
  sql: Sql,
  organizationId: string,
  fn: (tx: TransactionSql) => Promise<T>,
): Promise<T> {
  if (!UUID.test(organizationId)) throw new TenantContextError();
  return sql.begin(async (tx) => {
    await tx`SELECT set_config('app.organization_id', ${organizationId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}
