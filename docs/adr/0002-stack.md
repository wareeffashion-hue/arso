# ADR-0002: التقنيات

- **التاريخ:** 2026-10-10 · **المالك:** المهندس المسؤول · **الحالة:** معتمد

**القرار:**
| الطبقة | الاختيار |
|---|---|
| اللغة | TypeScript (strict) في كل مكان |
| المستودع | pnpm workspaces + Turborepo |
| الواجهة | Next.js (App Router) + React، ومكونات مبنية على Radix UI مع tokens أرسو، وTailwind CSS مربوط بمتغيرات `brand/tokens.css` |
| الخلفية | NestJS، أي REST `/api/v1` مع OpenAPI مولّد |
| العمّال | تطبيق NestJS مستقل (`apps/worker`) يشارك الوحدات |
| قاعدة البيانات | PostgreSQL مع Drizzle ORM وترحيلات SQL صريحة |
| التحقق من البيانات | Zod، ومشترك بين الواجهة والخلفية |
| الرسوم البيانية | ECharts (SVG renderer) بإعدادات أرسو، لأنه يدعم RTL والتلميحات والوصولية |
| الاختبارات | Vitest للوحدات والمجال، وTestcontainers (PostgreSQL حقيقي) للتكامل، وPlaywright للمسارات الحرجة عند 360 و768 و1440 |
| الترجمة | next-intl، والعربية أولًا |
| المراقبة | OpenTelemetry + Sentry |

**الخيارات المرفوضة:**
- **Prisma:** ضعيف في القيود المركّبة وسياسات RLS ونوع NUMERIC الدقيق.
- **microservices:** الوثيقة تطلب modular monolith (القسم 35).
- **Redis/BullMQ** في البداية: انظر ADR-0004.

**السبب:** يطابق المعمارية المقترحة في القسم 35، مع Drizzle لأنه قريب من SQL، ويعبّر عن `NUMERIC(20,6)` والمفاتيح المركبة وسياسات RLS مباشرة.

**الأثر:** الإصدارات تُثبّت في lockfile عند بدء التنفيذ، وتُراجع عبر Context7.
