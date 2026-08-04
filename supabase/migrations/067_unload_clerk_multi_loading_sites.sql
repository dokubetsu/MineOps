-- ============================================================
-- 067 — Unload clerk: multiple loading sites
-- ============================================================
-- Assign one or more *loading* (origin) sites to an unload clerk so they
-- see outbound trips from those sites to document unload at any destination.

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
  p_employee_wage_rate numeric DEFAULT 0,
  p_site_ids uuid[] DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_site_org uuid;
  v_emp_org uuid;
  v_sites uuid[];
  v_sid uuid;
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

  -- Resolve site list: p_site_ids (multi) wins; else single p_site_id
  IF p_site_ids IS NOT NULL AND cardinality(p_site_ids) > 0 THEN
    SELECT array_agg(DISTINCT x) INTO v_sites
    FROM unnest(p_site_ids) AS x
    WHERE x IS NOT NULL;
  ELSIF p_site_id IS NOT NULL THEN
    v_sites := ARRAY[p_site_id];
  ELSE
    v_sites := NULL;
  END IF;

  IF p_role <> 'admin' AND (v_sites IS NULL OR cardinality(v_sites) < 1) THEN
    RAISE EXCEPTION 'A site is required for non-admin roles' USING ERRCODE = 'check_violation';
  END IF;

  -- Multi-site only allowed for unload_clerk
  IF p_role <> 'unload_clerk' AND v_sites IS NOT NULL AND cardinality(v_sites) > 1 THEN
    RAISE EXCEPTION 'Only unload clerks may be assigned multiple loading sites'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_sites IS NOT NULL THEN
    FOREACH v_sid IN ARRAY v_sites
    LOOP
      SELECT organization_id INTO v_site_org
      FROM public.sites
      WHERE id = v_sid;

      IF v_site_org IS NULL THEN
        RAISE EXCEPTION 'Invalid site ID' USING ERRCODE = 'check_violation';
      END IF;

      IF v_site_org IS DISTINCT FROM p_organization_id THEN
        RAISE EXCEPTION 'Site does not belong to the organization' USING ERRCODE = 'check_violation';
      END IF;
    END LOOP;
  END IF;

  IF p_role = 'admin' THEN
    INSERT INTO public.user_roles (user_id, role, site_id, organization_id)
    VALUES (p_user_id, p_role, NULL, p_organization_id);
  ELSIF p_role = 'unload_clerk' THEN
    INSERT INTO public.user_roles (user_id, role, site_id, organization_id)
    SELECT p_user_id, p_role, sid, p_organization_id
    FROM unnest(v_sites) AS sid;
  ELSE
    INSERT INTO public.user_roles (user_id, role, site_id, organization_id)
    VALUES (p_user_id, p_role, v_sites[1], p_organization_id);
  END IF;

  IF p_role = 'stakeholder' AND v_sites[1] IS NOT NULL THEN
    INSERT INTO public.stakeholder_site_access (
      stakeholder_user_id, site_id, share_percent, organization_id
    ) VALUES (
      p_user_id, v_sites[1], COALESCE(p_share_percent, 50), p_organization_id
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

      IF v_sites[1] IS NULL THEN
        RAISE EXCEPTION 'site_id is required when creating an employee' USING ERRCODE = 'check_violation';
      END IF;

      INSERT INTO public.employees (
        name, phone, role, site_id, wage_type, wage_rate, user_id, active, leave_balance, organization_id
      ) VALUES (
        trim(p_employee_name),
        NULLIF(trim(COALESCE(p_employee_phone, '')), ''),
        'Site Employee',
        v_sites[1],
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

COMMENT ON FUNCTION public.provision_user_access IS
  'Provision tenant role; unload_clerk may receive multiple loading sites via p_site_ids.';
