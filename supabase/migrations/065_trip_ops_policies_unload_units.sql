-- ============================================================
-- 065 — Trip ops policies, unload_clerk, quantity units
-- ============================================================

-- Per-org trip behavior (defaults preserve existing demo behavior)
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS billing_admin_only boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS settlement_admin_only boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quantity_unit text NOT NULL DEFAULT 'm3',
  ADD COLUMN IF NOT EXISTS units_per_m3 numeric NOT NULL DEFAULT 1;

ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_quantity_unit_check;
ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_quantity_unit_check
  CHECK (quantity_unit IN ('m3', 'unit'));

ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_units_per_m3_check;
ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_units_per_m3_check
  CHECK (units_per_m3 > 0);

COMMENT ON COLUMN public.organizations.billing_admin_only IS
  'When true, trip/distance billing amounts are for admin role UIs only';
COMMENT ON COLUMN public.organizations.settlement_admin_only IS
  'When true, only admin may settle / collect payment on trips';
COMMENT ON COLUMN public.organizations.quantity_unit IS
  'Commercial quantity label: m3 (cubic metres) or unit (custom unit)';
COMMENT ON COLUMN public.organizations.units_per_m3 IS
  'How many commercial units equal 1 m³ (used when quantity_unit = unit)';

-- Unload documentation fields on trips
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS unloaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS unloaded_by uuid,
  ADD COLUMN IF NOT EXISTS unload_notes text,
  ADD COLUMN IF NOT EXISTS unload_quantity numeric;

COMMENT ON COLUMN public.trips.unloaded_at IS 'When destination unload was documented';
COMMENT ON COLUMN public.trips.unload_quantity IS 'Quantity recorded at unload (org commercial unit)';

-- Role: unload_clerk (site-scoped)
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS chk_user_roles_role;
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS chk_user_role;
ALTER TABLE public.user_roles
  ADD CONSTRAINT chk_user_roles_role
  CHECK (role IN ('admin', 'site_manager', 'stakeholder', 'employee', 'site_employee', 'unload_clerk'));

-- Site required for unload_clerk (existing constraint already: role = admin OR site_id IS NOT NULL)

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS text AS $$
  SELECT role FROM public.user_roles
  WHERE user_id = auth.uid()
  ORDER BY CASE role
    WHEN 'admin' THEN 1
    WHEN 'site_manager' THEN 2
    WHEN 'unload_clerk' THEN 3
    WHEN 'stakeholder' THEN 4
    WHEN 'site_employee' THEN 5
    WHEN 'employee' THEN 6
    ELSE 7
  END
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.get_user_organization_id()
RETURNS uuid AS $$
  SELECT organization_id FROM public.user_roles
  WHERE user_id = auth.uid()
  ORDER BY CASE role
    WHEN 'admin' THEN 1
    WHEN 'site_manager' THEN 2
    WHEN 'unload_clerk' THEN 3
    WHEN 'stakeholder' THEN 4
    ELSE 5
  END
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp;

-- Provision RPC: allow unload_clerk
CREATE OR REPLACE FUNCTION public.provision_user_access(
  p_user_id uuid,
  p_role text,
  p_organization_id uuid,
  p_site_id uuid DEFAULT NULL,
  p_share_percent numeric DEFAULT 50,
  p_employee_link_mode text DEFAULT 'none',
  p_employee_id uuid DEFAULT NULL,
  p_employee_name text DEFAULT NULL,
  p_employee_phone text DEFAULT NULL,
  p_employee_wage_type text DEFAULT 'monthly',
  p_employee_wage_rate numeric DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_site_org uuid;
  v_emp_org uuid;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'User ID is required' USING ERRCODE = 'check_violation';
  END IF;

  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'Organization ID is required' USING ERRCODE = 'check_violation';
  END IF;

  IF p_role IS NULL OR p_role NOT IN (
    'admin', 'site_manager', 'stakeholder', 'employee', 'site_employee', 'unload_clerk'
  ) THEN
    RAISE EXCEPTION 'Invalid role: %', p_role USING ERRCODE = 'check_violation';
  END IF;

  IF p_role <> 'admin' AND p_site_id IS NULL THEN
    RAISE EXCEPTION 'A site is required for non-admin roles' USING ERRCODE = 'check_violation';
  END IF;

  IF p_site_id IS NOT NULL THEN
    SELECT organization_id INTO v_site_org
    FROM public.sites
    WHERE id = p_site_id;

    IF v_site_org IS NULL THEN
      RAISE EXCEPTION 'Invalid site ID' USING ERRCODE = 'check_violation';
    END IF;

    IF v_site_org IS DISTINCT FROM p_organization_id THEN
      RAISE EXCEPTION 'Site does not belong to the organization' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  INSERT INTO public.user_roles (user_id, role, site_id, organization_id)
  VALUES (p_user_id, p_role, p_site_id, p_organization_id);

  IF p_role = 'stakeholder' AND p_site_id IS NOT NULL THEN
    INSERT INTO public.stakeholder_site_access (
      stakeholder_user_id, site_id, share_percent, organization_id
    ) VALUES (
      p_user_id, p_site_id, COALESCE(p_share_percent, 50), p_organization_id
    );
  END IF;

  IF p_role IN ('employee', 'site_employee')
     AND p_employee_link_mode IS NOT NULL
     AND p_employee_link_mode <> 'none' THEN

    IF p_employee_link_mode = 'link' THEN
      IF p_employee_id IS NULL THEN
        RAISE EXCEPTION 'employee_id is required when linking an employee' USING ERRCODE = 'check_violation';
      END IF;

      SELECT organization_id INTO v_emp_org
      FROM public.employees
      WHERE id = p_employee_id;

      IF v_emp_org IS NULL THEN
        RAISE EXCEPTION 'Employee not found' USING ERRCODE = 'check_violation';
      END IF;

      IF v_emp_org IS DISTINCT FROM p_organization_id THEN
        RAISE EXCEPTION 'Cannot link employee: employee does not belong to your organization'
          USING ERRCODE = 'check_violation';
      END IF;

      UPDATE public.employees
      SET user_id = p_user_id
      WHERE id = p_employee_id;

    ELSIF p_employee_link_mode = 'create' THEN
      IF p_employee_name IS NULL OR length(trim(p_employee_name)) < 1 THEN
        RAISE EXCEPTION 'employee_name is required when creating an employee' USING ERRCODE = 'check_violation';
      END IF;

      IF p_site_id IS NULL THEN
        RAISE EXCEPTION 'site_id is required when creating an employee' USING ERRCODE = 'check_violation';
      END IF;

      INSERT INTO public.employees (
        name, phone, role, site_id, wage_type, wage_rate, user_id, active, leave_balance, organization_id
      ) VALUES (
        trim(p_employee_name),
        NULLIF(trim(COALESCE(p_employee_phone, '')), ''),
        'Site Employee',
        p_site_id,
        COALESCE(NULLIF(p_employee_wage_type, ''), 'monthly'),
        COALESCE(p_employee_wage_rate, 0),
        p_user_id,
        true,
        15,
        p_organization_id
      );
    END IF;
  END IF;
END;
$$;

-- Document unload (destination clerk or admin)
CREATE OR REPLACE FUNCTION public.document_trip_unload(
  p_trip_id uuid,
  p_unload_notes text DEFAULT NULL,
  p_unload_quantity numeric DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
  v_org uuid;
  v_sites uuid[];
  v_trip_site uuid;
  v_trip_org uuid;
BEGIN
  v_role := public.get_user_role();
  v_org := public.get_user_organization_id();
  v_sites := public.get_user_site_ids();

  IF v_role IS NULL OR v_org IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_role NOT IN ('admin', 'unload_clerk') THEN
    RAISE EXCEPTION 'Only admin or unload clerk can document unload'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT site_id, organization_id INTO v_trip_site, v_trip_org
  FROM public.trips
  WHERE id = p_trip_id AND active IS TRUE;

  IF v_trip_site IS NULL THEN
    RAISE EXCEPTION 'Trip not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_trip_org IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'Trip not in your organization' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_role = 'unload_clerk' AND NOT (v_trip_site = ANY (v_sites)) THEN
    -- Destination clerks are assigned to the destination site; allow org-wide
    -- read later — for v1 require trip.site_id in their sites OR they document
    -- trips destined to their site. Origin site_id is on the trip today, so
    -- assign unload_clerk to the origin site OR we accept any org trip for clerk.
    -- Practical v1: unload_clerk may document any trip in their organization.
    NULL;
  END IF;

  UPDATE public.trips
  SET
    unloaded_at = now(),
    unloaded_by = auth.uid(),
    unload_notes = NULLIF(trim(COALESCE(p_unload_notes, '')), ''),
    unload_quantity = p_unload_quantity,
    updated_at = now()
  WHERE id = p_trip_id;
END;
$$;

REVOKE ALL ON FUNCTION public.document_trip_unload(uuid, text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.document_trip_unload(uuid, text, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.document_trip_unload(uuid, text, numeric) TO service_role;

-- Trips SELECT for unload_clerk (org trips) — additive policy
DROP POLICY IF EXISTS trips_unload_clerk_select ON public.trips;
CREATE POLICY trips_unload_clerk_select ON public.trips
  FOR SELECT TO authenticated
  USING (
    get_user_role() = 'unload_clerk'
    AND organization_id = get_user_organization_id()
  );

COMMENT ON FUNCTION public.document_trip_unload(uuid, text, numeric) IS
  'Destination unload documentation; admin or unload_clerk only; does not settle.';
