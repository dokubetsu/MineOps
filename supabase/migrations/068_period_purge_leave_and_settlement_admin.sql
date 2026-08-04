-- ============================================================
-- 068 — Period purge leave restore + settlement_admin_only DB
-- 1) unapprove_leave_application: allow service_role (period-ops)
-- 2) When organizations.settlement_admin_only, only admin/service
--    may flip a trip to settled
-- ============================================================

-- ------------------------------------------------------------
-- 1) Leave unapprove — service_role bypass for admin period purge
-- ------------------------------------------------------------
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
  v_is_service boolean;
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

  v_is_service := coalesce(auth.role(), '') = 'service_role';

  IF NOT v_is_service THEN
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
      'to_date', v_to_date,
      'via_service_role', v_is_service
    )
  );
END;
$$;

COMMENT ON FUNCTION public.unapprove_leave_application(uuid) IS
  'Reverse leave approval and restore net-charged leave_balance. service_role allowed for period-ops purge.';

REVOKE ALL ON FUNCTION public.unapprove_leave_application(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unapprove_leave_application(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unapprove_leave_application(uuid) TO service_role;

-- ------------------------------------------------------------
-- 2) settlement_admin_only — DB gate on settling trips
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_trip_settlement_amount()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_only boolean := false;
  v_role text;
  v_becoming_settled boolean;
BEGIN
  IF COALESCE(NEW.settled, false) = true
     OR COALESCE(NEW.payment_status, '') = 'settled' THEN
    IF NEW.settlement_amount IS NULL OR NEW.settlement_amount <= 0 THEN
      RAISE EXCEPTION
        'Settled trips require settlement_amount greater than zero'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.settled := true;
    NEW.payment_status := 'settled';
  END IF;

  -- Detect transition into settled (INSERT already settled, or UPDATE flip)
  v_becoming_settled :=
    (COALESCE(NEW.settled, false) = true OR COALESCE(NEW.payment_status, '') = 'settled')
    AND (
      TG_OP = 'INSERT'
      OR COALESCE(OLD.settled, false) = false
      OR COALESCE(OLD.payment_status, '') IS DISTINCT FROM 'settled'
    );

  IF v_becoming_settled
     AND coalesce(auth.role(), '') IS DISTINCT FROM 'service_role'
     AND NEW.organization_id IS NOT NULL
  THEN
    SELECT COALESCE(o.settlement_admin_only, false)
    INTO v_admin_only
    FROM public.organizations o
    WHERE o.id = NEW.organization_id;

    IF COALESCE(v_admin_only, false) THEN
      v_role := public.get_user_role();
      IF v_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION
          'Only admins can settle trips for this organization'
          USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_trip_settlement_amount ON public.trips;
CREATE TRIGGER trg_trip_settlement_amount
  BEFORE INSERT OR UPDATE OF settled, payment_status, settlement_amount,
    settlement_account, settlement_method, settlement_ref,
    payment_method, payment_reference, settled_at, settled_by
  ON public.trips
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_trip_settlement_amount();

COMMENT ON FUNCTION public.enforce_trip_settlement_amount() IS
  'Settled trips require settlement_amount > 0; when org.settlement_admin_only, only admin/service_role may settle.';
