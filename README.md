<p align="center"><img src="brand/logo/ARSO_Logo_Light.svg" alt="أرسو ARSO" width="180"></p>

<h1 align="center">أرسو</h1>
<p align="center"><strong>نرسي نمو متجرك</strong></p>

منصة تربط بيانات المتجر والإعلانات وتكاليف الطلب، تكشف مشكلات النمو وفرصه، وتنسق تنفيذ القرارات وتقيس أثرها على ربحية المتجر.

> **الحالة:** المرحلة 0، التأسيس. الأساس البرمجي قائم: العزل، والسجل المالي، والخادم، والواجهة.

## التشغيل المحلي

```bash
pnpm install
pnpm build
TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres pnpm test
pnpm --filter @arso/web dev      # http://localhost:3000
```

| الحزمة | الدور |
|---|---|
| `packages/domain` | المال والسجل المالي ومحرك المساهمة والمقاييس. منطق خالص بلا قاعدة بيانات |
| `packages/db` | الترحيلات، والعزل بـ RLS، وسياق المؤسسة `withTenant` |
| `apps/api` | الخادم (NestJS): `/health` و`/api/v1`، وشكل الأخطاء الموحد |
| `apps/web` | الواجهة (Next.js): عربية RTL بهوية أرسو |
| `brand` | الهوية: tokens والخطوط والشعارات |

## محتويات المستودع
| المسار | المحتوى |
|---|---|
| [`docs/spec/`](docs/spec/ARSO_Developer_Specification_AR.md) | وثيقة المتطلبات والتصميم والهندسة (الإصدار 1.0) |
| [`docs/adr/`](docs/adr/README.md) | القرارات المعمارية |
| [`docs/plan/ROADMAP.md`](docs/plan/ROADMAP.md) | خطة البناء والمطلوب من كل طرف |
| [`docs/marketing/`](docs/marketing/ARSO_Copy_AR.md) | الشرح الكامل والمحتوى التسويقي ونصوص المنتج |
| [`brand/`](brand/README.md) | دليل الهوية، والـ tokens، والشعارات، والخطوط، ورمز الريال |
| [`brand/brand-board.html`](brand/brand-board.html) | لوحة الهوية المرئية |
| [`CLAUDE.md`](CLAUDE.md) | قواعد العمل الملزمة للتطوير |
| [`docs/plan/STATUS.md`](docs/plan/STATUS.md) | ما أُنجز وما التالي |

## الملكية
الكود والأصول ملك أرسو. خط Gamila Arabic مرخّص لأرسو ولا يُعاد توزيعه خارج المنتج. Manrope مرخّص بـ SIL OFL 1.1.
