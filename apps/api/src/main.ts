import { createApp } from './bootstrap.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = await createApp(config);
await app.listen(config.PORT, '0.0.0.0');
