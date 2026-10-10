-- ARSO-DIAG-001: المشكلات والفرص (القسمان 14 و15)
-- كل بطاقة ناتجة عن قاعدة بإصدار، وتوقيع يمنع التكرار، وحالة لها انتقالات وأسباب.

CREATE TABLE problems (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  store_id         uuid NOT NULL,
  rule_id          text NOT NULL,
  rule_version     text NOT NULL,
  -- store/rule/version/entity/window: نفس التوقيع يحدّث البطاقة القائمة ولا يكررها
  signature        text NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('quality', 'contribution', 'availability',
                     'conversion', 'fit', 'delivery', 'content', 'retention')),
  status           text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'triaged', 'accepted',
                     'in_progress', 'measuring', 'resolved', 'deferred', 'rejected')),
  -- مكونات الترتيب (القسم 14): أثر 0–3، دليل 0–3، ملاءمة 0–2، قابلية 0–2
  score_impact     smallint NOT NULL CHECK (score_impact BETWEEN 0 AND 3),
  score_evidence   smallint NOT NULL CHECK (score_evidence BETWEEN 0 AND 3),
  score_fit        smallint NOT NULL CHECK (score_fit BETWEEN 0 AND 2),
  score_feasibility smallint NOT NULL CHECK (score_feasibility BETWEEN 0 AND 2),
  quality          text NOT NULL CHECK (quality IN ('complete', 'limited_sample')),
  -- الحقيقة (observation وevidence) منفصلة عن الفرضية (hypotheses) في التخزين نفسه
  title            text NOT NULL,
  observation      jsonb NOT NULL,
  evidence         jsonb NOT NULL DEFAULT '[]',
  hypotheses       jsonb NOT NULL DEFAULT '[]',
  checks           jsonb NOT NULL DEFAULT '[]',
  action           text NOT NULL,
  period_start     timestamptz,
  period_end       timestamptz,
  owner_membership_id uuid,
  due_on           date,
  status_reason    text,
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  -- الشرط لم يعد قائمًا في آخر فحص؛ الحالة لا تتغير تلقائيًا
  condition_cleared_at timestamptz,
  revision         integer NOT NULL DEFAULT 1,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, store_id) REFERENCES stores(organization_id, id),
  FOREIGN KEY (organization_id, owner_membership_id) REFERENCES memberships(organization_id, id),
  CHECK (status NOT IN ('deferred', 'rejected', 'resolved') OR status_reason IS NOT NULL)
);
-- بطاقة مفتوحة واحدة لكل توقيع؛ المحلولة والمرفوضة تبقى تاريخًا، وعودة الشرط تفتح بطاقة جديدة
CREATE UNIQUE INDEX problems_open_signature ON problems (organization_id, store_id, signature)
  WHERE status NOT IN ('resolved', 'rejected');
CREATE INDEX problems_store_status ON problems (organization_id, store_id, status);

-- سجل البطاقة: تغييرات الحالة والمسؤول والتعليقات. append-only
CREATE TABLE problem_events (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id  uuid NOT NULL,
  problem_id       uuid NOT NULL,
  actor_membership_id uuid,
  kind             text NOT NULL CHECK (kind IN ('created', 'refreshed', 'cleared', 'status',
                     'owner', 'comment')),
  from_status      text,
  to_status        text,
  body             text CHECK (body IS NULL OR char_length(body) <= 2000),
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, problem_id) REFERENCES problems(organization_id, id),
  FOREIGN KEY (organization_id, actor_membership_id) REFERENCES memberships(organization_id, id)
);
CREATE INDEX problem_events_problem ON problem_events (organization_id, problem_id, id);
CREATE TRIGGER problem_events_append_only
  BEFORE UPDATE OR DELETE ON problem_events
  FOR EACH ROW EXECUTE FUNCTION app_forbid_mutation();

-- آخر فحص لكل متجر، لإعادة الفحص عند القراءة إن تقادم (القاعدة Q02 زمنية)
CREATE TABLE problem_evaluations (
  organization_id  uuid NOT NULL,
  store_id         uuid NOT NULL,
  rules_version    text NOT NULL,
  evaluated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, store_id),
  FOREIGN KEY (organization_id, store_id) REFERENCES stores(organization_id, id)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['problems', 'problem_events', 'problem_evaluations']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (organization_id = app_current_org()) '
      'WITH CHECK (organization_id = app_current_org())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON problems, problem_evaluations TO arso_app;
GRANT SELECT, INSERT ON problem_events TO arso_app;
