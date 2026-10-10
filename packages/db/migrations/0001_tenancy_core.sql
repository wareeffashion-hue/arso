-- ARSO-TENANT-001 · ARSO-FIN-001 · ARSO-SYNC-001
-- أساس العزل: كل جدول خاص بعميل يحمل organization_id، ويخضع لـ RLS مغلق افتراضيًا.
-- دور التطبيق arso_app لا يملك BYPASSRLS، ودور الترحيلات arso_owner يملك الجداول.
-- السياق يُضبط داخل كل معاملة: set_config('app.organization_id', <uuid>, true).

CREATE EXTENSION IF NOT EXISTS citext;

-- يعيد معرّف المؤسسة من سياق المعاملة، أو NULL إن لم يُضبط (فلا تُرى أي صفوف)
CREATE FUNCTION app_current_org() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.organization_id', true), '')::uuid $$;

-- يمنع أي تعديل أو حذف على الجداول append-only (السجل المالي والتدقيق)
CREATE FUNCTION app_forbid_mutation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: use a reversing entry', TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END $$;

-- ===== المؤسسات =====
CREATE TABLE organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 100),
  status      text NOT NULL DEFAULT 'trial'
              CHECK (status IN ('trial', 'active', 'past_due', 'suspended', 'closed')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ===== المستخدمون (هوية عامة؛ جداول جلسات Better Auth تُضاف في ترحيل المصادقة) =====
CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           citext NOT NULL UNIQUE,
  email_verified  boolean NOT NULL DEFAULT false,
  name            text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ===== المتاجر =====
CREATE TABLE stores (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  name             text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 100),
  timezone         text NOT NULL DEFAULT 'Asia/Riyadh',
  currency         char(3) NOT NULL DEFAULT 'SAR',
  sector           text NOT NULL DEFAULT 'fashion',
  revision         integer NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- هدف المفاتيح المركبة: يمنع علاقة بين متجر ومؤسسة أخرى
  UNIQUE (organization_id, id)
);

-- ===== العضويات والمنح =====
CREATE TABLE memberships (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  user_id          uuid NOT NULL REFERENCES users(id),
  role             text NOT NULL
                   CHECK (role IN ('owner', 'marketing_manager', 'analyst', 'finance',
                                   'creative', 'operations', 'agency')),
  status           text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'revoked')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  revoked_at       timestamptz,
  UNIQUE (organization_id, user_id),
  UNIQUE (organization_id, id)
);

CREATE TABLE store_grants (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  membership_id    uuid NOT NULL,
  store_id         uuid NOT NULL,
  permissions      text[] NOT NULL DEFAULT '{}',
  expires_at       timestamptz,
  revoked_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (membership_id, store_id),
  FOREIGN KEY (organization_id, membership_id) REFERENCES memberships(organization_id, id),
  FOREIGN KEY (organization_id, store_id) REFERENCES stores(organization_id, id),
  CHECK (permissions <@ ARRAY[
    'metrics.read', 'finance.read_summary', 'costs.read', 'costs.write', 'pii.read',
    'creative.write', 'experiments.write', 'connections.manage', 'campaigns.read',
    'actions.prepare', 'actions.approve', 'rules.manage', 'members.manage',
    'exports.create', 'services.manage'
  ]::text[])
);

-- ===== السجل المالي (القسم 31، الملحق أ) =====
CREATE TABLE financial_entries (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL,
  store_id             uuid NOT NULL,
  order_external_id    text,
  kind                 text NOT NULL CHECK (kind IN (
                         'product_revenue', 'shipping_revenue', 'product_refund', 'shipping_refund',
                         'cogs_charge', 'cogs_recovery', 'payment_fee', 'payment_fee_refund',
                         'shipping_cost', 'return_shipping_cost', 'exchange_shipping_cost',
                         'packaging_cost', 'repair_cost', 'marketing_cost', 'manual_adjustment')),
  entry_group          text CHECK (entry_group IN ('revenue', 'variable_cost', 'marketing')),
  amount               numeric(20, 6) NOT NULL,
  currency             char(3) NOT NULL,
  economic_at          timestamptz NOT NULL,
  observed_at          timestamptz NOT NULL DEFAULT now(),
  source               text NOT NULL,
  source_record_id     text NOT NULL,
  line_id              text NOT NULL DEFAULT '-',
  revision             integer NOT NULL DEFAULT 1,
  reverses_id          uuid,
  calculation_version  text NOT NULL,
  FOREIGN KEY (organization_id, store_id) REFERENCES stores(organization_id, id),
  -- القسم 37: نفس الحركة لا تُسجل مرتين
  UNIQUE (organization_id, source, source_record_id, line_id, kind, revision),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, reverses_id) REFERENCES financial_entries(organization_id, id),
  CHECK (kind <> 'manual_adjustment' OR entry_group IS NOT NULL)
);
CREATE INDEX financial_entries_store_time ON financial_entries (organization_id, store_id, economic_at);
CREATE TRIGGER financial_entries_append_only
  BEFORE UPDATE OR DELETE ON financial_entries
  FOR EACH ROW EXECUTE FUNCTION app_forbid_mutation();

-- ===== سجل التدقيق (القسم 48) =====
CREATE TABLE audit_logs (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  store_id         uuid,
  actor_type       text NOT NULL CHECK (actor_type IN ('user', 'service', 'support')),
  actor_id         text NOT NULL,
  action           text NOT NULL,
  target_type      text NOT NULL,
  target_id        text,
  before_state     jsonb,
  after_state      jsonb,
  reason           text,
  request_id       text,
  trace_id         text,
  occurred_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_org_time ON audit_logs (organization_id, occurred_at);
CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION app_forbid_mutation();

-- ===== صندوق الأحداث (القسم 41، ADR-0004) =====
CREATE TABLE outbox (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id         uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  schema_version   integer NOT NULL DEFAULT 1,
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  store_id         uuid,
  type             text NOT NULL,
  entity_id        text NOT NULL,
  entity_revision  integer NOT NULL,
  payload_ref      jsonb NOT NULL DEFAULT '{}',
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  trace_id         text,
  published_at     timestamptz
);
CREATE INDEX outbox_unpublished ON outbox (id) WHERE published_at IS NULL;

-- ===== RLS: مغلق افتراضيًا ومفروض حتى على مالك الجدول =====
ALTER TABLE organizations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations     FORCE ROW LEVEL SECURITY;
ALTER TABLE stores            ENABLE ROW LEVEL SECURITY;
ALTER TABLE stores            FORCE ROW LEVEL SECURITY;
ALTER TABLE memberships       ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships       FORCE ROW LEVEL SECURITY;
ALTER TABLE store_grants      ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_grants      FORCE ROW LEVEL SECURITY;
ALTER TABLE financial_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_logs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs        FORCE ROW LEVEL SECURITY;
ALTER TABLE outbox            ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox            FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON organizations
  USING (id = app_current_org()) WITH CHECK (id = app_current_org());
CREATE POLICY tenant_isolation ON stores
  USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
CREATE POLICY tenant_isolation ON memberships
  USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
CREATE POLICY tenant_isolation ON store_grants
  USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
CREATE POLICY tenant_isolation ON financial_entries
  USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
CREATE POLICY tenant_isolation ON audit_logs
  USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
CREATE POLICY tenant_isolation ON outbox
  USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());
