-- Migration 034: Atomic payroll finalization + leave balance deduction on approval
--
-- Part A: finalize_payroll_run — row-locked draft → finalized transition
-- Part B: approve_leave_application also decrements employees.leave_balance

-- ============================================================
-- Part A: Atomic payroll finalization
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
  IF p_run_id IS NULL THEN
    RAISE EXCEPTION 'Payroll run id is required' USING ERRCODE = 'check_violation';
  END IF;

  -- Lock the row to prevent concurrent finalization
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

  -- Authorization: admin in same org, or site_manager scoped to site
  v_role := public.get_user_role();
  IF v_role = 'admin' THEN
    IF v_org_id IS DISTINCT FROM public.get_user_organization_id() THEN
      RAISE EXCEPTION 'Forbidden: payroll run is outside your organization' USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF v_role = 'site_manager' THEN
    IF NOT (v_site_id = ANY (public.get_user_site_ids())) THEN
      RAISE EXCEPTION 'Forbidden: payroll run is outside your site scope' USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSE
    RAISE EXCEPTION 'Forbidden: only admin or site_manager can finalize payroll' USING ERRCODE = 'insufficient_privilege';
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

-- Authenticated clients call this under RLS-equivalent checks inside the function
REVOKE ALL ON FUNCTION public.finalize_payroll_run(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_payroll_run(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_payroll_run(uuid) TO service_role;

-- ============================================================
-- Part B: Leave approval also deducts leave_balance atomically
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
BEGIN
  SELECT employee_id, from_date, to_date
  INTO v_employee_id, v_from_date, v_to_date
  FROM public.leave_applications
  WHERE id = p_application_id AND status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Leave application not found or not pending';
  END IF;

  v_days := (v_to_date - v_from_date) + 1;
  IF v_days < 1 THEN
    RAISE EXCEPTION 'Invalid leave date range' USING ERRCODE = 'check_violation';
  END IF;

  -- Deduct leave balance (never below 0) before marking approved
  SELECT leave_balance INTO v_balance
  FROM public.employees
  WHERE id = v_employee_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found for leave application';
  END IF;

  UPDATE public.employees
  SET leave_balance = GREATEST(0, COALESCE(leave_balance, 0) - v_days),
      updated_at = now()
  WHERE id = v_employee_id;

  UPDATE public.leave_applications
  SET status = 'approved',
      updated_at = now()
  WHERE id = p_application_id;

  -- Mark attendance days as leave for the range
  v_cur_date := v_from_date;
  WHILE v_cur_date <= v_to_date LOOP
    INSERT INTO public.attendance (employee_id, att_date, status, organization_id)
    SELECT v_employee_id, v_cur_date, 'leave', e.organization_id
    FROM public.employees e
    WHERE e.id = v_employee_id
    ON CONFLICT (employee_id, att_date)
    DO UPDATE SET status = 'leave';

    v_cur_date := v_cur_date + 1;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_leave_application(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_leave_application(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_leave_application(uuid) TO service_role;
