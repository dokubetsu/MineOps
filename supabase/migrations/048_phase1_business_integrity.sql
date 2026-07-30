-- Migration 048: Phase 1 — business integrity
--
-- P1.1 Freeze attendance when site month has finalized payroll
-- P1.2 Leave approve charges only days not already muster-Leave (no double deduct);
--      unapprove restores only those charged days
-- P1.3 finalize_payroll_run requires ≥1 payroll line
-- P1.4 Reaffirm stakeholder share sum ≤ 100% per site
-- P1.5 Settled trips require settlement_amount > 0

-- ============================================================
-- P1.1: Block attendance writes in finalized payroll months
-- ============================================================

CREATE OR REPLACE FUNCTION public.prevent_attendance_when_payroll_finalized()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_emp uuid;
  v_date date;
  v_site uuid;
  v_month date;
  v_finalized date;
BEGIN
  IF coalesce(auth.role(), '') = 'service_role' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_emp := OLD.employee_id;
    v_date := OLD.att_date;
  ELSE
    v_emp := NEW.employee_id;
    v_date := NEW.att_date;
  END IF;

  IF v_emp IS NULL OR v_date IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT e.site_id INTO v_site
  FROM public.employees e
  WHERE e.id = v_emp;

  IF v_site IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_month := date_trunc('month', v_date)::date;

  SELECT pr.period_month INTO v_finalized
  FROM public.payroll_runs pr
  WHERE pr.site_id = v_site
    AND pr.status = 'finalized'
    AND pr.period_month = v_month
  LIMIT 1;

  IF v_finalized IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot change attendance for %: payroll is already finalized for %',
      v_date,
      to_char(v_finalized, 'YYYY-MM')
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_payroll_lock ON public.attendance;
CREATE TRIGGER trg_attendance_payroll_lock
  BEFORE INSERT OR UPDATE OR DELETE ON public.attendance
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_attendance_when_payroll_finalized();

COMMENT ON FUNCTION public.prevent_attendance_when_payroll_finalized() IS
  'Phase 1: reject muster attendance changes when the employee site has a finalized payroll run for that calendar month.';

-- ============================================================
-- P1.2: Leave approve — net balance charge (skip already leave days)
-- ============================================================

CREATE OR REPLACE FUNCTION public.approve_leave_application(
  p_application_id uuid,
  p_force boolean DEFAULT false
)
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
  v_already_leave integer;
  v_charge_days integer;
  v_balance numeric;
  v_site_id uuid;
  v_org_id uuid;
  v_role text;
  v_finalized_month date;
  v_conflict_count integer;
  v_snapshot jsonb;
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
    SELECT organization_id INTO v_org_id FROM public.sites WHERE id = v_site_id;
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

  IF v_days > 30 THEN
    RAISE EXCEPTION 'Leave range cannot exceed 30 days' USING ERRCODE = 'check_violation';
  END IF;

  -- Days already marked Leave (typically muster) already consumed balance
  SELECT count(*)::integer INTO v_already_leave
  FROM public.attendance a
  WHERE a.employee_id = v_employee_id
    AND a.att_date BETWEEN v_from_date AND v_to_date
    AND a.status = 'leave';

  v_charge_days := v_days - COALESCE(v_already_leave, 0);
  IF v_charge_days < 0 THEN
    v_charge_days := 0;
  END IF;

  IF COALESCE(v_balance, 0) < v_charge_days THEN
    RAISE EXCEPTION
      'Insufficient leave balance: have % day(s), need % day(s) (% already Leave on muster)',
      COALESCE(v_balance, 0),
      v_charge_days,
      COALESCE(v_already_leave, 0)
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

  SELECT count(*)::integer INTO v_conflict_count
  FROM public.attendance a
  WHERE a.employee_id = v_employee_id
    AND a.att_date BETWEEN v_from_date AND v_to_date
    AND a.status IS DISTINCT FROM 'leave';

  IF v_conflict_count > 0 AND NOT COALESCE(p_force, false) THEN
    RAISE EXCEPTION
      'Approving would overwrite % existing attendance day(s). Confirm force approve to continue.',
      v_conflict_count
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(
    jsonb_object_agg(a.att_date::text, to_jsonb(a.status)),
    '{}'::jsonb
  )
  INTO v_snapshot
  FROM public.attendance a
  WHERE a.employee_id = v_employee_id
    AND a.att_date BETWEEN v_from_date AND v_to_date;

  UPDATE public.employees
  SET leave_balance = COALESCE(leave_balance, 0) - v_charge_days,
      updated_at = now()
  WHERE id = v_employee_id;

  UPDATE public.leave_applications
  SET status = 'approved',
      attendance_snapshot = v_snapshot,
      updated_at = now()
  WHERE id = p_application_id
    AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Failed to approve leave (race lost)' USING ERRCODE = 'check_violation';
  END IF;

  PERFORM set_config('khani.skip_leave_balance_sync', '1', true);

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
      'charge_days', v_charge_days,
      'already_leave_days', COALESCE(v_already_leave, 0),
      'from_date', v_from_date,
      'to_date', v_to_date,
      'site_id', v_site_id,
      'force', COALESCE(p_force, false),
      'snapshot_keys', (SELECT count(*) FROM jsonb_object_keys(v_snapshot))
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.unapprove_leave_application(p_application_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_employee_id uuid;
  v_from_date date;
  v_to_date date;
  v_days integer;
  v_restore_days integer := 0;
  v_site_id uuid;
  v_org_id uuid;
  v_role text;
  v_finalized_month date;
  v_snapshot jsonb;
  v_cur date;
  v_prev text;
  v_restored integer := 0;
  v_deleted integer := 0;
BEGIN
  PERFORM public.require_caller_org_feature('leave');

  SELECT employee_id, from_date, to_date, COALESCE(attendance_snapshot, '{}'::jsonb)
  INTO v_employee_id, v_from_date, v_to_date, v_snapshot
  FROM public.leave_applications
  WHERE id = p_application_id AND status = 'approved'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Leave application not found or not approved';
  END IF;

  SELECT site_id, organization_id
  INTO v_site_id, v_org_id
  FROM public.employees
  WHERE id = v_employee_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found';
  END IF;

  IF v_org_id IS NULL AND v_site_id IS NOT NULL THEN
    SELECT organization_id INTO v_org_id FROM public.sites WHERE id = v_site_id;
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
    RAISE EXCEPTION 'Forbidden: only admin or site_manager can reverse leave approval'
      USING ERRCODE = 'insufficient_privilege';
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
        'Cannot reverse leave: payroll is already finalized for %',
        to_char(v_finalized_month, 'YYYY-MM')
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  v_days := (v_to_date - v_from_date) + 1;

  -- Restore only days this approve charged: prior snapshot status was not already leave
  -- (muster Leave days were already deducted and must not be refunded again).
  -- jsonb ->> yields plain text for string values written via to_jsonb(status).
  SELECT count(*)::integer INTO v_restore_days
  FROM generate_series(v_from_date, v_to_date, '1 day'::interval) d(day)
  WHERE COALESCE(v_snapshot ->> (d.day::date)::text, '') IS DISTINCT FROM 'leave';

  UPDATE public.employees
  SET leave_balance = COALESCE(leave_balance, 0) + COALESCE(v_restore_days, 0),
      updated_at = now()
  WHERE id = v_employee_id;

  UPDATE public.leave_applications
  SET status = 'pending',
      attendance_snapshot = NULL,
      updated_at = now()
  WHERE id = p_application_id
    AND status = 'approved';

  PERFORM set_config('khani.skip_leave_balance_sync', '1', true);

  v_cur := v_from_date;
  WHILE v_cur <= v_to_date LOOP
    v_prev := v_snapshot ->> v_cur::text;

    IF v_prev IS NULL OR length(trim(v_prev)) = 0 THEN
      DELETE FROM public.attendance
      WHERE employee_id = v_employee_id
        AND att_date = v_cur
        AND status = 'leave';
      IF FOUND THEN
        v_deleted := v_deleted + 1;
      END IF;
    ELSE
      UPDATE public.attendance
      SET status = v_prev
      WHERE employee_id = v_employee_id
        AND att_date = v_cur;
      IF FOUND THEN
        v_restored := v_restored + 1;
      END IF;
    END IF;

    v_cur := v_cur + 1;
  END LOOP;

  PERFORM public.write_audit_event(
    'unapprove_leave_rpc',
    'leave_applications',
    p_application_id::text,
    v_org_id,
    jsonb_build_object(
      'employee_id', v_employee_id,
      'days_range', v_days,
      'days_restored_balance', COALESCE(v_restore_days, 0),
      'attendance_restored', v_restored,
      'attendance_cleared', v_deleted,
      'from_date', v_from_date,
      'to_date', v_to_date
    )
  );
END;
$$;

-- Keep single-arg overload
CREATE OR REPLACE FUNCTION public.approve_leave_application(p_application_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.approve_leave_application(p_application_id, false);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_leave_application(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_leave_application(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_leave_application(uuid, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.approve_leave_application(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_leave_application(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_leave_application(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.unapprove_leave_application(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unapprove_leave_application(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unapprove_leave_application(uuid) TO service_role;

-- ============================================================
-- P1.3: finalize requires lines
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
  v_line_count integer;
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

  SELECT count(*)::integer INTO v_line_count
  FROM public.payroll_lines
  WHERE payroll_run_id = p_run_id;

  IF COALESCE(v_line_count, 0) < 1 THEN
    RAISE EXCEPTION 'Cannot finalize payroll with no lines. Generate payroll first.'
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

REVOKE ALL ON FUNCTION public.finalize_payroll_run(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_payroll_run(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_payroll_run(uuid) TO service_role;

-- ============================================================
-- P1.4: Stakeholder share sum ≤ 100% (reaffirm + clearer error)
-- ============================================================

CREATE OR REPLACE FUNCTION public.check_stakeholder_share_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sum numeric;
BEGIN
  IF NEW.share_percent IS NULL OR NEW.share_percent < 0 OR NEW.share_percent > 100 THEN
    RAISE EXCEPTION 'Share percent must be between 0 and 100'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(SUM(share_percent), 0) INTO v_sum
  FROM public.stakeholder_site_access
  WHERE site_id = NEW.site_id
    AND id IS DISTINCT FROM NEW.id;

  IF (v_sum + NEW.share_percent) > 100.0 + 1e-9 THEN
    RAISE EXCEPTION
      'Total stakeholder share for this site cannot exceed 100%% (others: %, this: %)',
      v_sum,
      NEW.share_percent
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stakeholder_share_limit ON public.stakeholder_site_access;
CREATE TRIGGER trg_stakeholder_share_limit
  BEFORE INSERT OR UPDATE OF share_percent, site_id ON public.stakeholder_site_access
  FOR EACH ROW
  EXECUTE FUNCTION public.check_stakeholder_share_limit();

-- ============================================================
-- P1.5: Settled trips require positive settlement_amount
-- ============================================================

CREATE OR REPLACE FUNCTION public.enforce_trip_settlement_amount()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(NEW.settled, false) = true
     OR COALESCE(NEW.payment_status, '') = 'settled' THEN
    IF NEW.settlement_amount IS NULL OR NEW.settlement_amount <= 0 THEN
      RAISE EXCEPTION
        'Settled trips require settlement_amount greater than zero'
        USING ERRCODE = 'check_violation';
    END IF;
    -- Keep flags consistent
    NEW.settled := true;
    NEW.payment_status := 'settled';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_trip_settlement_amount ON public.trips;
CREATE TRIGGER trg_trip_settlement_amount
  BEFORE INSERT OR UPDATE OF settled, payment_status, settlement_amount ON public.trips
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_trip_settlement_amount();

COMMENT ON FUNCTION public.enforce_trip_settlement_amount() IS
  'Phase 1: settled / payment_status=settled requires settlement_amount > 0.';
