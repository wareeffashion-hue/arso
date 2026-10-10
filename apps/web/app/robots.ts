import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

/** الصفحات العامة فقط تُفهرس؛ صفحات التطبيق خلف الدخول */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/', '/privacy', '/terms'],
      disallow: [
        '/api/',
        '/overview',
        '/imports',
        '/opportunities',
        '/tasks',
        '/data-health',
        '/settings',
        '/onboarding',
        '/invite',
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
