-- Migration 033: Lock down register_tenant EXECUTE grants + atomic provision_user_access RPC
--
-- Part A: SECURITY DEFINER functions must not be callable by anon/authenticated via PostgREST.
-- Part B: provision_user_access wraps role + stakeholder access + employee link/create in one transaction
--         so the create-user API route can roll back Auth cleanly on any failure.

-- ============================================================
-- Part A: Explicit EXECUTE lockdown for register_tenant
-- ============================================================

REVOKE ALL ON FUNCTION public.register_tenant(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_tenant(text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.register_tenant(text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.register_tenant(text, uuid) TO service_role;

-- ============================================================
-- Part B: Atomic user provisioning after Auth user creation
-- ============================================================

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

  IF p_role IS NULL OR p_role NOT IN ('admin', 'site_manager', 'stakeholder', 'employee', 'site_employee') THEN
    RAISE EXCEPTION 'Invalid role: %', p_role USING ERRCODE = 'check_violation';
  END IF;

  IF p_role <> 'admin' AND p_site_id IS NULL THEN
    RAISE EXCEPTION 'A site is required for non-admin roles' USING ERRCODE = 'check_violation';
  END IF;

  -- Validate site belongs to caller's organization
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

  -- 1) Assign role
  INSERT INTO public.user_roles (user_id, role, site_id, organization_id)
  VALUES (p_user_id, p_role, p_site_id, p_organization_id);

  -- 2) Stakeholder site access
  IF p_role = 'stakeholder' AND p_site_id IS NOT NULL THEN
    INSERT INTO public.stakeholder_site_access (
      stakeholder_user_id,
      site_id,
      share_percent,
      organization_id
    ) VALUES (
      p_user_id,
      p_site_id,
      COALESCE(p_share_percent, 50),
      p_organization_id
    );
  END IF;

  -- 3) Employee link / create
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
        name,
        phone,
        role,
        site_id,
        wage_type,
        wage_rate,
        user_id,
        active,
        leave_balance,
        organization_id
      ) VALUES (
        trim(p_employee_name),
        NULLIF(trim(COALESCE(p_employee_phone, '')), ''),
        'Site Employee',
        p_site_id,
        COALESCE(NULLIF(p_employee_wage_type, ''), 'monthly'),
        COALESCE(p_employee_wage_rate, 0),
        p_user_id,
        true,
        0,
        p_organization_id
      );
    ELSE
      RAISE EXCEPTION 'Invalid employee_link_mode: %', p_employee_link_mode USING ERRCODE = 'check_violation';
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.provision_user_access(
  uuid, text, uuid, uuid, numeric, text, uuid, text, text, text, numeric
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.provision_user_access(
  uuid, text, uuid, uuid, numeric, text, uuid, text, text, text, numeric
) FROM anon;
REVOKE ALL ON FUNCTION public.provision_user_access(
  uuid, text, uuid, uuid, numeric, text, uuid, text, text, text, numeric
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.provision_user_access(
  uuid, text, uuid, uuid, numeric, text, uuid, text, text, text, numeric
) TO service_role;
