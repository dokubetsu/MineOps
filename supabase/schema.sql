-- ==========================================
-- MineOps Database Schema & Security Blueprints
-- Complete schema definition, triggers, views, and RLS policies
-- ==========================================

-- ------------------------------------------
-- 1. Tables Definition
-- ------------------------------------------

-- Sites
CREATE TABLE IF NOT EXISTS public.sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  location text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone DEFAULT now()
);

-- Transport Contractors
CREATE TABLE IF NOT EXISTS public.transport_contractors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  contact_info text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone DEFAULT now()
);

-- Vehicles
CREATE TABLE IF NOT EXISTS public.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plate_number text UNIQUE NOT NULL,
  vehicle_type text NOT NULL,
  ownership text NOT NULL,
  default_contractor_id uuid REFERENCES public.transport_contractors(id),
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone DEFAULT now()
);

-- Drivers
CREATE TABLE IF NOT EXISTS public.drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  license_number text,
  phone text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone DEFAULT now()
);

-- Employees
CREATE TABLE IF NOT EXISTS public.employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  role text NOT NULL,
  phone text,
  wage_type text NOT NULL, -- 'daily' or 'monthly'
  wage_rate numeric NOT NULL,
  site_id uuid REFERENCES public.sites(id),
  active boolean NOT NULL DEFAULT true,
  join_date date,
  created_at timestamp with time zone DEFAULT now()
);

-- Trips
CREATE TABLE IF NOT EXISTS public.trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id),
  vehicle_id uuid REFERENCES public.vehicles(id),
  driver_id uuid REFERENCES public.drivers(id),
  contractor_id uuid REFERENCES public.transport_contractors(id),
  trip_date date NOT NULL,
  entry_time timestamp with time zone DEFAULT now(),
  exit_time timestamp with time zone,
  load_info text,
  dd_number text,
  permit_number text,
  photo_url text,
  ownership_snapshot text,
  notes text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  active boolean NOT NULL DEFAULT true
);

-- Cash Books
CREATE TABLE IF NOT EXISTS public.cash_books (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id),
  book_date date NOT NULL,
  opening_balance numeric NOT NULL DEFAULT 0.0,
  closing_balance numeric NOT NULL DEFAULT 0.0,
  status text NOT NULL DEFAULT 'draft', -- 'draft' or 'locked'
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT uq_cash_books_site_date UNIQUE (site_id, book_date)
);

-- Cash Entries
CREATE TABLE IF NOT EXISTS public.cash_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cash_book_id uuid NOT NULL REFERENCES public.cash_books(id),
  entry_type text NOT NULL CHECK (entry_type IN ('in', 'out')),
  category text NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  note text,
  created_at timestamp with time zone DEFAULT now(),
  active boolean NOT NULL DEFAULT true
);

-- Attendance
CREATE TABLE IF NOT EXISTS public.attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id),
  att_date date NOT NULL,
  status text NOT NULL, -- 'present', 'absent', 'half-day', 'leave'
  photo_url text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT uq_attendance_employee_date UNIQUE (employee_id, att_date)
);

-- Leave Applications
CREATE TABLE IF NOT EXISTS public.leave_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id),
  from_date date NOT NULL,
  to_date date NOT NULL,
  reason text,
  status text NOT NULL DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
  created_at timestamp with time zone DEFAULT now()
);

-- Payroll Runs
CREATE TABLE IF NOT EXISTS public.payroll_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id),
  period_month date NOT NULL,
  status text NOT NULL DEFAULT 'draft', -- 'draft' or 'finalized'
  created_at timestamp with time zone DEFAULT now()
);

-- Payroll Lines
CREATE TABLE IF NOT EXISTS public.payroll_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id uuid NOT NULL REFERENCES public.payroll_runs(id),
  employee_id uuid NOT NULL REFERENCES public.employees(id),
  days_present integer NOT NULL DEFAULT 0,
  days_leave integer NOT NULL DEFAULT 0,
  days_absent integer NOT NULL DEFAULT 0,
  base_rate numeric NOT NULL,
  computed_amount numeric NOT NULL,
  adjustment numeric NOT NULL DEFAULT 0.0,
  final_amount numeric NOT NULL,
  notes text,
  created_at timestamp with time zone DEFAULT now()
);

-- User Access Roles
CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role text NOT NULL, -- 'admin', 'site_manager', 'stakeholder'
  site_id uuid REFERENCES public.sites(id),
  created_at timestamp with time zone DEFAULT now()
);

-- Stakeholder Site Access
CREATE TABLE IF NOT EXISTS public.stakeholder_site_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stakeholder_user_id uuid NOT NULL,
  site_id uuid NOT NULL REFERENCES public.sites(id),
  share_percent numeric NOT NULL DEFAULT 50.0,
  created_at timestamp with time zone DEFAULT now()
);

-- Cash Entry Categories (Dropdown items)
CREATE TABLE IF NOT EXISTS public.cash_entry_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  type text NOT NULL, -- 'in' or 'out'
  created_at timestamp with time zone DEFAULT now()
);


-- ------------------------------------------
-- 2. Helper Functions (RLS Rules)
-- ------------------------------------------

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS text AS $$
  SELECT role FROM user_roles WHERE user_id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_user_site_ids()
RETURNS uuid[] AS $$
  SELECT ARRAY(SELECT site_id FROM user_roles WHERE user_id = auth.uid() AND site_id IS NOT NULL);
$$ LANGUAGE sql SECURITY DEFINER;


-- ------------------------------------------
-- 3. Database Triggers & Calculations
-- ------------------------------------------

-- Trigger Function: Recalculate Cash Book balances
CREATE OR REPLACE FUNCTION public.recalculate_closing_balance()
RETURNS trigger AS $$
DECLARE
  v_book_id uuid;
  v_opening  numeric;
  v_in       numeric;
  v_out      numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_book_id := OLD.cash_book_id;
  ELSE
    v_book_id := NEW.cash_book_id;
  END IF;

  -- Sum up active entries
  SELECT
    COALESCE(SUM(CASE WHEN entry_type = 'in'  AND active IS NOT FALSE THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN entry_type = 'out' AND active IS NOT FALSE THEN amount ELSE 0 END), 0)
  INTO v_in, v_out
  FROM cash_entries
  WHERE cash_book_id = v_book_id;

  SELECT opening_balance INTO v_opening FROM cash_books WHERE id = v_book_id;

  UPDATE cash_books
  SET closing_balance = v_opening + v_in - v_out
  WHERE id = v_book_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_recalculate_balance ON cash_entries;
CREATE TRIGGER trg_recalculate_balance
AFTER INSERT OR UPDATE OR DELETE ON cash_entries
FOR EACH ROW EXECUTE FUNCTION public.recalculate_closing_balance();


-- Trigger Function: Enforce Lock Status on Cash Entries
CREATE OR REPLACE FUNCTION public.check_cash_book_not_locked()
RETURNS trigger AS $$
DECLARE
  v_status text;
  v_book_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_book_id := OLD.cash_book_id;
  ELSE
    v_book_id := NEW.cash_book_id;
  END IF;

  SELECT status INTO v_status FROM cash_books WHERE id = v_book_id;

  IF v_status = 'locked' THEN
    RAISE EXCEPTION 'Cannot modify cash entries for a locked cash book' USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_check_cash_book_lock ON cash_entries;
CREATE TRIGGER trg_check_cash_book_lock
BEFORE INSERT OR UPDATE OR DELETE ON cash_entries
FOR EACH ROW EXECUTE FUNCTION public.check_cash_book_not_locked();


-- ------------------------------------------
-- 4. Database Views
-- ------------------------------------------

CREATE OR REPLACE VIEW public.stakeholder_daily_summary AS
  SELECT cb.site_id,
    cb.book_date,
    COALESCE(sum(
        CASE
            WHEN (ce.entry_type = 'in'::text) THEN ce.amount
            ELSE (0)::numeric
        END), (0)::numeric) AS total_in,
    COALESCE(sum(
        CASE
            WHEN (ce.entry_type = 'out'::text) THEN ce.amount
            ELSE (0)::numeric
        END), (0)::numeric) AS total_out,
    cb.opening_balance,
    cb.closing_balance,
    ( SELECT count(*) AS count
           FROM trips t
          WHERE ((t.site_id = cb.site_id) AND (t.trip_date = cb.book_date))) AS trip_count
   FROM (cash_books cb
     LEFT JOIN cash_entries ce ON ((ce.cash_book_id = cb.id)))
  GROUP BY cb.id, cb.site_id, cb.book_date, cb.opening_balance, cb.closing_balance;


-- ------------------------------------------
-- 5. Row Level Security (RLS) Policies
-- ------------------------------------------

-- Sites Policies
ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;
CREATE POLICY sites_admin_all ON public.sites TO authenticated USING (get_user_role() = 'admin');
CREATE POLICY sites_manager_read ON public.sites FOR SELECT TO authenticated USING (get_user_role() = 'site_manager' AND id = ANY (get_user_site_ids()));
CREATE POLICY sites_stakeholder_read ON public.sites FOR SELECT TO authenticated USING (get_user_role() = 'stakeholder' AND id IN (SELECT site_id FROM stakeholder_site_access WHERE stakeholder_user_id = auth.uid()));

-- Transport Contractors Policies
ALTER TABLE public.transport_contractors ENABLE ROW LEVEL SECURITY;
CREATE POLICY contractors_admin ON public.transport_contractors TO authenticated USING (get_user_role() = 'admin');
CREATE POLICY contractors_read ON public.transport_contractors FOR SELECT TO authenticated USING (true);

-- Vehicles Policies
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicles_admin ON public.vehicles TO authenticated USING (get_user_role() = 'admin');
CREATE POLICY vehicles_read ON public.vehicles FOR SELECT TO authenticated USING (true);

-- Drivers Policies
ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;
CREATE POLICY drivers_admin ON public.drivers TO authenticated USING (get_user_role() = 'admin');
CREATE POLICY drivers_read ON public.drivers FOR SELECT TO authenticated USING (true);

-- Employees Policies
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY employees_admin ON public.employees TO authenticated USING (get_user_role() = 'admin');
CREATE POLICY employees_manager ON public.employees TO authenticated USING (get_user_role() = 'site_manager' AND site_id = ANY (get_user_site_ids()));

-- Trips Policies
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;
CREATE POLICY trips_admin ON public.trips TO authenticated USING (get_user_role() = 'admin');
CREATE POLICY trips_manager ON public.trips TO authenticated USING (get_user_role() = 'site_manager' AND site_id = ANY (get_user_site_ids()));
CREATE POLICY trips_stakeholder_read ON public.trips FOR SELECT TO authenticated USING (get_user_role() = 'stakeholder' AND site_id IN (SELECT site_id FROM stakeholder_site_access WHERE stakeholder_user_id = auth.uid()));

-- Cash Books Policies
ALTER TABLE public.cash_books ENABLE ROW LEVEL SECURITY;
CREATE POLICY cashbooks_admin ON public.cash_books TO authenticated USING (get_user_role() = 'admin');
CREATE POLICY cashbooks_manager ON public.cash_books TO authenticated USING (get_user_role() = 'site_manager' AND site_id = ANY (get_user_site_ids()));

-- Cash Entries Policies
ALTER TABLE public.cash_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY cashentries_admin ON public.cash_entries TO authenticated USING (get_user_role() = 'admin');
CREATE POLICY cashentries_manager ON public.cash_entries TO authenticated USING (get_user_role() = 'site_manager' AND cash_book_id IN (SELECT id FROM cash_books WHERE site_id = ANY (get_user_site_ids())));

-- Attendance Policies
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY attendance_admin ON public.attendance TO authenticated USING (get_user_role() = 'admin');
CREATE POLICY attendance_manager ON public.attendance TO authenticated USING (get_user_role() = 'site_manager' AND employee_id IN (SELECT id FROM employees WHERE site_id = ANY (get_user_site_ids())));

-- Leave Applications Policies
ALTER TABLE public.leave_applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY leave_admin ON public.leave_applications TO authenticated USING (get_user_role() = 'admin');
CREATE POLICY leave_manager ON public.leave_applications TO authenticated USING (get_user_role() = 'site_manager' AND employee_id IN (SELECT id FROM employees WHERE site_id = ANY (get_user_site_ids())));

-- Payroll Runs Policies
ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY payroll_runs_admin ON public.payroll_runs TO authenticated USING (get_user_role() = 'admin');
CREATE POLICY payroll_runs_manager ON public.payroll_runs FOR SELECT TO authenticated USING (get_user_role() = 'site_manager' AND site_id = ANY (get_user_site_ids()));

-- Payroll Lines Policies
ALTER TABLE public.payroll_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY payroll_lines_admin ON public.payroll_lines TO authenticated USING (get_user_role() = 'admin');
CREATE POLICY payroll_lines_manager ON public.payroll_lines FOR SELECT TO authenticated USING (get_user_role() = 'site_manager' AND payroll_run_id IN (SELECT id FROM payroll_runs WHERE site_id = ANY (get_user_site_ids())));

-- User Roles Policies
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_roles_admin ON public.user_roles TO authenticated USING (get_user_role() = 'admin');
CREATE POLICY user_roles_self_read ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Stakeholder Access Policies
ALTER TABLE public.stakeholder_site_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY stakeholder_access_admin ON public.stakeholder_site_access TO authenticated USING (get_user_role() = 'admin');
CREATE POLICY stakeholder_access_self_read ON public.stakeholder_site_access FOR SELECT TO authenticated USING (stakeholder_user_id = auth.uid());
