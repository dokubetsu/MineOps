-- Migration 031: Denormalize organization_id onto child/transactional tables
-- This speeds up RLS policies by replacing expensive path-joins (O(subquery)) 
-- with index-backed organization_id comparisons (O(1)).

-- ============================================================
-- Step 1: Add organization_id column to all child tables
-- ============================================================

ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE RESTRICT;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE RESTRICT;
ALTER TABLE public.cash_books ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE RESTRICT;
ALTER TABLE public.cash_entries ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE RESTRICT;
ALTER TABLE public.attendance ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE RESTRICT;
ALTER TABLE public.leave_applications ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE RESTRICT;
ALTER TABLE public.payroll_runs ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE RESTRICT;
ALTER TABLE public.payroll_lines ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE RESTRICT;

-- ============================================================
-- Step 2: Backfill existing records
-- ============================================================

UPDATE public.employees e SET organization_id = s.organization_id FROM public.sites s WHERE e.site_id = s.id AND e.organization_id IS NULL;
UPDATE public.trips t SET organization_id = s.organization_id FROM public.sites s WHERE t.site_id = s.id AND t.organization_id IS NULL;
UPDATE public.cash_books cb SET organization_id = s.organization_id FROM public.sites s WHERE cb.site_id = s.id AND cb.organization_id IS NULL;
UPDATE public.cash_entries ce SET organization_id = cb.organization_id FROM public.cash_books cb WHERE ce.cash_book_id = cb.id AND ce.organization_id IS NULL;
UPDATE public.attendance a SET organization_id = e.organization_id FROM public.employees e WHERE a.employee_id = e.id AND a.organization_id IS NULL;
UPDATE public.leave_applications la SET organization_id = e.organization_id FROM public.employees e WHERE la.employee_id = e.id AND la.organization_id IS NULL;
UPDATE public.payroll_runs pr SET organization_id = s.organization_id FROM public.sites s WHERE pr.site_id = s.id AND pr.organization_id IS NULL;
UPDATE public.payroll_lines pl SET organization_id = pr.organization_id FROM public.payroll_runs pr WHERE pl.payroll_run_id = pr.id AND pl.organization_id IS NULL;

-- Enforce NOT NULL constraints
ALTER TABLE public.employees ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.trips ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.cash_books ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.cash_entries ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.attendance ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.leave_applications ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.payroll_runs ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.payroll_lines ALTER COLUMN organization_id SET NOT NULL;

-- ============================================================
-- Step 3: Create Auto-Stamping Triggers
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_child_organization_id()
RETURNS trigger AS $$
DECLARE
  v_org_id uuid;
BEGIN
  IF NEW.organization_id IS NULL THEN
    IF TG_TABLE_NAME = 'employees' THEN
      SELECT organization_id INTO v_org_id FROM public.sites WHERE id = NEW.site_id;
    ELSIF TG_TABLE_NAME = 'trips' THEN
      SELECT organization_id INTO v_org_id FROM public.sites WHERE id = NEW.site_id;
    ELSIF TG_TABLE_NAME = 'cash_books' THEN
      SELECT organization_id INTO v_org_id FROM public.sites WHERE id = NEW.site_id;
    ELSIF TG_TABLE_NAME = 'cash_entries' THEN
      SELECT organization_id INTO v_org_id FROM public.cash_books WHERE id = NEW.cash_book_id;
    ELSIF TG_TABLE_NAME = 'attendance' THEN
      SELECT organization_id INTO v_org_id FROM public.employees WHERE id = NEW.employee_id;
    ELSIF TG_TABLE_NAME = 'leave_applications' THEN
      SELECT organization_id INTO v_org_id FROM public.employees WHERE id = NEW.employee_id;
    ELSIF TG_TABLE_NAME = 'payroll_runs' THEN
      SELECT organization_id INTO v_org_id FROM public.sites WHERE id = NEW.site_id;
    ELSIF TG_TABLE_NAME = 'payroll_lines' THEN
      SELECT organization_id INTO v_org_id FROM public.payroll_runs WHERE id = NEW.payroll_run_id;
    END IF;
    NEW.organization_id := v_org_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Attach set_child_organization_id triggers
DROP TRIGGER IF EXISTS trg_employees_set_org ON public.employees;
CREATE TRIGGER trg_employees_set_org BEFORE INSERT ON public.employees
FOR EACH ROW EXECUTE FUNCTION public.set_child_organization_id();

DROP TRIGGER IF EXISTS trg_trips_set_org ON public.trips;
CREATE TRIGGER trg_trips_set_org BEFORE INSERT ON public.trips
FOR EACH ROW EXECUTE FUNCTION public.set_child_organization_id();

DROP TRIGGER IF EXISTS trg_cashbooks_set_org ON public.cash_books;
CREATE TRIGGER trg_cashbooks_set_org BEFORE INSERT ON public.cash_books
FOR EACH ROW EXECUTE FUNCTION public.set_child_organization_id();

DROP TRIGGER IF EXISTS trg_cashentries_set_org ON public.cash_entries;
CREATE TRIGGER trg_cashentries_set_org BEFORE INSERT ON public.cash_entries
FOR EACH ROW EXECUTE FUNCTION public.set_child_organization_id();

DROP TRIGGER IF EXISTS trg_attendance_set_org ON public.attendance;
CREATE TRIGGER trg_attendance_set_org BEFORE INSERT ON public.attendance
FOR EACH ROW EXECUTE FUNCTION public.set_child_organization_id();

DROP TRIGGER IF EXISTS trg_leave_set_org ON public.leave_applications;
CREATE TRIGGER trg_leave_set_org BEFORE INSERT ON public.leave_applications
FOR EACH ROW EXECUTE FUNCTION public.set_child_organization_id();

DROP TRIGGER IF EXISTS trg_payroll_runs_set_org ON public.payroll_runs;
CREATE TRIGGER trg_payroll_runs_set_org BEFORE INSERT ON public.payroll_runs
FOR EACH ROW EXECUTE FUNCTION public.set_child_organization_id();

DROP TRIGGER IF EXISTS trg_payroll_lines_set_org ON public.payroll_lines;
CREATE TRIGGER trg_payroll_lines_set_org BEFORE INSERT ON public.payroll_lines
FOR EACH ROW EXECUTE FUNCTION public.set_child_organization_id();

-- ============================================================
-- Step 4: Create Indexes on organization_id
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_employees_org ON public.employees (organization_id);
CREATE INDEX IF NOT EXISTS idx_trips_org ON public.trips (organization_id);
CREATE INDEX IF NOT EXISTS idx_cash_books_org ON public.cash_books (organization_id);
CREATE INDEX IF NOT EXISTS idx_cash_entries_org ON public.cash_entries (organization_id);
CREATE INDEX IF NOT EXISTS idx_attendance_org ON public.attendance (organization_id);
CREATE INDEX IF NOT EXISTS idx_leave_applications_org ON public.leave_applications (organization_id);
CREATE INDEX IF NOT EXISTS idx_payroll_runs_org ON public.payroll_runs (organization_id);
CREATE INDEX IF NOT EXISTS idx_payroll_lines_org ON public.payroll_lines (organization_id);

-- ============================================================
-- Step 5: Rewrite RLS Policies for O(1) direct organization checks
-- ============================================================

-- Employees
DROP POLICY IF EXISTS employees_admin ON public.employees;
CREATE POLICY employees_admin ON public.employees TO authenticated
  USING (get_user_role() = 'admin' AND organization_id = get_user_organization_id())
  WITH CHECK (get_user_role() = 'admin' AND organization_id = get_user_organization_id());

-- Trips
DROP POLICY IF EXISTS trips_admin ON public.trips;
CREATE POLICY trips_admin ON public.trips TO authenticated
  USING (get_user_role() = 'admin' AND organization_id = get_user_organization_id())
  WITH CHECK (get_user_role() = 'admin' AND organization_id = get_user_organization_id());

-- Cash Books
DROP POLICY IF EXISTS cashbooks_admin ON public.cash_books;
CREATE POLICY cashbooks_admin ON public.cash_books TO authenticated
  USING (get_user_role() = 'admin' AND organization_id = get_user_organization_id())
  WITH CHECK (get_user_role() = 'admin' AND organization_id = get_user_organization_id());

-- Cash Entries
DROP POLICY IF EXISTS cashentries_admin ON public.cash_entries;
CREATE POLICY cashentries_admin ON public.cash_entries TO authenticated
  USING (get_user_role() = 'admin' AND organization_id = get_user_organization_id())
  WITH CHECK (get_user_role() = 'admin' AND organization_id = get_user_organization_id());

-- Attendance
DROP POLICY IF EXISTS attendance_admin ON public.attendance;
CREATE POLICY attendance_admin ON public.attendance TO authenticated
  USING (get_user_role() = 'admin' AND organization_id = get_user_organization_id())
  WITH CHECK (get_user_role() = 'admin' AND organization_id = get_user_organization_id());

-- Leave Applications
DROP POLICY IF EXISTS leave_admin ON public.leave_applications;
CREATE POLICY leave_admin ON public.leave_applications TO authenticated
  USING (get_user_role() = 'admin' AND organization_id = get_user_organization_id())
  WITH CHECK (get_user_role() = 'admin' AND organization_id = get_user_organization_id());

-- Payroll Runs
DROP POLICY IF EXISTS payroll_runs_admin ON public.payroll_runs;
CREATE POLICY payroll_runs_admin ON public.payroll_runs TO authenticated
  USING (get_user_role() = 'admin' AND organization_id = get_user_organization_id())
  WITH CHECK (get_user_role() = 'admin' AND organization_id = get_user_organization_id());

-- Payroll Lines
DROP POLICY IF EXISTS payroll_lines_admin ON public.payroll_lines;
CREATE POLICY payroll_lines_admin ON public.payroll_lines TO authenticated
  USING (get_user_role() = 'admin' AND organization_id = get_user_organization_id())
  WITH CHECK (get_user_role() = 'admin' AND organization_id = get_user_organization_id());
