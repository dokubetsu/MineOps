-- Migration 070: Consolidate session context into a single round-trip RPC
-- Eliminates multi-query cascades in Next.js middleware (proxy.ts) and client AuthContext (auth-context.tsx)

CREATE OR REPLACE FUNCTION public.get_session_context()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_is_platform_owner boolean := false;
  v_roles jsonb := '[]'::jsonb;
  v_assigned_sites jsonb := '[]'::jsonb;
  v_org jsonb := null;
  v_features jsonb := '[]'::jsonb;
  v_org_active boolean := true;
  v_primary_org_id uuid := null;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'authenticated', false,
      'user_id', null,
      'is_platform_owner', false,
      'user_roles', '[]'::jsonb,
      'assigned_sites', '[]'::jsonb,
      'organization', null,
      'features', '[]'::jsonb,
      'org_active', true
    );
  END IF;

  -- 1. Check Platform Owner
  v_is_platform_owner := public.is_platform_owner();
  IF NOT v_is_platform_owner THEN
    -- Fallback direct check on platform_roles
    v_is_platform_owner := EXISTS (
      SELECT 1 FROM public.platform_roles
      WHERE user_id = v_user_id AND role = 'platform_owner'
    );
  END IF;

  -- 2. Fetch User Roles and extract primary organization ID in one consolidated query
  WITH ordered_roles AS (
    SELECT user_id, role, site_id, organization_id
    FROM public.user_roles
    WHERE user_id = v_user_id
    ORDER BY CASE role
      WHEN 'admin' THEN 1
      WHEN 'site_manager' THEN 2
      WHEN 'unload_clerk' THEN 3
      WHEN 'stakeholder' THEN 4
      WHEN 'employee' THEN 5
      WHEN 'site_employee' THEN 6
      ELSE 7
    END
  )
  SELECT 
    COALESCE(jsonb_agg(to_jsonb(ordered_roles)), '[]'::jsonb),
    (SELECT organization_id FROM ordered_roles LIMIT 1)
  INTO v_roles, v_primary_org_id
  FROM ordered_roles;

  -- 3. If user has an organization, retrieve Org details, features, and active flag
  IF v_primary_org_id IS NOT NULL THEN
    SELECT 
      to_jsonb(o),
      COALESCE(o.active, true),
      COALESCE((
        SELECT jsonb_agg(to_jsonb(f))
        FROM (
          SELECT feature_key, enabled
          FROM public.organization_features
          WHERE organization_id = v_primary_org_id
        ) f
      ), '[]'::jsonb)
    INTO v_org, v_org_active, v_features
    FROM (
      SELECT id, name, active, billing_admin_only, settlement_admin_only, quantity_unit, units_per_m3
      FROM public.organizations
      WHERE id = v_primary_org_id
    ) o;

    IF v_org IS NULL THEN
      v_org_active := false;
    END IF;
  ELSE
    v_org_active := true;
  END IF;

  -- 4. Assigned Sites for User
  SELECT COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
  INTO v_assigned_sites
  FROM (
    SELECT s.id, s.name, s.location
    FROM public.sites s
    WHERE s.id = ANY (public.get_user_site_ids())
      AND COALESCE(s.active, true) = true
    ORDER BY s.name
  ) s;

  RETURN jsonb_build_object(
    'authenticated', true,
    'user_id', v_user_id,
    'is_platform_owner', v_is_platform_owner,
    'user_roles', v_roles,
    'assigned_sites', v_assigned_sites,
    'organization', v_org,
    'features', v_features,
    'org_active', v_org_active
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_session_context() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_session_context() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_session_context() TO service_role;

COMMENT ON FUNCTION public.get_session_context() IS
  'Consolidated session bootstrap function returning roles, org info, features, and sites in a single DB call.';
