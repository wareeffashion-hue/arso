import path from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: 'standalone',
  // جذر المستودع، حتى يتتبع البناء المستقل حزم الـ workspace
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  transpilePackages: ['@arso/domain'],
  // الـ API والمصادقة من نفس أصل الواجهة: كوكيز first-party ولا CORS
  async rewrites() {
    const api = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
    return [
      { source: '/api/auth/:path*', destination: `${api}/api/auth/:path*` },
      { source: '/api/v1/:path*', destination: `${api}/api/v1/:path*` },
    ];
  },
  async headers() {
    const prod = process.env.NODE_ENV === 'production';
    // سياسة محتوى مغلقة: كل شيء من نفس الأصل. Next يحتاج inline للسكربتات والأنماط،
    // و'unsafe-eval' في التطوير فقط
    const csp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${prod ? '' : " 'unsafe-eval'"}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; ');
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          ...(prod
            ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]
            : []),
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default config;
