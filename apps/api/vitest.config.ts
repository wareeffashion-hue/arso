import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// NestJS يحتاج emitDecoratorMetadata، وesbuild لا يدعمه، فنستخدم SWC
export default defineConfig({ plugins: [swc.vite({ module: { type: 'es6' } })] });
