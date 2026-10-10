import postgres from 'postgres';
import { migrate } from './migrate.js';

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) {
  console.error('MIGRATION_DATABASE_URL غير مضبوط');
  process.exit(1);
}
const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
  const ran = await migrate(sql);
  console.log(ran.length ? `طُبّق: ${ran.join(', ')}` : 'لا ترحيلات جديدة');
} finally {
  await sql.end();
}
