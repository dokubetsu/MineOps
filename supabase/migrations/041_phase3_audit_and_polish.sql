-- Migration 041: Phase 3 audit coverage + polish
--
-- 1) write_audit_event() helper for SECURITY DEFINER RPCs
-- 2) Expand audit_table_action: cash unlock, leave status, user_roles changes
-- 3) approve_leave_application writes an audit row after success
--
-- Depends on: 032 audit_logs, 039 leave approve, 040 cash unlock

-- ============================================================
-- Part A: Shared audit writer (safe no-op when no session/org)
-- ============================================================

CREATE OR REPLACE FUNCTION public.write_audit_event(
  p_action text,
  p_target_type text,
  p_target_id text,
  p_organization_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid;
  v_org uuid;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RETURN;
  END IF;

  v_org := COALESCE(p_organization_id, public.get_user_organization_id());
  IF v_org IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.audit_logs (
    organization_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    metadata
  ) VALUES (
    v_org,
    v_actor,
    p_action,
    p_target_type,
    p_target_id,
    COALESCE(p_metadata, '{}'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.write_audit_event(text, text, text, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.write_audit_event(text, text, text, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.write_audit_event(text, text, text, uuid, jsonb) TO service_role;

-- ============================================================
-- Part B: Broader table audit trigger
-- ============================================================

CREATE OR REPLACE FUNCTION public.audit_table_action()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id uuid;
  v_actor uuid;
  v_action text;
  v_target_type text;
  v_target_id text;
  v_metadata jsonb := '{}'::jsonb;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_org_id := public.get_user_organization_id();
  v_target_type := TG_TABLE_NAME;

  IF TG_OP = 'DELETE' THEN
    v_target_id := OLD.id::text;
    IF v_org_id IS NULL AND TG_TABLE_NAME = 'user_roles' THEN
      v_org_id := OLD.organization_id;
    END IF;
  ELSE
    v_target_id := NEW.id::text;
  END IF;

  IF TG_TABLE_NAME = 'trips' AND TG_OP = 'UPDATE' THEN
    IF OLD.payment_status IS DISTINCT FROM NEW.payment_status AND NEW.payment_status = 'settled' THEN
      v_action := 'settle_trip';
      v_metadata := jsonb_build_object(
        'payment_method', NEW.payment_method,
        'payment_reference', NEW.payment_reference,
        'trip_worth', NEW.trip_worth
      );
      v_org_id := COALESCE(v_org_id, NEW.organization_id);
    ELSE
      RETURN NEW;
    END IF;

  ELSIF TG_TABLE_NAME = 'cash_books' AND TG_OP = 'UPDATE' THEN
    IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'locked' THEN
      v_action := 'lock_cash_book';
      v_metadata := jsonb_build_object(
        'book_date', NEW.book_date,
        'closing_balance', NEW.closing_balance
      );
      v_org_id := COALESCE(v_org_id, NEW.organization_id);
    ELSIF OLD.status = 'locked' AND NEW.status IS DISTINCT FROM 'locked' THEN
      v_action := 'unlock_cash_book';
      v_metadata := jsonb_build_object(
        'book_date', NEW.book_date,
        'previous_status', OLD.status,
        'new_status', NEW.status
      );
      v_org_id := COALESCE(v_org_id, NEW.organization_id);
    ELSE
      RETURN NEW;
    END IF;

  ELSIF TG_TABLE_NAME = 'payroll_runs' AND TG_OP = 'UPDATE' THEN
    IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'finalized' THEN
      v_action := 'finalize_payroll';
      v_metadata := jsonb_build_object('period_month', NEW.period_month);
      v_org_id := COALESCE(v_org_id, NEW.organization_id);
    ELSE
      RETURN NEW;
    END IF;

  ELSIF TG_TABLE_NAME = 'leave_applications' AND TG_OP = 'UPDATE' THEN
    IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('approved', 'rejected') THEN
      v_action := CASE NEW.status
        WHEN 'approved' THEN 'approve_leave'
        ELSE 'reject_leave'
      END;
      v_metadata := jsonb_build_object(
        'employee_id', NEW.employee_id,
        'from_date', NEW.from_date,
        'to_date', NEW.to_date,
        'previous_status', OLD.status
      );
      v_org_id := COALESCE(v_org_id, NEW.organization_id);
      IF v_org_id IS NULL THEN
        SELECT organization_id INTO v_org_id
        FROM public.employees
        WHERE id = NEW.employee_id;
      END IF;
    ELSE
      RETURN NEW;
    END IF;

  ELSIF TG_TABLE_NAME = 'user_roles' THEN
    IF TG_OP = 'INSERT' THEN
      v_action := 'assign_role';
      v_org_id := COALESCE(v_org_id, NEW.organization_id);
      v_metadata := jsonb_build_object(
        'user_id', NEW.user_id,
        'role', NEW.role,
        'site_id', NEW.site_id
      );
    ELSIF TG_OP = 'UPDATE' THEN
      IF OLD.role IS DISTINCT FROM NEW.role
         OR OLD.site_id IS DISTINCT FROM NEW.site_id
         OR OLD.organization_id IS DISTINCT FROM NEW.organization_id THEN
        v_action := 'update_role';
        v_org_id := COALESCE(v_org_id, NEW.organization_id, OLD.organization_id);
        v_metadata := jsonb_build_object(
          'user_id', NEW.user_id,
          'old_role', OLD.role,
          'new_role', NEW.role,
          'old_site_id', OLD.site_id,
          'new_site_id', NEW.site_id
        );
      ELSE
        RETURN NEW;
      END IF;
    ELSIF TG_OP = 'DELETE' THEN
      v_action := 'revoke_role';
      v_org_id := COALESCE(v_org_id, OLD.organization_id);
      v_metadata := jsonb_build_object(
        'user_id', OLD.user_id,
        'role', OLD.role,
        'site_id', OLD.site_id
      );
    ELSE
      RETURN COALESCE(NEW, OLD);
    END IF;

  ELSE
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF v_org_id IS NULL OR v_action IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  INSERT INTO public.audit_logs (organization_id, actor_user_id, action, target_type, target_id, metadata)
  VALUES (v_org_id, v_actor, v_action, v_target_type, v_target_id, v_metadata);

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Re-attach expanded triggers
DROP TRIGGER IF EXISTS trg_audit_trips ON public.trips;
CREATE TRIGGER trg_audit_trips
AFTER UPDATE ON public.trips
FOR EACH ROW EXECUTE FUNCTION public.audit_table_action();

DROP TRIGGER IF EXISTS trg_audit_cash_books ON public.cash_books;
CREATE TRIGGER trg_audit_cash_books
AFTER UPDATE ON public.cash_books
FOR EACH ROW EXECUTE FUNCTION public.audit_table_action();

DROP TRIGGER IF EXISTS trg_audit_payroll_runs ON public.payroll_runs;
CREATE TRIGGER trg_audit_payroll_runs
AFTER UPDATE ON public.payroll_runs
FOR EACH ROW EXECUTE FUNCTION public.audit_table_action();

DROP TRIGGER IF EXISTS trg_audit_leave_applications ON public.leave_applications;
CREATE TRIGGER trg_audit_leave_applications
AFTER UPDATE ON public.leave_applications
FOR EACH ROW EXECUTE FUNCTION public.audit_table_action();

DROP TRIGGER IF EXISTS trg_audit_user_roles ON public.user_roles;
CREATE TRIGGER trg_audit_user_roles
AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.audit_table_action();

-- ============================================================
-- Part C: approve_leave also records audit via helper
-- (table trigger also fires on status update; helper is belt-and-suspenders
--  for RPC context with full leave metadata)
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
  v_finalized_month date;
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

  -- Explicit RPC audit with days deducted (table trigger also logs approve_leave)
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

REVOKE ALL ON FUNCTION public.approve_leave_application(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_leave_application(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.approve_leave_application(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_leave_application(uuid) TO service_role;

-- Index for admin audit browsing
CREATE INDEX IF NOT EXISTS idx_audit_logs_org_created
  ON public.audit_logs (organization_id, created_at DESC);
