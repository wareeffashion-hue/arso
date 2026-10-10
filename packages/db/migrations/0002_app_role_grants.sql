-- دور التطبيق: يقرأ ويكتب عبر RLS فقط، ولا يستطيع تعديل أو حذف السجلات append-only.
-- كلمة المرور تُضبط خارج الترحيلات (أسرار البيئة)، ولا تُكتب هنا.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arso_app') THEN
    CREATE ROLE arso_app NOLOGIN NOBYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO arso_app;
GRANT EXECUTE ON FUNCTION app_current_org() TO arso_app;

GRANT SELECT, INSERT, UPDATE ON organizations, stores, memberships, store_grants TO arso_app;
GRANT SELECT, UPDATE (email_verified, name), INSERT ON users TO arso_app;
GRANT SELECT, INSERT ON financial_entries, audit_logs TO arso_app;
GRANT SELECT, INSERT ON outbox TO arso_app;
GRANT UPDATE (published_at) ON outbox TO arso_app;
-- لا DELETE على أي جدول: الإلغاء حالة (revoked/closed) لا حذف
