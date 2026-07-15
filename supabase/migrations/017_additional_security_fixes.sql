-- Migration 017: Additional security & validation fixes

-- ─── 1. Vehicles RLS Site Manager UPDATE policy ────────────────────────────
DROP POLICY IF EXISTS vehicles_manager_update ON public.vehicles;
CREATE POLICY vehicles_manager_update ON public.vehicles FOR UPDATE TO authenticated
  USING (get_user_role() = 'site_manager')
  WITH CHECK (get_user_role() = 'site_manager');

-- ─── 2. Drivers RLS Site Manager INSERT/UPDATE policies ────────────────────
DROP POLICY IF EXISTS drivers_manager_insert ON public.drivers;
CREATE POLICY drivers_manager_insert ON public.drivers FOR INSERT TO authenticated
  WITH CHECK (get_user_role() = 'site_manager');

DROP POLICY IF EXISTS drivers_manager_update ON public.drivers;
CREATE POLICY drivers_manager_update ON public.drivers FOR UPDATE TO authenticated
  USING (get_user_role() = 'site_manager')
  WITH CHECK (get_user_role() = 'site_manager');

-- ─── 3. User Roles Unique Constraints ──────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_roles_user_role_site_not_null 
  ON public.user_roles (user_id, role, site_id) 
  WHERE site_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_user_roles_user_role_site_null 
  ON public.user_roles (user_id, role) 
  WHERE site_id IS NULL;

-- ─── 4. Leave Overlap Validation trigger ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_leave_overlap()
RETURNS TRIGGER AS $$
DECLARE
  v_overlap_count integer;
BEGIN
  IF NEW.status IN ('pending', 'approved') THEN
    SELECT COUNT(*) INTO v_overlap_count
    FROM public.leave_applications
    WHERE employee_id = NEW.employee_id
      AND id <> NEW.id
      AND status IN ('pending', 'approved')
      AND NEW.from_date <= to_date
      AND NEW.to_date >= from_date;

    IF v_overlap_count > 0 THEN
      RAISE EXCEPTION 'Conflicting leave application exists for this employee in the same period' 
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_check_leave_overlap ON public.leave_applications;
CREATE TRIGGER trg_check_leave_overlap
BEFORE INSERT OR UPDATE OF from_date, to_date, status ON public.leave_applications
FOR EACH ROW
EXECUTE FUNCTION public.check_leave_overlap();

-- ─── 5. Transaction-locked Payroll Regenerator RPC ─────────────────────────
CREATE OR REPLACE FUNCTION public.regenerate_payroll_run(p_run_id uuid)
RETURNS void AS $$
DECLARE
  v_status text;
BEGIN
  -- Select status with lock (FOR UPDATE) to prevent concurrency race
  SELECT status INTO v_status
  FROM public.payroll_runs
  WHERE id = p_run_id
  FOR UPDATE;

  IF v_status = 'finalized' THEN
    RAISE EXCEPTION 'Payroll has already been finalized for this period.' USING ERRCODE = 'check_violation';
  END IF;

  -- Delete old lines
  DELETE FROM public.payroll_lines WHERE payroll_run_id = p_run_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
