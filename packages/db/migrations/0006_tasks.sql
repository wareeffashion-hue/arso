-- ARSO-TASK-001: المهام (القسم 28). مهمة لها مسؤول وموعد ومعيار تسليم ونتيجة،
-- وقد تنشأ من بطاقة مشكلة. قبول العمل لا يعني نجاحه التجاري؛ ذاك يُقاس لاحقًا.

CREATE TABLE tasks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL,
  store_id            uuid NOT NULL,
  problem_id          uuid,
  title               text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 200),
  brief               text CHECK (brief IS NULL OR char_length(brief) <= 4000),
  acceptance_criteria text CHECK (acceptance_criteria IS NULL OR char_length(acceptance_criteria) <= 2000),
  owner_membership_id uuid,
  due_on              date,
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'assigned',
                        'in_progress', 'review', 'accepted', 'cancelled')),
  -- تكلفة مدخلة (لا تقدير صامت)؛ null = غير معروفة لا صفر
  cost_amount         numeric(20, 6) CHECK (cost_amount IS NULL OR cost_amount >= 0),
  cost_currency       char(3),
  result              text CHECK (result IS NULL OR char_length(result) <= 4000),
  cancel_reason       text CHECK (cancel_reason IS NULL OR char_length(cancel_reason) <= 1000),
  created_by          uuid NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  revision            integer NOT NULL DEFAULT 1,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, store_id) REFERENCES stores(organization_id, id),
  FOREIGN KEY (organization_id, problem_id) REFERENCES problems(organization_id, id),
  FOREIGN KEY (organization_id, owner_membership_id) REFERENCES memberships(organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES memberships(organization_id, id),
  CHECK ((cost_amount IS NULL) = (cost_currency IS NULL)),
  CHECK (status <> 'assigned' OR owner_membership_id IS NOT NULL),
  CHECK (status <> 'accepted' OR result IS NOT NULL),
  CHECK (status <> 'cancelled' OR cancel_reason IS NOT NULL)
);
CREATE INDEX tasks_store_status ON tasks (organization_id, store_id, status);
CREATE INDEX tasks_problem ON tasks (organization_id, problem_id);

CREATE TABLE task_events (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id     uuid NOT NULL,
  task_id             uuid NOT NULL,
  actor_membership_id uuid,
  kind                text NOT NULL CHECK (kind IN ('created', 'status', 'owner', 'edit', 'comment')),
  from_status         text,
  to_status           text,
  body                text CHECK (body IS NULL OR char_length(body) <= 2000),
  occurred_at         timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, task_id) REFERENCES tasks(organization_id, id),
  FOREIGN KEY (organization_id, actor_membership_id) REFERENCES memberships(organization_id, id)
);
CREATE INDEX task_events_task ON task_events (organization_id, task_id, id);
CREATE TRIGGER task_events_append_only
  BEFORE UPDATE OR DELETE ON task_events
  FOR EACH ROW EXECUTE FUNCTION app_forbid_mutation();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tasks', 'task_events']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (organization_id = app_current_org()) '
      'WITH CHECK (organization_id = app_current_org())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE ON tasks TO arso_app;
GRANT SELECT, INSERT ON task_events TO arso_app;
