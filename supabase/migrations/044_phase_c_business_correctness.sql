-- Migration 044: Phase C — business correctness
--
-- C2  Muster leave syncs leave_balance (with skip flag for approve_leave RPC)
-- C3  Normalize trip_worth on insert/update
-- C4  approve_leave: p_force to overwrite existing non-leave attendance; unapprove_leave_application
-- C5  provision_user_access leave_balance default 15

-- ============================================================
-- C2: Attendance leave ↔ leave_balance
-- ============================================================
-- When managers mark Leave on the muster without going through leave applications,
-- deduct 1 day of leave_balance (reject if insufficient).
-- Changing away from leave restores 1 day (unless approved leave covers that date).
-- approve_leave_application sets local config to skip this trigger (it already
-- deducts multi-day balance).

CREATE OR REPLACE FUNCTION public.sync_leave_balance_from_attendance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_skip text;
  v_old text;
  v_new text;
  v_bal numeric;
  v_covered boolean;
BEGIN
  -- Skip when leave approval RPC is writing attendance after bulk balance deduct
  v_skip := current_setting('khani.skip_leave_balance_sync', true);
  IF v_skip = '1' THEN
    RETURN NEW;
  END IF;

  v_old := CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END;
  v_new := NEW.status;

  -- Entering leave
  IF v_new = 'leave' AND (v_old IS NULL OR v_old IS DISTINCT FROM 'leave') THEN
    -- If an approved application already covers this day, balance was deducted there
    SELECT EXISTS (
      SELECT 1
      FROM public.leave_applications la
      WHERE la.employee_id = NEW.employee_id
        AND la.status = 'approved'
        AND la.from_date <= NEW.att_date
        AND la.to_date >= NEW.att_date
    ) INTO v_covered;

    IF NOT v_covered THEN
      SELECT leave_balance INTO v_bal
      FROM public.employees
      WHERE id = NEW.employee_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Employee not found for attendance leave mark';
      END IF;

      IF COALESCE(v_bal, 0) < 1 THEN
        RAISE EXCEPTION
          'Insufficient leave balance to mark Leave on % (have % day(s))',
          NEW.att_date,
          COALESCE(v_bal, 0)
          USING ERRCODE = 'check_violation';
      END IF;

      UPDATE public.employees
      SET leave_balance = COALESCE(leave_balance, 0) - 1,
          updated_at = now()
      WHERE id = NEW.employee_id;
    END IF;
  END IF;

  -- Leaving leave status
  IF TG_OP = 'UPDATE' AND v_old = 'leave' AND v_new IS DISTINCT FROM 'leave' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.leave_applications la
      WHERE la.employee_id = NEW.employee_id
        AND la.status = 'approved'
        AND la.from_date <= NEW.att_date
        AND la.to_date >= NEW.att_date
    ) INTO v_covered;

    -- Only restore if this leave day was muster-only (not covered by application)
    IF NOT v_covered THEN
      UPDATE public.employees
      SET leave_balance = COALESCE(leave_balance, 0) + 1,
          updated_at = now()
      WHERE id = NEW.employee_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_leave_balance ON public.attendance;
CREATE TRIGGER trg_attendance_leave_balance
  AFTER INSERT OR UPDATE OF status ON public.attendance
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_leave_balance_from_attendance();

-- ============================================================
-- C3: Normalize trip_worth
-- ============================================================

CREATE OR REPLACE FUNCTION public.normalize_trip_worth()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.trip_worth IS NOT NULL THEN
    NEW.trip_worth := round((NEW.trip_worth + 1e-9)::numeric, 2);
  END IF;
  IF NEW.total_shipment_cost IS NOT NULL THEN
    NEW.total_shipment_cost := round((NEW.total_shipment_cost + 1e-9)::numeric, 2);
  ELSIF NEW.trip_worth IS NOT NULL THEN
    NEW.total_shipment_cost := NEW.trip_worth;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_trip_worth ON public.trips;
CREATE TRIGGER trg_normalize_trip_worth
  BEFORE INSERT OR UPDATE OF trip_worth, total_shipment_cost, cubic_capacity ON public.trips
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_trip_worth();

-- ============================================================
-- C4: approve with force + unapprove
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
  v_balance numeric;
  v_site_id uuid;
  v_org_id uuid;
  v_role text;
  v_finalized_month date;
  v_conflict_count integer;
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

  -- Detect existing non-leave attendance that would be overwritten
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

  -- Skip per-day balance trigger (bulk deduct already done)
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
      'from_date', v_from_date,
      'to_date', v_to_date,
      'site_id', v_site_id,
      'force', COALESCE(p_force, false)
    )
  );
END;
$$;

-- Reverse approved leave: restore balance + clear leave attendance for range
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
  v_site_id uuid;
  v_org_id uuid;
  v_role text;
  v_finalized_month date;
BEGIN
  PERFORM public.require_caller_org_feature('leave');

  SELECT employee_id, from_date, to_date
  INTO v_employee_id, v_from_date, v_to_date
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

  UPDATE public.employees
  SET leave_balance = COALESCE(leave_balance, 0) + v_days,
      updated_at = now()
  WHERE id = v_employee_id;

  UPDATE public.leave_applications
  SET status = 'pending',
      updated_at = now()
  WHERE id = p_application_id
    AND status = 'approved';

  -- Clear leave marks written for this range (skip balance restore — bulk restore done)
  PERFORM set_config('khani.skip_leave_balance_sync', '1', true);

  DELETE FROM public.attendance
  WHERE employee_id = v_employee_id
    AND att_date BETWEEN v_from_date AND v_to_date
    AND status = 'leave';

  PERFORM public.write_audit_event(
    'unapprove_leave_rpc',
    'leave_applications',
    p_application_id::text,
    v_org_id,
    jsonb_build_object(
      'employee_id', v_employee_id,
      'days_restored', v_days,
      'from_date', v_from_date,
      'to_date', v_to_date
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_leave_application(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_leave_application(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_leave_application(uuid, boolean) TO service_role;

-- Keep single-arg overload for older clients (defaults p_force false)
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

REVOKE ALL ON FUNCTION public.approve_leave_application(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_leave_application(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_leave_application(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.unapprove_leave_application(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unapprove_leave_application(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unapprove_leave_application(uuid) TO service_role;

-- ============================================================
-- C5: provision leave_balance default 15
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
        15,  -- Phase C: align with manage-employees default
        p_organization_id
      );
    ELSE
      RAISE EXCEPTION 'Invalid employee_link_mode: %', p_employee_link_mode USING ERRCODE = 'check_violation';
    END IF;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.sync_leave_balance_from_attendance() IS
  'Phase C: muster Leave deducts/restores leave_balance; approve_leave sets khani.skip_leave_balance_sync';
