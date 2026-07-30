-- Migration 046: Phase F — residual ship-review hardening
--
-- F1  Feature write gates for master_data / manage_employees / users + DELETE
-- F2  Leave approve snapshots prior attendance; unapprove restores it
-- F3  Atomic claim_first_platform_owner (bootstrap race)
-- F4  Muster leave DELETE restores leave_balance
-- F5  Trip worth recompute from rate × capacity when capacity changes
-- F6  audit_logs.actor_user_id nullable for pure service_role events

-- ============================================================
-- F6: allow system/service audit rows without a user actor
-- ============================================================
ALTER TABLE public.audit_logs
  ALTER COLUMN actor_user_id DROP NOT NULL;

-- ============================================================
-- F1: Expand feature enforcement (INSERT/UPDATE/DELETE)
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
  v_site uuid;
  v_employee uuid;
  v_book uuid;
  v_run uuid;
BEGIN
  IF coalesce(auth.role(), '') = 'service_role' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF public.is_platform_owner() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_key := CASE TG_TABLE_NAME
    WHEN 'payroll_runs' THEN 'payroll'
    WHEN 'payroll_lines' THEN 'payroll'
    WHEN 'trips' THEN 'trips'
    WHEN 'trip_photos' THEN 'trips'
    WHEN 'cash_books' THEN 'cash_book'
    WHEN 'cash_entries' THEN 'cash_book'
    WHEN 'attendance' THEN 'attendance'
    WHEN 'leave_applications' THEN 'leave'
    WHEN 'employees' THEN 'manage_employees'
    WHEN 'sites' THEN 'master_data'
    WHEN 'vehicles' THEN 'master_data'
    WHEN 'drivers' THEN 'master_data'
    WHEN 'transport_contractors' THEN 'master_data'
    WHEN 'customers' THEN 'master_data'
    WHEN 'negotiated_rates' THEN 'master_data'
    WHEN 'user_roles' THEN 'users'
    WHEN 'stakeholder_site_access' THEN 'users'
    ELSE NULL
  END;

  IF v_key IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- trip_photos has no organization_id column — resolve via parent trip only
  IF TG_TABLE_NAME = 'trip_photos' THEN
    SELECT t.organization_id INTO v_org
    FROM public.trips t
    WHERE t.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.trip_id ELSE NEW.trip_id END;
  ELSIF TG_OP = 'DELETE' THEN
    v_org := OLD.organization_id;
    v_site := CASE
      WHEN TG_TABLE_NAME IN ('payroll_runs', 'trips', 'cash_books', 'sites') THEN OLD.site_id
      WHEN TG_TABLE_NAME = 'stakeholder_site_access' THEN OLD.site_id
      ELSE NULL
    END;
    v_employee := CASE
      WHEN TG_TABLE_NAME IN ('attendance', 'leave_applications', 'payroll_lines') THEN OLD.employee_id
      ELSE NULL
    END;
    v_book := CASE WHEN TG_TABLE_NAME = 'cash_entries' THEN OLD.cash_book_id ELSE NULL END;
    v_run := CASE WHEN TG_TABLE_NAME = 'payroll_lines' THEN OLD.payroll_run_id ELSE NULL END;
  ELSE
    v_org := NEW.organization_id;
    v_site := CASE
      WHEN TG_TABLE_NAME IN ('payroll_runs', 'trips', 'cash_books', 'sites') THEN NEW.site_id
      WHEN TG_TABLE_NAME = 'stakeholder_site_access' THEN NEW.site_id
      ELSE NULL
    END;
    v_employee := CASE
      WHEN TG_TABLE_NAME IN ('attendance', 'leave_applications', 'payroll_lines') THEN NEW.employee_id
      ELSE NULL
    END;
    v_book := CASE WHEN TG_TABLE_NAME = 'cash_entries' THEN NEW.cash_book_id ELSE NULL END;
    v_run := CASE WHEN TG_TABLE_NAME = 'payroll_lines' THEN NEW.payroll_run_id ELSE NULL END;
  END IF;

  IF v_org IS NULL AND TG_TABLE_NAME <> 'trip_photos' THEN
    IF v_site IS NOT NULL THEN
      SELECT organization_id INTO v_org FROM public.sites WHERE id = v_site;
    ELSIF v_employee IS NOT NULL THEN
      SELECT organization_id INTO v_org FROM public.employees WHERE id = v_employee;
    ELSIF v_book IS NOT NULL THEN
      SELECT organization_id INTO v_org FROM public.cash_books WHERE id = v_book;
    ELSIF v_run IS NOT NULL THEN
      SELECT organization_id INTO v_org FROM public.payroll_runs WHERE id = v_run;
    END IF;
  END IF;

  -- Fallback: caller's org (user_roles insert often stamps org already)
  IF v_org IS NULL THEN
    v_org := public.get_user_organization_id();
  END IF;

  IF v_org IS NOT NULL AND NOT public.org_has_feature(v_org, v_key) THEN
    RAISE EXCEPTION
      'Feature "%" is not enabled for this organization',
      v_key
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Re-bind existing + new tables for INSERT/UPDATE/DELETE
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'payroll_runs', 'payroll_lines', 'trips', 'cash_books', 'cash_entries',
    'attendance', 'leave_applications',
    'employees', 'sites', 'vehicles', 'drivers', 'transport_contractors',
    'customers', 'negotiated_rates', 'user_roles', 'stakeholder_site_access'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_feature_%I ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER trg_feature_%I BEFORE INSERT OR UPDATE OR DELETE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.enforce_module_feature_write()',
      t, t
    );
  END LOOP;
END $$;

-- trip_photos if table exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'trip_photos'
  ) THEN
    DROP TRIGGER IF EXISTS trg_feature_trip_photos ON public.trip_photos;
    CREATE TRIGGER trg_feature_trip_photos
      BEFORE INSERT OR UPDATE OR DELETE ON public.trip_photos
      FOR EACH ROW EXECUTE FUNCTION public.enforce_module_feature_write();
  END IF;
END $$;

-- ============================================================
-- F2: Leave attendance snapshot + restore on unapprove
-- ============================================================

ALTER TABLE public.leave_applications
  ADD COLUMN IF NOT EXISTS attendance_snapshot jsonb;

COMMENT ON COLUMN public.leave_applications.attendance_snapshot IS
  'Map of att_date → prior attendance status captured at approve; used by unapprove to restore.';

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

  -- Snapshot prior statuses for every existing row in range (including leave)
  SELECT COALESCE(
    jsonb_object_agg(a.att_date::text, to_jsonb(a.status)),
    '{}'::jsonb
  )
  INTO v_snapshot
  FROM public.attendance a
  WHERE a.employee_id = v_employee_id
    AND a.att_date BETWEEN v_from_date AND v_to_date;

  UPDATE public.employees
  SET leave_balance = COALESCE(leave_balance, 0) - v_days,
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

  UPDATE public.employees
  SET leave_balance = COALESCE(leave_balance, 0) + v_days,
      updated_at = now()
  WHERE id = v_employee_id;

  UPDATE public.leave_applications
  SET status = 'pending',
      attendance_snapshot = NULL,
      updated_at = now()
  WHERE id = p_application_id
    AND status = 'approved';

  -- Restore prior attendance from snapshot (skip balance trigger)
  PERFORM set_config('khani.skip_leave_balance_sync', '1', true);

  v_cur := v_from_date;
  WHILE v_cur <= v_to_date LOOP
    v_prev := v_snapshot ->> v_cur::text;

    IF v_prev IS NULL OR length(trim(v_prev)) = 0 THEN
      -- Was unmarked before approve → remove leave row
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
      'days_restored_balance', v_days,
      'attendance_restored', v_restored,
      'attendance_cleared', v_deleted,
      'from_date', v_from_date,
      'to_date', v_to_date
    )
  );
END;
$$;

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

-- ============================================================
-- F3: Atomic first platform owner claim
-- ============================================================

CREATE OR REPLACE FUNCTION public.claim_first_platform_owner(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id required' USING ERRCODE = 'check_violation';
  END IF;

  -- Serialize concurrent bootstrap attempts
  PERFORM pg_advisory_xact_lock(hashtext('khani_claim_first_platform_owner'));

  IF EXISTS (SELECT 1 FROM public.platform_roles LIMIT 1) THEN
    RAISE EXCEPTION 'A platform owner already exists'
      USING ERRCODE = 'unique_violation';
  END IF;

  INSERT INTO public.platform_roles (user_id, role)
  VALUES (p_user_id, 'platform_owner');
END;
$$;

REVOKE ALL ON FUNCTION public.claim_first_platform_owner(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_first_platform_owner(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.claim_first_platform_owner(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_first_platform_owner(uuid) TO service_role;

COMMENT ON FUNCTION public.claim_first_platform_owner(uuid) IS
  'Phase F: single-flight insert of first platform_owner (advisory lock). service_role only.';

-- ============================================================
-- F4: Attendance DELETE of leave restores balance
-- ============================================================

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
  v_emp uuid;
  v_date date;
BEGIN
  v_skip := current_setting('khani.skip_leave_balance_sync', true);
  IF v_skip = '1' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- DELETE of leave row
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'leave' THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.leave_applications la
        WHERE la.employee_id = OLD.employee_id
          AND la.status = 'approved'
          AND la.from_date <= OLD.att_date
          AND la.to_date >= OLD.att_date
      ) INTO v_covered;

      IF NOT v_covered THEN
        UPDATE public.employees
        SET leave_balance = COALESCE(leave_balance, 0) + 1,
            updated_at = now()
        WHERE id = OLD.employee_id;
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  v_old := CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END;
  v_new := NEW.status;
  v_emp := NEW.employee_id;
  v_date := NEW.att_date;

  IF v_new = 'leave' AND (v_old IS NULL OR v_old IS DISTINCT FROM 'leave') THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.leave_applications la
      WHERE la.employee_id = v_emp
        AND la.status = 'approved'
        AND la.from_date <= v_date
        AND la.to_date >= v_date
    ) INTO v_covered;

    IF NOT v_covered THEN
      SELECT leave_balance INTO v_bal
      FROM public.employees
      WHERE id = v_emp
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Employee not found for attendance leave mark';
      END IF;

      IF COALESCE(v_bal, 0) < 1 THEN
        RAISE EXCEPTION
          'Insufficient leave balance to mark Leave on % (have % day(s))',
          v_date,
          COALESCE(v_bal, 0)
          USING ERRCODE = 'check_violation';
      END IF;

      UPDATE public.employees
      SET leave_balance = COALESCE(leave_balance, 0) - 1,
          updated_at = now()
      WHERE id = v_emp;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND v_old = 'leave' AND v_new IS DISTINCT FROM 'leave' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.leave_applications la
      WHERE la.employee_id = v_emp
        AND la.status = 'approved'
        AND la.from_date <= v_date
        AND la.to_date >= v_date
    ) INTO v_covered;

    IF NOT v_covered THEN
      UPDATE public.employees
      SET leave_balance = COALESCE(leave_balance, 0) + 1,
          updated_at = now()
      WHERE id = v_emp;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_leave_balance ON public.attendance;
CREATE TRIGGER trg_attendance_leave_balance
  AFTER INSERT OR UPDATE OF status OR DELETE ON public.attendance
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_leave_balance_from_attendance();

-- ============================================================
-- F5: Trip worth from rate × capacity when capacity changes
-- ============================================================

-- Persist rate used for worth (client previously computed worth-only; rate was stripped)
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS rate_per_cubic numeric;

CREATE OR REPLACE FUNCTION public.normalize_trip_worth()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Recompute worth from rate × capacity when capacity/rate change and worth not manually overridden
  IF TG_OP = 'UPDATE'
     AND (
       NEW.cubic_capacity IS DISTINCT FROM OLD.cubic_capacity
       OR NEW.rate_per_cubic IS DISTINCT FROM OLD.rate_per_cubic
     )
     AND NEW.rate_per_cubic IS NOT NULL
     AND NEW.cubic_capacity IS NOT NULL
     AND (
       NEW.trip_worth IS NULL
       OR NEW.trip_worth IS NOT DISTINCT FROM OLD.trip_worth
     )
  THEN
    NEW.trip_worth := round(
      ((COALESCE(NEW.rate_per_cubic, 0) * COALESCE(NEW.cubic_capacity, 0)) + 1e-9)::numeric,
      2
    );
  ELSIF TG_OP = 'INSERT'
     AND NEW.trip_worth IS NULL
     AND NEW.rate_per_cubic IS NOT NULL
     AND NEW.cubic_capacity IS NOT NULL
  THEN
    NEW.trip_worth := round(
      ((COALESCE(NEW.rate_per_cubic, 0) * COALESCE(NEW.cubic_capacity, 0)) + 1e-9)::numeric,
      2
    );
  END IF;

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
  BEFORE INSERT OR UPDATE OF trip_worth, total_shipment_cost, cubic_capacity, rate_per_cubic ON public.trips
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_trip_worth();

-- Grants for leave overloads
REVOKE ALL ON FUNCTION public.approve_leave_application(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_leave_application(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_leave_application(uuid, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.approve_leave_application(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_leave_application(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_leave_application(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.unapprove_leave_application(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unapprove_leave_application(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unapprove_leave_application(uuid) TO service_role;
