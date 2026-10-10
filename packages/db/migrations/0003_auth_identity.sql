-- ARSO-AUTH-001 · ARSO-TENANT-002 (ملاحظات المراجعة الأمنية لـ PR #1)
-- جداول Better Auth بأسماء snake_case، ودور مستقل arso_auth لا يرى بيانات المؤسسات.
-- دور التطبيق arso_app يفقد القراءة العامة لجدول users، ولا يُنشئ مؤسسات أو عضويات
-- إلا عبر دوال محددة (SECURITY DEFINER) تفرض القواعد داخل القاعدة نفسها.

-- ===== جداول المصادقة =====
ALTER TABLE users
  ADD COLUMN image              text,
  ADD COLUMN updated_at         timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN two_factor_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE auth_sessions (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  ip_address  text,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_sessions_user ON auth_sessions (user_id);

CREATE TABLE auth_accounts (
  id                        uuid PRIMARY KEY,
  user_id                   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id                text NOT NULL,
  provider_id               text NOT NULL,
  access_token              text,
  refresh_token             text,
  id_token                  text,
  access_token_expires_at   timestamptz,
  refresh_token_expires_at  timestamptz,
  scope                     text,
  password                  text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_accounts_user ON auth_accounts (user_id);

CREATE TABLE auth_verifications (
  id          uuid PRIMARY KEY,
  identifier  text NOT NULL,
  value       text NOT NULL,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_verifications_identifier ON auth_verifications (identifier);

CREATE TABLE auth_two_factors (
  id                         uuid PRIMARY KEY,
  user_id                    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  secret                     text NOT NULL,
  backup_codes               text NOT NULL,
  verified                   boolean DEFAULT true,
  failed_verification_count  integer DEFAULT 0,
  locked_until               timestamptz
);
CREATE INDEX auth_two_factors_user ON auth_two_factors (user_id);
CREATE INDEX auth_two_factors_secret ON auth_two_factors (secret);

-- ===== الدعوات (القسم 10: صلاحية زمنية، استخدام واحد، بريد مقصود) =====
CREATE TABLE invitations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  email            citext NOT NULL,
  role             text NOT NULL
                   CHECK (role IN ('marketing_manager', 'analyst', 'finance',
                                   'creative', 'operations', 'agency')),
  store_ids        uuid[] NOT NULL DEFAULT '{}',
  -- يُخزَّن تجزئة الرمز فقط، والرمز نفسه يُرسل في البريد مرة واحدة
  token_hash       bytea NOT NULL UNIQUE,
  invited_by       uuid NOT NULL,
  expires_at       timestamptz NOT NULL,
  accepted_at      timestamptz,
  accepted_by      uuid REFERENCES users(id),
  revoked_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, invited_by) REFERENCES memberships(organization_id, id),
  CHECK (expires_at > created_at)
);
CREATE INDEX invitations_org ON invitations (organization_id, created_at);
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invitations
  USING (organization_id = app_current_org()) WITH CHECK (organization_id = app_current_org());

-- ===== دوال محددة الصلاحية =====
-- كلها: search_path ثابت، ومعاملات مكتوبة، ولا SQL ديناميكي.

-- إنشاء مؤسسة: المؤسسة والعضوية المالكة وسجل التدقيق في معاملة واحدة.
-- الخادم يستدعيها فقط بمعرّف مستخدم موثّق ومتحقق البريد.
CREATE FUNCTION create_organization(p_name text, p_owner_user_id uuid)
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
DECLARE
  v_org uuid := gen_random_uuid();
  v_verified boolean;
BEGIN
  SELECT email_verified INTO v_verified FROM users WHERE id = p_owner_user_id;
  IF v_verified IS NOT TRUE THEN
    RAISE EXCEPTION 'owner email not verified' USING ERRCODE = 'insufficient_privilege';
  END IF;
  INSERT INTO organizations (id, name) VALUES (v_org, p_name);
  INSERT INTO memberships (organization_id, user_id, role, status)
    VALUES (v_org, p_owner_user_id, 'owner', 'active');
  INSERT INTO audit_logs (organization_id, actor_type, actor_id, action, target_type, target_id)
    VALUES (v_org, 'user', p_owner_user_id::text, 'organization.create', 'organization', v_org::text);
  RETURN v_org;
END $$;

-- قبول دعوة: يتحقق من التجزئة والصلاحية الزمنية والاستخدام الواحد وتطابق البريد،
-- ثم ينشئ العضوية والمنح ويُغلق الدعوة. يُقفل الصف لمنع القبول المزدوج المتزامن.
CREATE FUNCTION accept_invitation(p_token_hash bytea, p_user_id uuid)
  RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
DECLARE
  v_inv invitations%ROWTYPE;
  v_email citext;
  v_verified boolean;
  v_membership uuid;
  v_store uuid;
BEGIN
  SELECT * INTO v_inv FROM invitations WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND OR v_inv.revoked_at IS NOT NULL OR v_inv.accepted_at IS NOT NULL
     OR v_inv.expires_at <= now() THEN
    RAISE EXCEPTION 'invitation invalid' USING ERRCODE = 'P0002';
  END IF;
  SELECT email, email_verified INTO v_email, v_verified FROM users WHERE id = p_user_id;
  IF v_email IS DISTINCT FROM v_inv.email OR v_verified IS NOT TRUE THEN
    RAISE EXCEPTION 'invitation email mismatch' USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO memberships (organization_id, user_id, role, status)
    VALUES (v_inv.organization_id, p_user_id, v_inv.role, 'active')
    ON CONFLICT (organization_id, user_id)
      DO UPDATE SET role = EXCLUDED.role, status = 'active', revoked_at = NULL
    RETURNING id INTO v_membership;

  FOREACH v_store IN ARRAY v_inv.store_ids LOOP
    INSERT INTO store_grants (organization_id, membership_id, store_id)
      VALUES (v_inv.organization_id, v_membership, v_store)
      ON CONFLICT (membership_id, store_id) DO UPDATE SET revoked_at = NULL;
  END LOOP;

  UPDATE invitations SET accepted_at = now(), accepted_by = p_user_id WHERE id = v_inv.id;
  INSERT INTO audit_logs (organization_id, actor_type, actor_id, action, target_type, target_id)
    VALUES (v_inv.organization_id, 'user', p_user_id::text, 'invitation.accept',
            'membership', v_membership::text);
  RETURN v_inv.organization_id;
END $$;

-- عضويات المستخدم عبر المؤسسات (لصفحة «مؤسساتي»). لا تعيد إلا ما يخص المستخدم نفسه.
CREATE FUNCTION user_memberships(p_user_id uuid)
  RETURNS TABLE (organization_id uuid, organization_name text, membership_id uuid, role text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  SELECT m.organization_id, o.name, m.id, m.role
  FROM memberships m JOIN organizations o ON o.id = m.organization_id
  WHERE m.user_id = p_user_id AND m.status = 'active' AND o.status <> 'closed'
  ORDER BY o.name
$$;

-- أعضاء المؤسسة الحالية فقط (حسب سياق المعاملة)، بدل قراءة جدول users كاملًا.
CREATE FUNCTION current_org_members()
  RETURNS TABLE (membership_id uuid, user_id uuid, email citext, name text, role text, status text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  SELECT m.id, u.id, u.email, u.name, m.role, m.status
  FROM memberships m JOIN users u ON u.id = m.user_id
  WHERE m.organization_id = app_current_org()
  ORDER BY m.created_at
$$;

REVOKE ALL ON FUNCTION create_organization(text, uuid), accept_invitation(bytea, uuid),
  user_memberships(uuid), current_org_members() FROM PUBLIC;

-- ===== الصلاحيات =====
-- arso_app: لا قراءة عامة للمستخدمين، ولا إنشاء مباشر للمؤسسات أو العضويات
REVOKE SELECT, INSERT, UPDATE ON users FROM arso_app;
REVOKE INSERT ON organizations, memberships FROM arso_app;
GRANT SELECT, INSERT, UPDATE ON invitations TO arso_app;
GRANT EXECUTE ON FUNCTION create_organization(text, uuid), accept_invitation(bytea, uuid),
  user_memberships(uuid), current_org_members() TO arso_app;

-- arso_auth: جداول الهوية والجلسات فقط، ولا شيء من بيانات المؤسسات
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'arso_auth') THEN
    CREATE ROLE arso_auth NOLOGIN NOBYPASSRLS;
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO arso_auth;
GRANT SELECT, INSERT, UPDATE, DELETE ON users, auth_sessions, auth_accounts,
  auth_verifications, auth_two_factors TO arso_auth;
