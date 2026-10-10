import { createApp } from './bootstrap.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const { app } = await createApp(config);
try {
  // '::' يقبل IPv4 وIPv6؛ شبكة Railway الخاصة تستخدم IPv6
  await app.listen(config.PORT, '::');
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== 'EAFNOSUPPORT') throw e;
  await app.listen(config.PORT, '0.0.0.0');
}
