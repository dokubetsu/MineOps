-- Migration 043: Phase B — org feature enforcement (server-side)
--
-- B1  org_has_feature / require_caller_org_feature (fail-closed when row missing)
-- B2  Gate finalize/regenerate payroll + approve leave RPCs
--     + BEFORE INSERT/UPDATE triggers on module write tables
--
-- Missing organization_features row ⇒ feature OFF (not ON).

-- ============================================================
-- Part A: Helpers
-- ============================================================

CREATE OR REPLACE FUNCTION public.org_has_feature(
  p_organization_id uuid,
  p_feature_key text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_organization_id IS NULL OR p_feature_key IS NULL OR length(trim(p_feature_key)) = 0
      THEN false
    ELSE COALESCE(
      (
        SELECT f.enabled
        FROM public.organization_features f
        WHERE f.organization_id = p_organization_id
          AND f.feature_key = p_feature_key
        LIMIT 1
      ),
      false  -- fail-closed: no row ⇒ disabled
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.org_has_feature_for_caller(p_feature_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN public.is_platform_owner() THEN true
    WHEN public.get_user_organization_id() IS NULL THEN false
    ELSE public.org_has_feature(public.get_user_organization_id(), p_feature_key)
  END;
$$;

CREATE OR REPLACE FUNCTION public.require_caller_org_feature(p_feature_key text)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Service role (server jobs / migrations) bypasses feature gates
  IF coalesce(auth.role(), '') = 'service_role' THEN
    RETURN;
  END IF;

  IF public.is_platform_owner() THEN
    RETURN;
  END IF;

  IF NOT public.org_has_feature_for_caller(p_feature_key) THEN
    RAISE EXCEPTION
      'Feature "%" is not enabled for your organization',
      p_feature_key
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.org_has_feature(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.org_has_feature(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.org_has_feature(uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.org_has_feature_for_caller(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.org_has_feature_for_caller(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.org_has_feature_for_caller(text) TO service_role;

REVOKE ALL ON FUNCTION public.require_caller_org_feature(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.require_caller_org_feature(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.require_caller_org_feature(text) TO service_role;

COMMENT ON FUNCTION public.org_has_feature(uuid, text) IS
  'Phase B: true only if organization_features row exists and enabled; missing row = false';

-- ============================================================
-- Part B: Write-path trigger (table mutations)
-- ============================================================

CREATE OR REPLACE FUNCTION public.enforce_module_feature_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org uuid;
  v_key text;
BEGIN
  IF coalesce(auth.role(), '') = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF public.is_platform_owner() THEN
    RETURN NEW;
  END IF;

  v_key := CASE TG_TABLE_NAME
    WHEN 'payroll_runs' THEN 'payroll'
    WHEN 'payroll_lines' THEN 'payroll'
    WHEN 'trips' THEN 'trips'
    WHEN 'cash_books' THEN 'cash_book'
    WHEN 'cash_entries' THEN 'cash_book'
    WHEN 'attendance' THEN 'attendance'
    WHEN 'leave_applications' THEN 'leave'
    ELSE NULL
  END;

  IF v_key IS NULL THEN
    RETURN NEW;
  END IF;

  v_org := NEW.organization_id;

  IF v_org IS NULL THEN
    IF TG_TABLE_NAME = 'payroll_runs' OR TG_TABLE_NAME = 'trips' OR TG_TABLE_NAME = 'cash_books' THEN
      SELECT organization_id INTO v_org FROM public.sites WHERE id = NEW.site_id;
    ELSIF TG_TABLE_NAME = 'payroll_lines' THEN
      SELECT organization_id INTO v_org FROM public.payroll_runs WHERE id = NEW.payroll_run_id;
    ELSIF TG_TABLE_NAME = 'cash_entries' THEN
      SELECT organization_id INTO v_org FROM public.cash_books WHERE id = NEW.cash_book_id;
    ELSIF TG_TABLE_NAME IN ('attendance', 'leave_applications') THEN
      SELECT organization_id INTO v_org FROM public.employees WHERE id = NEW.employee_id;
    END IF;
  END IF;

  IF v_org IS NOT NULL AND NOT public.org_has_feature(v_org, v_key) THEN
    RAISE EXCEPTION
      'Feature "%" is not enabled for this organization',
      v_key
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_feature_payroll_runs ON public.payroll_runs;
CREATE TRIGGER trg_feature_payroll_runs
  BEFORE INSERT OR UPDATE ON public.payroll_runs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_module_feature_write();

DROP TRIGGER IF EXISTS trg_feature_payroll_lines ON public.payroll_lines;
CREATE TRIGGER trg_feature_payroll_lines
  BEFORE INSERT OR UPDATE ON public.payroll_lines
  FOR EACH ROW EXECUTE FUNCTION public.enforce_module_feature_write();

DROP TRIGGER IF EXISTS trg_feature_trips ON public.trips;
CREATE TRIGGER trg_feature_trips
  BEFORE INSERT OR UPDATE ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.enforce_module_feature_write();

DROP TRIGGER IF EXISTS trg_feature_cash_books ON public.cash_books;
CREATE TRIGGER trg_feature_cash_books
  BEFORE INSERT OR UPDATE ON public.cash_books
  FOR EACH ROW EXECUTE FUNCTION public.enforce_module_feature_write();

DROP TRIGGER IF EXISTS trg_feature_cash_entries ON public.cash_entries;
CREATE TRIGGER trg_feature_cash_entries
  BEFORE INSERT OR UPDATE ON public.cash_entries
  FOR EACH ROW EXECUTE FUNCTION public.enforce_module_feature_write();

DROP TRIGGER IF EXISTS trg_feature_attendance ON public.attendance;
CREATE TRIGGER trg_feature_attendance
  BEFORE INSERT OR UPDATE ON public.attendance
  FOR EACH ROW EXECUTE FUNCTION public.enforce_module_feature_write();

DROP TRIGGER IF EXISTS trg_feature_leave ON public.leave_applications;
CREATE TRIGGER trg_feature_leave
  BEFORE INSERT OR UPDATE ON public.leave_applications
  FOR EACH ROW EXECUTE FUNCTION public.enforce_module_feature_write();

-- ============================================================
-- Part C: RPC gates (require feature before authz work)
-- ============================================================

CREATE OR REPLACE FUNCTION public.finalize_payroll_run(p_run_id uuid)
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
  PERFORM public.require_caller_org_feature('payroll');

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
    RAISE EXCEPTION 'Payroll has already been finalized' USING ERRCODE = 'check_violation';
  END IF;

  IF v_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Only draft payroll runs can be finalized (status=%)', v_status
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_org_id IS NULL AND v_site_id IS NOT NULL THEN
    SELECT organization_id INTO v_org_id FROM public.sites WHERE id = v_site_id;
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
    RAISE EXCEPTION 'Forbidden: only admin or site_manager can finalize payroll'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE public.payroll_runs
  SET status = 'finalized',
      updated_at = now()
  WHERE id = p_run_id
    AND status = 'draft';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Failed to finalize payroll run (race lost)' USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

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
  PERFORM public.require_caller_org_feature('payroll');

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

  IF v_org_id IS NULL AND v_site_id IS NOT NULL THEN
    SELECT organization_id INTO v_org_id FROM public.sites WHERE id = v_site_id;
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
  v_finalized_month date;
BEGIN
  PERFORM public.require_caller_org_feature('leave');

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

  IF v_org_id IS NULL AND v_site_id IS NOT NULL THEN
    SELECT organization_id INTO v_org_id
    FROM public.sites
    WHERE id = v_site_id;
  END IF;

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

  IF COALESCE(v_balance, 0) < v_days THEN
    RAISE EXCEPTION
      'Insufficient leave balance: have % day(s), need % day(s)',
      COALESCE(v_balance, 0),
      v_days
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_site_id IS NOT NULL THEN
    SELECT pr.period_month INTO v_finalized_month
    FROM public.payroll_runs pr
    WHERE pr.site_id = v_site_id
      AND pr.status = 'finalized'
      AND pr.period_month >= date_trunc('month', v_from_date)::date
      AND pr.period_month <= date_trunc('month', v_to_date)::date
    LIMIT 1;

    IF v_finalized_month IS NOT NULL THEN
      RAISE EXCEPTION
        'Cannot approve leave: payroll is already finalized for %',
        to_char(v_finalized_month, 'YYYY-MM')
        USING ERRCODE = 'check_violation';
    END IF;
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

  PERFORM public.write_audit_event(
    'approve_leave_rpc',
    'leave_applications',
    p_application_id::text,
    v_org_id,
    jsonb_build_object(
      'employee_id', v_employee_id,
      'days', v_days,
      'from_date', v_from_date,
      'to_date', v_to_date,
      'site_id', v_site_id
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_payroll_run(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_payroll_run(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_payroll_run(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.regenerate_payroll_run(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.regenerate_payroll_run(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.regenerate_payroll_run(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.approve_leave_application(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_leave_application(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_leave_application(uuid) TO service_role;
