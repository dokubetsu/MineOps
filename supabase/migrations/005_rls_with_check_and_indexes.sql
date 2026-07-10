-- Migration 005: RLS WITH CHECK, Enums constraints, audit trails, and performance indexes

-- 1. Patch view stakeholder_daily_summary to exclude soft-deleted items (Fix #4)
CREATE OR REPLACE VIEW public.stakeholder_daily_summary
WITH (security_invoker = true) AS
SELECT cb.site_id, cb.book_date,
  COALESCE(SUM(CASE WHEN ce.entry_type='in'  AND ce.active IS NOT FALSE THEN ce.amount ELSE 0 END),0) AS total_in,
  COALESCE(SUM(CASE WHEN ce.entry_type='out' AND ce.active IS NOT FALSE THEN ce.amount ELSE 0 END),0) AS total_out,
  cb.opening_balance, cb.closing_balance,
  (SELECT count(*) FROM trips t WHERE t.site_id=cb.site_id AND t.trip_date=cb.book_date AND t.active IS NOT FALSE) AS trip_count
FROM cash_books cb LEFT JOIN cash_entries ce ON ce.cash_book_id=cb.id
GROUP BY cb.id, cb.site_id, cb.book_date, cb.opening_balance, cb.closing_balance;

-- 2. Add UNIQUE constraint to payroll_runs(site_id, period_month) (Fix #3)
ALTER TABLE public.payroll_runs ADD CONSTRAINT uq_payroll_runs_site_month UNIQUE (site_id, period_month);

-- 3. Add CHECK constraints for status / type / role columns (Fix #19)
ALTER TABLE public.attendance ADD CONSTRAINT chk_attendance_status CHECK (status IN ('present','absent','half-day','leave'));
ALTER TABLE public.leave_applications ADD CONSTRAINT chk_leave_status CHECK (status IN ('pending','approved','rejected'));
ALTER TABLE public.payroll_runs ADD CONSTRAINT chk_payroll_status CHECK (status IN ('draft','finalized'));
ALTER TABLE public.cash_books ADD CONSTRAINT chk_cashbook_status CHECK (status IN ('draft','locked'));
ALTER TABLE public.user_roles ADD CONSTRAINT chk_user_role CHECK (role IN ('admin','site_manager','stakeholder'));
ALTER TABLE public.vehicles ADD CONSTRAINT chk_vehicle_type CHECK (vehicle_type IN ('12WH','10WH','6WH','Other'));
ALTER TABLE public.vehicles ADD CONSTRAINT chk_ownership CHECK (ownership IN ('rented','owned'));
ALTER TABLE public.employees ADD CONSTRAINT chk_wage_type CHECK (wage_type IN ('daily','monthly'));

-- 4. Set search_path and prefix on helper functions to protect SECURITY DEFINER queries (Fix #10)
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS text AS $$
  SELECT role FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.get_user_site_ids()
RETURNS uuid[] AS $$
  SELECT ARRAY(SELECT site_id FROM public.user_roles WHERE user_id = auth.uid() AND site_id IS NOT NULL);
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp;

-- 5. Audit Triggers: Automatically set created_by / approved_by / marked_by (Fix #15)
CREATE OR REPLACE FUNCTION public.set_created_by()
RETURNS trigger AS $$
BEGIN
  NEW.created_by := auth.uid();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_trips_set_created_by ON public.trips;
CREATE TRIGGER trg_trips_set_created_by
BEFORE INSERT ON public.trips
FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

DROP TRIGGER IF EXISTS trg_cash_entries_set_created_by ON public.cash_entries;
CREATE TRIGGER trg_cash_entries_set_created_by
BEFORE INSERT ON public.cash_entries
FOR EACH ROW EXECUTE FUNCTION public.set_created_by();

CREATE OR REPLACE FUNCTION public.set_marked_by()
RETURNS trigger AS $$
BEGIN
  NEW.marked_by := auth.uid();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_attendance_set_marked_by ON public.attendance;
CREATE TRIGGER trg_attendance_set_marked_by
BEFORE INSERT ON public.attendance
FOR EACH ROW EXECUTE FUNCTION public.set_marked_by();

CREATE OR REPLACE FUNCTION public.set_approved_by()
RETURNS trigger AS $$
BEGIN
  IF NEW.status IN ('approved', 'rejected') AND OLD.status = 'pending' THEN
    NEW.approved_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_leave_set_approved_by ON public.leave_applications;
CREATE TRIGGER trg_leave_set_approved_by
BEFORE UPDATE ON public.leave_applications
FOR EACH ROW EXECUTE FUNCTION public.set_approved_by();

-- 6. Lock enforcement on finalized payroll run adjustments (Fix #14)
CREATE OR REPLACE FUNCTION public.check_payroll_run_not_finalized()
RETURNS trigger AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM public.payroll_runs WHERE id = NEW.payroll_run_id;

  IF v_status = 'finalized' THEN
    RAISE EXCEPTION 'Cannot update or adjust payroll lines for a finalized payroll run' USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_check_payroll_run_lock ON public.payroll_lines;
CREATE TRIGGER trg_check_payroll_run_lock
BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_lines
FOR EACH ROW EXECUTE FUNCTION public.check_payroll_run_not_finalized();

-- 7. Trigger to prevent deleting the last Admin role to avoid lockout (Fix #11)
CREATE OR REPLACE FUNCTION public.check_last_admin_deletion()
RETURNS trigger AS $$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.user_roles
  WHERE role = 'admin' AND id <> OLD.id;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'Cannot remove user roles. At least one admin must exist in the system to prevent lockout.' USING ERRCODE = 'check_violation';
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_user_roles_last_admin ON public.user_roles;
CREATE TRIGGER trg_user_roles_last_admin
BEFORE DELETE OR UPDATE ON public.user_roles
FOR EACH ROW
WHEN (OLD.role = 'admin')
EXECUTE FUNCTION public.check_last_admin_deletion();

-- 8. Enforce stakeholder share percentages sum to <=100% per site (Fix #20)
CREATE OR REPLACE FUNCTION public.check_stakeholder_share_limit()
RETURNS trigger AS $$
DECLARE
  v_sum numeric;
BEGIN
  SELECT COALESCE(SUM(share_percent), 0) INTO v_sum
  FROM public.stakeholder_site_access
  WHERE site_id = NEW.site_id AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

  IF (v_sum + NEW.share_percent) > 100.0 THEN
    RAISE EXCEPTION 'Total stakeholder share percentage for this site cannot exceed 100%% (current sum: %%, trying to add: %%)', v_sum, NEW.share_percent USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_stakeholder_share_limit ON public.stakeholder_site_access;
CREATE TRIGGER trg_stakeholder_share_limit
BEFORE INSERT OR UPDATE ON public.stakeholder_site_access
FOR EACH ROW EXECUTE FUNCTION public.check_stakeholder_share_limit();

-- 9. Add Secondary Performance Indexes (Fix #18)
CREATE INDEX IF NOT EXISTS idx_trips_site_date ON public.trips (site_id, trip_date) WHERE active IS NOT FALSE;
CREATE INDEX IF NOT EXISTS idx_cash_entries_book ON public.cash_entries (cash_book_id) WHERE active IS NOT FALSE;
CREATE INDEX IF NOT EXISTS idx_attendance_emp_date ON public.attendance (employee_id, att_date);
CREATE INDEX IF NOT EXISTS idx_payroll_lines_run ON public.payroll_lines (payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_user ON public.user_roles (user_id);
CREATE INDEX IF NOT EXISTS idx_stakeholder_access_user ON public.stakeholder_site_access (stakeholder_user_id);
CREATE INDEX IF NOT EXISTS idx_employees_site ON public.employees (site_id) WHERE active IS NOT FALSE;

-- 10. Add first day of month CHECK constraint on payroll period_month (Fix #24)
ALTER TABLE public.payroll_runs ADD CONSTRAINT chk_payroll_period_first_day CHECK (date_trunc('month', period_month) = period_month);

-- 11. Add updated_at columns and change tracking triggers (Fix #23)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Add columns & triggers
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();
DROP TRIGGER IF EXISTS trg_sites_updated_at ON public.sites;
CREATE TRIGGER trg_sites_updated_at BEFORE UPDATE ON public.sites FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.transport_contractors ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();
DROP TRIGGER IF EXISTS trg_transport_contractors_updated_at ON public.transport_contractors;
CREATE TRIGGER trg_transport_contractors_updated_at BEFORE UPDATE ON public.transport_contractors FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();
DROP TRIGGER IF EXISTS trg_vehicles_updated_at ON public.vehicles;
CREATE TRIGGER trg_vehicles_updated_at BEFORE UPDATE ON public.vehicles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();
DROP TRIGGER IF EXISTS trg_drivers_updated_at ON public.drivers;
CREATE TRIGGER trg_drivers_updated_at BEFORE UPDATE ON public.drivers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();
DROP TRIGGER IF EXISTS trg_employees_updated_at ON public.employees;
CREATE TRIGGER trg_employees_updated_at BEFORE UPDATE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();
DROP TRIGGER IF EXISTS trg_trips_updated_at ON public.trips;
CREATE TRIGGER trg_trips_updated_at BEFORE UPDATE ON public.trips FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.cash_books ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();
DROP TRIGGER IF EXISTS trg_cash_books_updated_at ON public.cash_books;
CREATE TRIGGER trg_cash_books_updated_at BEFORE UPDATE ON public.cash_books FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.cash_entries ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();
DROP TRIGGER IF EXISTS trg_cash_entries_updated_at ON public.cash_entries;
CREATE TRIGGER trg_cash_entries_updated_at BEFORE UPDATE ON public.cash_entries FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();
DROP TRIGGER IF EXISTS trg_attendance_updated_at ON public.attendance;
CREATE TRIGGER trg_attendance_updated_at BEFORE UPDATE ON public.attendance FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.leave_applications ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();
DROP TRIGGER IF EXISTS trg_leave_applications_updated_at ON public.leave_applications;
CREATE TRIGGER trg_leave_applications_updated_at BEFORE UPDATE ON public.leave_applications FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.payroll_runs ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();
DROP TRIGGER IF EXISTS trg_payroll_runs_updated_at ON public.payroll_runs;
CREATE TRIGGER trg_payroll_runs_updated_at BEFORE UPDATE ON public.payroll_runs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.payroll_lines ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();
DROP TRIGGER IF EXISTS trg_payroll_lines_updated_at ON public.payroll_lines;
CREATE TRIGGER trg_payroll_lines_updated_at BEFORE UPDATE ON public.payroll_lines FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();
DROP TRIGGER IF EXISTS trg_user_roles_updated_at ON public.user_roles;
CREATE TRIGGER trg_user_roles_updated_at BEFORE UPDATE ON public.user_roles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.stakeholder_site_access ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();
DROP TRIGGER IF EXISTS trg_stakeholder_site_access_updated_at ON public.stakeholder_site_access;
CREATE TRIGGER trg_stakeholder_site_access_updated_at BEFORE UPDATE ON public.stakeholder_site_access FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
