-- Migration 036: Platform owner (superadmin) + per-org feature entitlements
--
-- platform_owner is NOT a tenant role. It lives in public.platform_roles and
-- is used only for control-plane operations (create orgs, manage org admins,
-- enable/disable features). Tenant admins remain in user_roles.

-- ============================================================
-- Part A: platform_roles
-- ============================================================

CREATE TABLE IF NOT EXISTS public.platform_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'platform_owner'
    CHECK (role IN ('platform_owner')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT uq_platform_roles_user UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_platform_roles_user ON public.platform_roles (user_id);

ALTER TABLE public.platform_roles ENABLE ROW LEVEL SECURITY;

-- Platform owners can see platform role rows (including their own)
DROP POLICY IF EXISTS platform_roles_self_read ON public.platform_roles;
CREATE POLICY platform_roles_self_read ON public.platform_roles
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.platform_roles pr
      WHERE pr.user_id = auth.uid() AND pr.role = 'platform_owner'
    )
  );

-- No INSERT/UPDATE/DELETE for authenticated — service role / SQL only for
-- first bootstrap; later platform APIs use service role after verifying caller.

CREATE OR REPLACE FUNCTION public.is_platform_owner()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_roles
    WHERE user_id = auth.uid()
      AND role = 'platform_owner'
  );
$$;

REVOKE ALL ON FUNCTION public.is_platform_owner() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_platform_owner() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_platform_owner() TO service_role;

-- ============================================================
-- Part B: organization_features (entitlements)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.organization_features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  feature_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT uq_org_feature UNIQUE (organization_id, feature_key),
  CONSTRAINT chk_feature_key CHECK (
    feature_key IN (
      'trips',
      'cash_book',
      'attendance',
      'leave',
      'payroll',
      'reports',
      'stakeholder',
      'users',
      'master_data',
      'manage_employees'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_org_features_org ON public.organization_features (organization_id);

ALTER TABLE public.organization_features ENABLE ROW LEVEL SECURITY;

-- Tenant members can read their org's feature flags (UI gating)
DROP POLICY IF EXISTS org_features_tenant_read ON public.organization_features;
CREATE POLICY org_features_tenant_read ON public.organization_features
  FOR SELECT TO authenticated
  USING (
    organization_id = public.get_user_organization_id()
    OR public.is_platform_owner()
  );

-- Mutations only via service-role platform APIs (no authenticated write policy)

-- Seed defaults for all existing organizations (all modules ON)
INSERT INTO public.organization_features (organization_id, feature_key, enabled)
SELECT o.id, f.feature_key, true
FROM public.organizations o
CROSS JOIN (
  VALUES
    ('trips'),
    ('cash_book'),
    ('attendance'),
    ('leave'),
    ('payroll'),
    ('reports'),
    ('stakeholder'),
    ('users'),
    ('master_data'),
    ('manage_employees')
) AS f(feature_key)
ON CONFLICT (organization_id, feature_key) DO NOTHING;

-- ============================================================
-- Part C: Helper to seed features for a new org (callable by service_role)
-- ============================================================

CREATE OR REPLACE FUNCTION public.seed_organization_features(p_organization_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.organization_features (organization_id, feature_key, enabled)
  SELECT p_organization_id, f.feature_key, true
  FROM (
    VALUES
      ('trips'),
      ('cash_book'),
      ('attendance'),
      ('leave'),
      ('payroll'),
      ('reports'),
      ('stakeholder'),
      ('users'),
      ('master_data'),
      ('manage_employees')
  ) AS f(feature_key)
  ON CONFLICT (organization_id, feature_key) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_organization_features(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seed_organization_features(uuid) TO service_role;

-- Platform owners may list all organizations (control plane)
DROP POLICY IF EXISTS organizations_platform_read ON public.organizations;
CREATE POLICY organizations_platform_read ON public.organizations
  FOR SELECT TO authenticated
  USING (public.is_platform_owner());

COMMENT ON TABLE public.platform_roles IS
  'Control-plane roles (platform_owner). Separate from tenant user_roles. Bootstrap first owner via SQL after Auth user exists.';
COMMENT ON TABLE public.organization_features IS
  'Per-org module entitlements. Managed by platform_owner via platform APIs.';
