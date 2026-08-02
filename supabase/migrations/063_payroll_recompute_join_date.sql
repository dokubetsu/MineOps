-- ============================================================
-- 063 — Medium hardening: payroll recompute on finalize + join_date
-- Recomputes computed_amount from attendance (same formula as TS)
-- before draft → finalized, preserving line adjustments.
-- ============================================================

CREATE OR REPLACE FUNCTION public.recompute_payroll_run_amounts(p_run_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_site_id uuid;
  v_period date;
  v_start date;
  v_end date;
  v_period_days integer;
  r record;
  v_present integer;
  v_half integer;
  v_leave integer;
  v_absent integer;
  v_eligible integer;
  v_join date;
  v_rate numeric;
  v_computed numeric;
  v_adj numeric;
BEGIN
  SELECT site_id, period_month::date
  INTO v_site_id, v_period
  FROM public.payroll_runs
  WHERE id = p_run_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payroll run not found' USING ERRCODE = 'no_data_found';
  END IF;

  v_start := date_trunc('month', v_period)::date;
  v_end := (date_trunc('month', v_period) + interval '1 month - 1 day')::date;
  v_period_days := (v_end - v_start) + 1;

  FOR r IN
    SELECT pl.id AS line_id,
           pl.employee_id,
           pl.adjustment,
           e.wage_type,
           e.wage_rate,
           e.join_date
    FROM public.payroll_lines pl
    JOIN public.employees e ON e.id = pl.employee_id
    WHERE pl.payroll_run_id = p_run_id
  LOOP
    v_join := r.join_date;
    IF v_join IS NOT NULL AND v_join > v_end THEN
      v_computed := 0;
      v_present := 0; v_half := 0; v_leave := 0; v_absent := 0;
      v_eligible := 0;
    ELSE
      v_eligible := (
        v_end - GREATEST(v_start, COALESCE(v_join, v_start))
      ) + 1;

      SELECT
        count(*) FILTER (WHERE a.status = 'present'),
        count(*) FILTER (WHERE a.status = 'half-day'),
        count(*) FILTER (WHERE a.status = 'leave'),
        count(*) FILTER (WHERE a.status = 'absent')
      INTO v_present, v_half, v_leave, v_absent
      FROM public.attendance a
      WHERE a.employee_id = r.employee_id
        AND a.att_date >= v_start
        AND a.att_date <= v_end
        AND (v_join IS NULL OR a.att_date >= v_join);

      v_rate := COALESCE(r.wage_rate, 0);

      IF COALESCE(r.wage_type, 'daily') = 'monthly' THEN
        IF v_eligible <= 0 THEN
          v_computed := 0;
        ELSE
          v_computed := round(
            (v_rate * GREATEST(0, v_eligible - v_absent - v_half * 0.5) / v_period_days)
              + 1e-9,
            2
          );
        END IF;
      ELSE
        v_computed := round(
          ((v_present + v_half * 0.5 + v_leave) * v_rate) + 1e-9,
          2
        );
      END IF;
    END IF;

    v_adj := COALESCE(r.adjustment, 0);

    UPDATE public.payroll_lines
    SET days_present = COALESCE(v_present, 0),
        days_half_day = COALESCE(v_half, 0),
        days_leave = COALESCE(v_leave, 0),
        days_absent = COALESCE(v_absent, 0),
        base_rate = COALESCE(r.wage_rate, base_rate),
        computed_amount = v_computed,
        final_amount = round((v_computed + v_adj + 1e-9)::numeric, 2)
    WHERE id = r.line_id;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_payroll_run_amounts(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recompute_payroll_run_amounts(uuid) TO service_role;
-- Authenticated callers reach this only via finalize_payroll_run (SECURITY DEFINER).

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

  -- Server-authoritative wage recompute (attendance + join_date) before lock
  PERFORM public.recompute_payroll_run_amounts(p_run_id);

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

COMMENT ON FUNCTION public.recompute_payroll_run_amounts(uuid) IS
  'Recompute payroll line amounts from attendance + join_date (daily/monthly policy). Called by finalize_payroll_run.';
