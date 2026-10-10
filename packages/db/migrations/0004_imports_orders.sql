-- ARSO-IMPORT-001 · ARSO-ORDER-001 · ARSO-COST-001 · ARSO-ADS-001
-- استيراد الملفات (الملحق ب) والطلبات والتكاليف التاريخية والإنفاق الإعلاني اليومي.
-- كل جدول يحمل organization_id وstore_id، بمفاتيح مركبة تمنع الربط بين المؤسسات، وRLS مفروض.

-- ===== دفعات الاستيراد =====
-- الدفعة مرتبطة ببصمة الملف وخيارات قراءته؛ الاعتماد يرفض ملفًا غير الذي عوين (الملحق ب).
CREATE TABLE import_batches (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  store_id         uuid NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('orders', 'costs', 'ad_spend')),
  file_name        text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 255),
  file_checksum    text NOT NULL CHECK (file_checksum ~ '^[0-9a-f]{64}$'),
  naive_timezone   text,
  status           text NOT NULL DEFAULT 'preview_ready'
                   CHECK (status IN ('preview_ready', 'completed', 'failed', 'cancelled')),
  total_rows       integer NOT NULL CHECK (total_rows >= 0),
  rejected_rows    integer NOT NULL CHECK (rejected_rows >= 0),
  created_count    integer NOT NULL DEFAULT 0,
  updated_count    integer NOT NULL DEFAULT 0,
  duplicate_count  integer NOT NULL DEFAULT 0,
  -- عينة الأسباب فقط (حد أعلى في الخادم)، لا نسخة من الملف ولا بيانات عملاء
  rejected_sample  jsonb NOT NULL DEFAULT '[]',
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  committed_at     timestamptz,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, store_id) REFERENCES stores(organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES memberships(organization_id, id)
);
CREATE INDEX import_batches_store ON import_batches (organization_id, store_id, created_at DESC);
-- نفس الملف لا يُعتمد مرتين لنفس المتجر والنوع (القسم 38: لا مضاعفة عند إعادة الملف)
CREATE UNIQUE INDEX import_batches_once ON import_batches (organization_id, store_id, kind, file_checksum)
  WHERE status = 'completed';

-- ===== الطلبات وبنودها =====
CREATE TABLE orders (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid NOT NULL,
  store_id               uuid NOT NULL,
  external_id            text NOT NULL,
  placed_at              timestamptz NOT NULL,
  source_status          text NOT NULL,
  eligibility            text NOT NULL CHECK (eligibility IN ('eligible', 'excluded', 'needs_review')),
  status_mapping_version text NOT NULL,
  currency               char(3) NOT NULL,
  -- على مستوى الطلب مرة واحدة؛ null = غير معروف، لا صفر
  shipping_income_ex_tax numeric(20, 6) CHECK (shipping_income_ex_tax >= 0),
  customer_external_id   text,
  source                 text NOT NULL,
  import_batch_id        uuid,
  observed_at            timestamptz NOT NULL DEFAULT now(),
  revision               integer NOT NULL DEFAULT 1,
  UNIQUE (organization_id, store_id, external_id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, store_id) REFERENCES stores(organization_id, id),
  FOREIGN KEY (organization_id, import_batch_id) REFERENCES import_batches(organization_id, id)
);
CREATE INDEX orders_store_time ON orders (organization_id, store_id, placed_at);

CREATE TABLE order_lines (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL,
  store_id                uuid NOT NULL,
  order_id                uuid NOT NULL,
  external_line_id        text NOT NULL,
  product_external_id     text,
  variant_external_id     text NOT NULL,
  quantity                numeric(18, 6) NOT NULL CHECK (quantity > 0),
  product_revenue_ex_tax  numeric(20, 6) NOT NULL CHECK (product_revenue_ex_tax >= 0),
  tax_amount              numeric(20, 6) CHECK (tax_amount >= 0),
  UNIQUE (order_id, external_line_id),
  FOREIGN KEY (organization_id, order_id) REFERENCES orders(organization_id, id),
  FOREIGN KEY (organization_id, store_id) REFERENCES stores(organization_id, id)
);
CREATE INDEX order_lines_variant ON order_lines (organization_id, store_id, variant_external_id);

-- ===== التكاليف التاريخية (القسم 31 وAC05) =====
-- append-only: التصحيح نسخة جديدة (revision) بنفس تاريخ السريان، والقديمة تبقى للتفسير.
-- سريان النسخة من valid_from حتى بداية النسخة التالية للمتغير نفسه.
CREATE TABLE cost_versions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL,
  store_id             uuid NOT NULL,
  variant_external_id  text NOT NULL,
  currency             char(3) NOT NULL,
  cost_ex_tax          numeric(20, 6) NOT NULL CHECK (cost_ex_tax >= 0),
  valid_from           timestamptz NOT NULL,
  revision             integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  source               text NOT NULL,
  source_note          text,
  import_batch_id      uuid,
  created_by           uuid NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, store_id, variant_external_id, valid_from, revision),
  FOREIGN KEY (organization_id, store_id) REFERENCES stores(organization_id, id),
  FOREIGN KEY (organization_id, import_batch_id) REFERENCES import_batches(organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES memberships(organization_id, id)
);
CREATE INDEX cost_versions_lookup
  ON cost_versions (organization_id, store_id, variant_external_id, valid_from DESC, revision DESC);
CREATE TRIGGER cost_versions_append_only
  BEFORE UPDATE OR DELETE ON cost_versions
  FOR EACH ROW EXECUTE FUNCTION app_forbid_mutation();

-- ===== الإنفاق الإعلاني اليومي (القسمان 32 و37) =====
-- اليوم يُحفظ بمنطقة الحساب الإعلاني كما ورد؛ لا تقسيم زائف إلى منطقة المتجر (AC15).
CREATE TABLE ad_spend_facts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL,
  store_id             uuid NOT NULL,
  provider             text NOT NULL
                       CHECK (provider IN ('snapchat', 'meta', 'tiktok', 'google', 'x', 'other')),
  account_external_id  text NOT NULL,
  campaign_external_id text NOT NULL,
  report_date          date NOT NULL,
  report_timezone      text NOT NULL,
  currency             char(3) NOT NULL,
  spend                numeric(20, 6) NOT NULL CHECK (spend >= 0),
  attribution_window   text NOT NULL,
  conversion_type      text NOT NULL,
  attributed_value     numeric(20, 6) CHECK (attributed_value >= 0),
  source_revision      integer NOT NULL DEFAULT 1,
  import_batch_id      uuid,
  observed_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, store_id, provider, account_external_id, campaign_external_id,
          report_date, report_timezone, attribution_window, conversion_type),
  FOREIGN KEY (organization_id, store_id) REFERENCES stores(organization_id, id),
  FOREIGN KEY (organization_id, import_batch_id) REFERENCES import_batches(organization_id, id)
);
CREATE INDEX ad_spend_store_date ON ad_spend_facts (organization_id, store_id, report_date);

-- ===== العزل =====
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['import_batches', 'orders', 'order_lines', 'cost_versions', 'ad_spend_facts']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (organization_id = app_current_org()) '
      'WITH CHECK (organization_id = app_current_org())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON import_batches, orders, order_lines, ad_spend_facts TO arso_app;
GRANT SELECT, INSERT ON cost_versions TO arso_app;
