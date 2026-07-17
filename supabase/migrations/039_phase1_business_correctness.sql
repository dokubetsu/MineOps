-- Migration 039: Phase 1 business correctness
--
-- 1) payroll_lines.days_half_day + unique (run, employee)
-- 2) approve_leave_application: block when payroll finalized for overlapping months
-- 3) is_user_org_active() for inactive-org login/proxy gates
-- 4) Tighten site_employee / employee write scope on trips + cash_entries
--
-- Depends on: 034–038 (finalize/leave, security hotfix)

-- ============================================================
-- Part A: payroll_lines half-day storage + uniqueness
-- ============================================================

ALTER TABLE public.payroll_lines
  ADD COLUMN IF NOT EXISTS days_half_day integer NOT NULL DEFAULT 0;

ALTER TABLE public.payroll_lines
  DROP CONSTRAINT IF EXISTS chk_payroll_lines_days_half_day_nonneg;

ALTER TABLE public.payroll_lines
  ADD CONSTRAINT chk_payroll_lines_days_half_day_nonneg
  CHECK (days_half_day >= 0);

-- Deduplicate before unique index (keep earliest id per run+employee)
WITH dups AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY payroll_run_id, employee_id
           ORDER BY id
         ) AS rn
  FROM public.payroll_lines
)
DELETE FROM public.payroll_lines pl
USING dups
WHERE pl.id = dups.id
  AND dups.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_lines_run_employee
  ON public.payroll_lines (payroll_run_id, employee_id);

COMMENT ON COLUMN public.payroll_lines.days_half_day IS
  'Count of half-day attendance marks used when computing this line';

-- ============================================================
-- Part B: approve_leave — finalized payroll guard (keeps 038 authz)
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

  -- Block approval that would rewrite attendance for a finalized payroll month
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
END;
$$;

REVOKE ALL ON FUNCTION public.approve_leave_application(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_leave_application(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.approve_leave_application(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_leave_application(uuid) TO service_role;

-- ============================================================
-- Part C: inactive organization helper
-- ============================================================

CREATE OR REPLACE FUNCTION public.is_user_org_active()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN public.get_user_organization_id() IS NULL THEN true
    ELSE EXISTS (
      SELECT 1
      FROM public.organizations o
      WHERE o.id = public.get_user_organization_id()
        AND o.active IS TRUE
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.is_user_org_active() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_user_org_active() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_user_org_active() TO service_role;
GRANT EXECUTE ON FUNCTION public.is_user_org_active() TO anon;

COMMENT ON FUNCTION public.is_user_org_active() IS
  'True if caller has no tenant org, or their organization.active = true. Used to block deactivated tenants.';

-- ============================================================
-- Part D: site_employee / employee — narrower write privileges
-- ============================================================
-- Employees may insert trips/expenses on their site and update only rows they created.
-- They may soft-deactivate only their own cash entries (active=false), not rewrite others.

DROP POLICY IF EXISTS trips_employee_update ON public.trips;
CREATE POLICY trips_employee_update ON public.trips FOR UPDATE TO authenticated
  USING (
    (get_user_role() IN ('employee', 'site_employee'))
    AND site_id = ANY (get_user_site_ids())
    AND created_by = auth.uid()
  )
  WITH CHECK (
    (get_user_role() IN ('employee', 'site_employee'))
    AND site_id = ANY (get_user_site_ids())
    AND created_by = auth.uid()
  );

-- Replace broad ALL policy with SELECT + INSERT + own UPDATE
DROP POLICY IF EXISTS cashentries_employee ON public.cash_entries;

CREATE POLICY cashentries_employee_select ON public.cash_entries FOR SELECT TO authenticated
  USING (
    (get_user_role() IN ('employee', 'site_employee'))
    AND cash_book_id IN (
      SELECT id FROM public.cash_books WHERE site_id = ANY (get_user_site_ids())
    )
  );

CREATE POLICY cashentries_employee_insert ON public.cash_entries FOR INSERT TO authenticated
  WITH CHECK (
    (get_user_role() IN ('employee', 'site_employee'))
    AND cash_book_id IN (
      SELECT id FROM public.cash_books WHERE site_id = ANY (get_user_site_ids())
    )
  );

CREATE POLICY cashentries_employee_update ON public.cash_entries FOR UPDATE TO authenticated
  USING (
    (get_user_role() IN ('employee', 'site_employee'))
    AND created_by = auth.uid()
    AND cash_book_id IN (
      SELECT id FROM public.cash_books WHERE site_id = ANY (get_user_site_ids())
    )
  )
  WITH CHECK (
    (get_user_role() IN ('employee', 'site_employee'))
    AND created_by = auth.uid()
    AND cash_book_id IN (
      SELECT id FROM public.cash_books WHERE site_id = ANY (get_user_site_ids())
    )
  );

-- No DELETE for employees (use soft-delete via UPDATE active = false on own rows)
