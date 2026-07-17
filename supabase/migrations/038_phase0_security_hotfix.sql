-- Migration 038: Phase 0 security hotfix
--
-- Closes critical multi-tenant / privilege gaps (review Phase 0):
--   C1  approve_leave_application — add admin/site_manager + org/site authz;
--       reject insufficient leave balance (no silent clamp)
--   C2  org_users — filter to caller's org (or platform_owner / service_role)
--   C3  vehicles/drivers manager policies — require organization_id match
--   C4  regenerate_payroll_run — authz + grants parity with finalize_payroll_run
--   H1  set_child_organization_id — always stamp org from parent (never trust client)
--
-- Does NOT replace 037_fix_platform_roles_rls.sql (platform_roles self-read).

-- ============================================================
-- Part A: approve_leave_application — authz + balance reject
-- ============================================================

CREATE OR REPLACE FUNCTION public.approve_leave_application(p_application_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_employee_id uuid;
  v_from_date date;
  v_to_date date;
  v_cur_date date;
  v_days integer;
  v_balance numeric;
  v_site_id uuid;
  v_org_id uuid;
  v_role text;
BEGIN
  IF p_application_id IS NULL THEN
    RAISE EXCEPTION 'Leave application id is required' USING ERRCODE = 'check_violation';
  END IF;

  SELECT employee_id, from_date, to_date
  INTO v_employee_id, v_from_date, v_to_date
  FROM public.leave_applications
  WHERE id = p_application_id AND status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Leave application not found or not pending';
  END IF;

  SELECT leave_balance, site_id, organization_id
  INTO v_balance, v_site_id, v_org_id
  FROM public.employees
  WHERE id = v_employee_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found for leave application';
  END IF;

  -- Fallback org from site if employee row is missing denormalized org
  IF v_org_id IS NULL AND v_site_id IS NOT NULL THEN
    SELECT organization_id INTO v_org_id
    FROM public.sites
    WHERE id = v_site_id;
  END IF;

  -- Authorization: admin in same org, or site_manager scoped to employee site
  v_role := public.get_user_role();
  IF v_role = 'admin' THEN
    IF v_org_id IS DISTINCT FROM public.get_user_organization_id() THEN
      RAISE EXCEPTION 'Forbidden: leave application is outside your organization'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF v_role = 'site_manager' THEN
    IF v_site_id IS NULL OR NOT (v_site_id = ANY (public.get_user_site_ids())) THEN
      RAISE EXCEPTION 'Forbidden: leave application is outside your site scope'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSE
    RAISE EXCEPTION 'Forbidden: only admin or site_manager can approve leave'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_days := (v_to_date - v_from_date) + 1;
  IF v_days < 1 THEN
    RAISE EXCEPTION 'Invalid leave date range' USING ERRCODE = 'check_violation';
  END IF;

  -- Reject when balance is insufficient (do not clamp and still approve)
  IF COALESCE(v_balance, 0) < v_days THEN
    RAISE EXCEPTION
      'Insufficient leave balance: have % day(s), need % day(s)',
      COALESCE(v_balance, 0),
      v_days
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.employees
  SET leave_balance = COALESCE(leave_balance, 0) - v_days,
      updated_at = now()
  WHERE id = v_employee_id;

  UPDATE public.leave_applications
  SET status = 'approved',
      updated_at = now()
  WHERE id = p_application_id
    AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Failed to approve leave (race lost)' USING ERRCODE = 'check_violation';
  END IF;

  -- Mark attendance days as leave for the range
  v_cur_date := v_from_date;
  WHILE v_cur_date <= v_to_date LOOP
    INSERT INTO public.attendance (employee_id, att_date, status, organization_id)
    SELECT v_employee_id, v_cur_date, 'leave', COALESCE(e.organization_id, v_org_id)
    FROM public.employees e
    WHERE e.id = v_employee_id
    ON CONFLICT (employee_id, att_date)
    DO UPDATE SET status = 'leave';

    v_cur_date := v_cur_date + 1;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_leave_application(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_leave_application(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.approve_leave_application(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_leave_application(uuid) TO service_role;

-- ============================================================
-- Part B: regenerate_payroll_run — authz + explicit grants
-- ============================================================

CREATE OR REPLACE FUNCTION public.regenerate_payroll_run(p_run_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status text;
  v_site_id uuid;
  v_org_id uuid;
  v_role text;
BEGIN
  IF p_run_id IS NULL THEN
    RAISE EXCEPTION 'Payroll run id is required' USING ERRCODE = 'check_violation';
  END IF;

  SELECT status, site_id, organization_id
  INTO v_status, v_site_id, v_org_id
  FROM public.payroll_runs
  WHERE id = p_run_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payroll run not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_status = 'finalized' THEN
    RAISE EXCEPTION 'Payroll has already been finalized for this period.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Only draft payroll runs can be regenerated (status=%)', v_status
      USING ERRCODE = 'check_violation';
  END IF;

  -- Fallback org from site if denormalized column missing
  IF v_org_id IS NULL AND v_site_id IS NOT NULL THEN
    SELECT organization_id INTO v_org_id
    FROM public.sites
    WHERE id = v_site_id;
  END IF;

  v_role := public.get_user_role();
  IF v_role = 'admin' THEN
    IF v_org_id IS DISTINCT FROM public.get_user_organization_id() THEN
      RAISE EXCEPTION 'Forbidden: payroll run is outside your organization'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF v_role = 'site_manager' THEN
    IF v_site_id IS NULL OR NOT (v_site_id = ANY (public.get_user_site_ids())) THEN
      RAISE EXCEPTION 'Forbidden: payroll run is outside your site scope'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSE
    RAISE EXCEPTION 'Forbidden: only admin or site_manager can regenerate payroll'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  DELETE FROM public.payroll_lines WHERE payroll_run_id = p_run_id;
END;
$$;

REVOKE ALL ON FUNCTION public.regenerate_payroll_run(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.regenerate_payroll_run(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.regenerate_payroll_run(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.regenerate_payroll_run(uuid) TO service_role;

-- ============================================================
-- Part C: org_users — no cross-tenant email directory
-- ============================================================
-- Keep security_invoker = false so the view owner can read auth.users.
-- Restrict rows to: caller's org, platform_owner (all), or service_role (all).
-- list-users API uses Auth Admin + user_roles and does not depend on this view.

CREATE OR REPLACE VIEW public.org_users
WITH (security_invoker = false)
AS
SELECT
  u.id,
  u.email,
  u.created_at,
  ur.role,
  ur.site_id,
  ur.organization_id
FROM auth.users u
JOIN public.user_roles ur ON u.id = ur.user_id
WHERE
  -- Service role (server routes / migrations tooling)
  coalesce(auth.role(), '') = 'service_role'
  -- Platform control plane
  OR public.is_platform_owner()
  -- Tenant isolation
  OR ur.organization_id = public.get_user_organization_id();

REVOKE ALL ON public.org_users FROM PUBLIC;
REVOKE ALL ON public.org_users FROM anon;
GRANT SELECT ON public.org_users TO authenticated;
GRANT SELECT ON public.org_users TO service_role;

COMMENT ON VIEW public.org_users IS
  'User directory (auth.users ⋈ user_roles). Rows limited to caller org, platform_owner, or service_role.';

-- ============================================================
-- Part D: vehicles / drivers manager policies — org scoped
-- ============================================================

DROP POLICY IF EXISTS vehicles_manager_update ON public.vehicles;
CREATE POLICY vehicles_manager_update ON public.vehicles FOR UPDATE TO authenticated
  USING (
    get_user_role() = 'site_manager'
    AND organization_id = get_user_organization_id()
  )
  WITH CHECK (
    get_user_role() = 'site_manager'
    AND organization_id = get_user_organization_id()
  );

-- INSERT already org-scoped in 023; re-assert for safety
DROP POLICY IF EXISTS vehicles_manager_insert ON public.vehicles;
CREATE POLICY vehicles_manager_insert ON public.vehicles FOR INSERT TO authenticated
  WITH CHECK (
    get_user_role() = 'site_manager'
    AND organization_id = get_user_organization_id()
  );

DROP POLICY IF EXISTS drivers_manager_insert ON public.drivers;
CREATE POLICY drivers_manager_insert ON public.drivers FOR INSERT TO authenticated
  WITH CHECK (
    get_user_role() = 'site_manager'
    AND organization_id = get_user_organization_id()
  );

DROP POLICY IF EXISTS drivers_manager_update ON public.drivers;
CREATE POLICY drivers_manager_update ON public.drivers FOR UPDATE TO authenticated
  USING (
    get_user_role() = 'site_manager'
    AND organization_id = get_user_organization_id()
  )
  WITH CHECK (
    get_user_role() = 'site_manager'
    AND organization_id = get_user_organization_id()
  );

-- ============================================================
-- Part E: set_child_organization_id — always force parent org
-- ============================================================
-- Never trust a client-supplied organization_id on child tables.
-- Overwrite from the parent row every INSERT/UPDATE.

CREATE OR REPLACE FUNCTION public.set_child_organization_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'employees' THEN
    SELECT organization_id INTO v_org_id FROM public.sites WHERE id = NEW.site_id;
  ELSIF TG_TABLE_NAME = 'trips' THEN
    SELECT organization_id INTO v_org_id FROM public.sites WHERE id = NEW.site_id;
  ELSIF TG_TABLE_NAME = 'cash_books' THEN
    SELECT organization_id INTO v_org_id FROM public.sites WHERE id = NEW.site_id;
  ELSIF TG_TABLE_NAME = 'cash_entries' THEN
    SELECT organization_id INTO v_org_id FROM public.cash_books WHERE id = NEW.cash_book_id;
  ELSIF TG_TABLE_NAME = 'attendance' THEN
    SELECT organization_id INTO v_org_id FROM public.employees WHERE id = NEW.employee_id;
    IF v_org_id IS NULL THEN
      SELECT s.organization_id INTO v_org_id
      FROM public.employees e
      JOIN public.sites s ON s.id = e.site_id
      WHERE e.id = NEW.employee_id;
    END IF;
  ELSIF TG_TABLE_NAME = 'leave_applications' THEN
    SELECT organization_id INTO v_org_id FROM public.employees WHERE id = NEW.employee_id;
    IF v_org_id IS NULL THEN
      SELECT s.organization_id INTO v_org_id
      FROM public.employees e
      JOIN public.sites s ON s.id = e.site_id
      WHERE e.id = NEW.employee_id;
    END IF;
  ELSIF TG_TABLE_NAME = 'payroll_runs' THEN
    SELECT organization_id INTO v_org_id FROM public.sites WHERE id = NEW.site_id;
  ELSIF TG_TABLE_NAME = 'payroll_lines' THEN
    SELECT organization_id INTO v_org_id FROM public.payroll_runs WHERE id = NEW.payroll_run_id;
  END IF;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Cannot resolve organization_id for %. Check parent row exists.', TG_TABLE_NAME
      USING ERRCODE = 'not_null_violation';
  END IF;

  -- Always overwrite — ignore client spoofing
  NEW.organization_id := v_org_id;
  RETURN NEW;
END;
$$;
