import { createClient, type Sql } from '@arso/db';

export const SQL = Symbol('SQL');
export type { Sql };
export { createClient };
