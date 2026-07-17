-- ==========================================
-- MineOps Database Schema & Security Blueprints
-- Complete schema definition, triggers, views, and RLS policies
-- ==========================================

-- ------------------------------------------
-- 1. Tables Definition
-- ------------------------------------------

-- Organizations (tenant boundary — one row per mining company customer)
CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Sites
CREATE TABLE IF NOT EXISTS public.sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  location text,
  active boolean NOT NULL DEFAULT true,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Customers
CREATE TABLE IF NOT EXISTS public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  contact text,
  site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  created_at timestamp with time zone DEFAULT now()
);

-- Transport Contractors
CREATE TABLE IF NOT EXISTS public.transport_contractors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Vehicles
CREATE TABLE IF NOT EXISTS public.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plate_number text UNIQUE NOT NULL,
  vehicle_type text NOT NULL CHECK (vehicle_type IN ('12WH','10WH','6WH','Other')),
  ownership text NOT NULL CHECK (ownership IN ('rented','owned')),
  default_contractor_id uuid REFERENCES public.transport_contractors(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  default_cubic_capacity numeric,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Negotiated Rates
CREATE TABLE IF NOT EXISTS public.negotiated_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  vehicle_type text NOT NULL CHECK (vehicle_type IN ('12WH','10WH','6WH','Other')),
  rate_per_cubic numeric NOT NULL DEFAULT 0.0,
  created_at timestamp with time zone DEFAULT now(),
  UNIQUE(organization_id, vehicle_type)
);

-- Drivers
CREATE TABLE IF NOT EXISTS public.drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  license_number text,
  phone text,
  active boolean NOT NULL DEFAULT true,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Employees
CREATE TABLE IF NOT EXISTS public.employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  role text NOT NULL,
  phone text,
  wage_type text NOT NULL CHECK (wage_type IN ('daily','monthly')),
  wage_rate numeric NOT NULL,
  site_id uuid REFERENCES public.sites(id) ON DELETE RESTRICT,
  active boolean NOT NULL DEFAULT true,
  join_date date,
  user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  leave_balance integer NOT NULL DEFAULT 15,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Trips
CREATE TABLE IF NOT EXISTS public.trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE RESTRICT,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  contractor_id uuid REFERENCES public.transport_contractors(id) ON DELETE SET NULL,
  trip_date date NOT NULL,
  entry_time timestamp with time zone DEFAULT now(),
  load_info text,
  permit_number text,
  ownership_snapshot text,
  notes text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  active boolean NOT NULL DEFAULT true,
  cubic_capacity numeric,
  advance_amount numeric NOT NULL DEFAULT 0.0,
  photo_urls text[] DEFAULT '{}',
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  drop_location text,
  distance_km numeric,
  total_shipment_cost numeric,
  trip_worth numeric,
  settled boolean NOT NULL DEFAULT false,
  settlement_method text CHECK (settlement_method IN ('cash','upi')),
  settlement_ref text,
  settled_at timestamp with time zone,
  settled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  payment_status text CHECK (payment_status IN ('pending', 'settled')) DEFAULT 'pending',
  payment_method text CHECK (payment_method IN ('cash', 'upi')),
  payment_reference text
);

-- Trip Photos
CREATE TABLE IF NOT EXISTS public.trip_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  photo_url text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone DEFAULT now()
);

-- Cash Books
CREATE TABLE IF NOT EXISTS public.cash_books (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE RESTRICT,
  book_date date NOT NULL,
  opening_balance numeric NOT NULL DEFAULT 0.0,
  closing_balance numeric NOT NULL DEFAULT 0.0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','locked')),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT uq_cash_books_site_date UNIQUE (site_id, book_date)
);

-- Cash Entries
CREATE TABLE IF NOT EXISTS public.cash_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cash_book_id uuid NOT NULL REFERENCES public.cash_books(id) ON DELETE CASCADE,
  entry_type text NOT NULL CHECK (entry_type IN ('in', 'out')),
  category text NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  note text,
  receipt_url text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  active boolean NOT NULL DEFAULT true
);

-- Attendance
CREATE TABLE IF NOT EXISTS public.attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  att_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('present','absent','half-day','leave')),
  marked_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  photo_url text,
  CONSTRAINT uq_attendance_employee_date UNIQUE (employee_id, att_date)
);

-- Leave Applications
CREATE TABLE IF NOT EXISTS public.leave_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  from_date date NOT NULL,
  to_date date NOT NULL,
  reason text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  approved_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Payroll Runs
CREATE TABLE IF NOT EXISTS public.payroll_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE RESTRICT,
  period_month date NOT NULL CHECK (date_trunc('month', period_month) = period_month),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','finalized')),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT uq_payroll_runs_site_month UNIQUE (site_id, period_month)
);

-- Payroll Lines
CREATE TABLE IF NOT EXISTS public.payroll_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id uuid NOT NULL REFERENCES public.payroll_runs(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  days_present integer NOT NULL DEFAULT 0,
  days_leave integer NOT NULL DEFAULT 0,
  days_absent integer NOT NULL DEFAULT 0,
  base_rate numeric NOT NULL,
  computed_amount numeric NOT NULL,
  adjustment numeric NOT NULL DEFAULT 0.0,
  final_amount numeric NOT NULL,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- User Access Roles
CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('admin','site_manager','stakeholder','employee','site_employee')),
  site_id uuid REFERENCES public.sites(id) ON DELETE RESTRICT,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  -- site_manager/stakeholder/employee/site_employee rows are scoped entirely through site_id
  CONSTRAINT chk_user_roles_site_required CHECK (role = 'admin' OR site_id IS NOT NULL)
);

-- Stakeholder Site Access
CREATE TABLE IF NOT EXISTS public.stakeholder_site_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stakeholder_user_id uuid NOT NULL,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE RESTRICT,
  share_percent numeric NOT NULL DEFAULT 50.0 CHECK (share_percent >= 0.0 AND share_percent <= 100.0),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT uq_stakeholder_site UNIQUE (stakeholder_user_id, site_id)
);

-- ------------------------------------------
-- 2. Helper Functions (RLS Rules)
-- ------------------------------------------

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS text AS $$
  -- Deterministic priority (admin > site_manager > stakeholder > employee > site_employee)
  SELECT role FROM public.user_roles
  WHERE user_id = auth.uid()
  ORDER BY CASE role
    WHEN 'admin' THEN 1
    WHEN 'site_manager' THEN 2
    WHEN 'stakeholder' THEN 3
    WHEN 'employee' THEN 4
    ELSE 5
  END
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.get_user_site_ids()
RETURNS uuid[] AS $$
  SELECT ARRAY(SELECT site_id FROM public.user_roles WHERE user_id = auth.uid() AND site_id IS NOT NULL);
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.get_user_organization_id()
RETURNS uuid AS $$
  SELECT organization_id FROM public.user_roles
  WHERE user_id = auth.uid()
  ORDER BY CASE role
    WHEN 'admin' THEN 1
    WHEN 'site_manager' THEN 2
    WHEN 'stakeholder' THEN 3
    WHEN 'employee' THEN 4
    ELSE 5
  END
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.get_org_site_ids()
RETURNS uuid[] AS $$
  SELECT ARRAY(
    SELECT id FROM public.sites WHERE organization_id = public.get_user_organization_id()
  );
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp;

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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

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
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_check_cash_book_lock ON cash_entries;
CREATE TRIGGER trg_check_cash_book_lock
BEFORE INSERT OR UPDATE OR DELETE ON cash_entries
FOR EACH ROW EXECUTE FUNCTION public.check_cash_book_not_locked();

-- Trigger Function: Enforce Lock Status on Payroll Runs (finalized)
CREATE OR REPLACE FUNCTION public.check_payroll_run_not_finalized()
RETURNS trigger AS $$
DECLARE
  v_status text;
  v_run_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_run_id := OLD.payroll_run_id;
  ELSE
    v_run_id := NEW.payroll_run_id;
  END IF;

  SELECT status INTO v_status FROM public.payroll_runs WHERE id = v_run_id;

  IF v_status = 'finalized' THEN
    RAISE EXCEPTION 'Cannot modify payroll lines for a finalized run' USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_check_payroll_run_lock ON public.payroll_lines;
CREATE TRIGGER trg_check_payroll_run_lock
BEFORE INSERT OR UPDATE OR DELETE ON public.payroll_lines
FOR EACH ROW EXECUTE FUNCTION public.check_payroll_run_not_finalized();

-- Trigger Function: Prevent deleting last admin (per-organization)
CREATE OR REPLACE FUNCTION public.check_last_admin_deletion()
RETURNS trigger AS $$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.user_roles
  WHERE role = 'admin' AND organization_id = OLD.organization_id AND id <> OLD.id;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'Cannot remove this admin. At least one admin must exist per organization to prevent lockout.' USING ERRCODE = 'check_violation';
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

-- Trigger Function: Stakeholder share limit (<=100%)
CREATE OR REPLACE FUNCTION public.check_stakeholder_share_limit()
RETURNS trigger AS $$
DECLARE
  v_sum numeric;
BEGIN
  SELECT COALESCE(SUM(share_percent), 0) INTO v_sum
  FROM public.stakeholder_site_access
  WHERE site_id = NEW.site_id AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

  IF (v_sum + NEW.share_percent) > 100.0 THEN
    RAISE EXCEPTION 'Total stakeholder share percentage for this site cannot exceed 100 percent (current sum: %, trying to add: %)', v_sum, NEW.share_percent USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_stakeholder_share_limit ON public.stakeholder_site_access;
CREATE TRIGGER trg_stakeholder_share_limit
BEFORE INSERT OR UPDATE ON public.stakeholder_site_access
FOR EACH ROW EXECUTE FUNCTION public.check_stakeholder_share_limit();

-- Trigger Function: Automatically set created_by / approved_by / marked_by
CREATE OR REPLACE FUNCTION public.set_created_by()
RETURNS trigger AS $$
BEGIN
  NEW.created_by := auth.uid();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.set_marked_by()
RETURNS trigger AS $$
BEGIN
  NEW.marked_by := auth.uid();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.set_approved_by()
RETURNS trigger AS $$
BEGIN
  IF NEW.status IN ('approved', 'rejected') AND NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.approved_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Trigger Function: Automatically set updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Trigger Function: Auto-stamp organization_id on insert
CREATE OR REPLACE FUNCTION public.set_organization_id()
RETURNS trigger AS $$
BEGIN
  IF NEW.organization_id IS NULL THEN
    NEW.organization_id := public.get_user_organization_id();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_sites_set_org ON public.sites;
CREATE TRIGGER trg_sites_set_org BEFORE INSERT ON public.sites
FOR EACH ROW EXECUTE FUNCTION public.set_organization_id();

DROP TRIGGER IF EXISTS trg_vehicles_set_org ON public.vehicles;
CREATE TRIGGER trg_vehicles_set_org BEFORE INSERT ON public.vehicles
FOR EACH ROW EXECUTE FUNCTION public.set_organization_id();

DROP TRIGGER IF EXISTS trg_drivers_set_org ON public.drivers;
CREATE TRIGGER trg_drivers_set_org BEFORE INSERT ON public.drivers
FOR EACH ROW EXECUTE FUNCTION public.set_organization_id();

DROP TRIGGER IF EXISTS trg_contractors_set_org ON public.transport_contractors;
CREATE TRIGGER trg_contractors_set_org BEFORE INSERT ON public.transport_contractors
FOR EACH ROW EXECUTE FUNCTION public.set_organization_id();

DROP TRIGGER IF EXISTS trg_customers_set_org ON public.customers;
CREATE TRIGGER trg_customers_set_org BEFORE INSERT ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.set_organization_id();

DROP TRIGGER IF EXISTS trg_negotiated_rates_set_org ON public.negotiated_rates;
CREATE TRIGGER trg_negotiated_rates_set_org BEFORE INSERT ON public.negotiated_rates
FOR EACH ROW EXECUTE FUNCTION public.set_organization_id();

-- Trigger Function: user_roles.site_id must belong to the same organization
CREATE OR REPLACE FUNCTION public.check_user_roles_org_site_match()
RETURNS trigger AS $$
DECLARE
  v_site_org uuid;
END;
$$;
CREATE OR REPLACE FUNCTION public.check_user_roles_org_site_match()
RETURNS trigger AS $$
DECLARE
  v_site_org uuid;
BEGIN
  IF NEW.site_id IS NOT NULL THEN
    SELECT organization_id INTO v_site_org FROM public.sites WHERE id = NEW.site_id;
    IF v_site_org IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'site_id must belong to the same organization as this role' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_user_roles_org_site_match ON public.user_roles;
CREATE TRIGGER trg_user_roles_org_site_match
BEFORE INSERT OR UPDATE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.check_user_roles_org_site_match();

-- ------------------------------------------
-- 4. Database Views
-- ------------------------------------------

CREATE OR REPLACE VIEW public.stakeholder_daily_summary 
WITH (security_invoker = true) AS
SELECT cb.site_id, cb.book_date,
  COALESCE(SUM(CASE WHEN ce.entry_type='in'  AND ce.active IS NOT FALSE THEN ce.amount ELSE 0 END),0) AS total_in,
  COALESCE(SUM(CASE WHEN ce.entry_type='out' AND ce.active IS NOT FALSE THEN ce.amount ELSE 0 END),0) AS total_out,
  cb.opening_balance, cb.closing_balance,
  (SELECT count(*) FROM trips t WHERE t.site_id=cb.site_id AND t.trip_date=cb.book_date AND t.active IS NOT FALSE) AS trip_count
FROM cash_books cb LEFT JOIN cash_entries ce ON ce.cash_book_id=cb.id
GROUP BY cb.id, cb.site_id, cb.book_date, cb.opening_balance, cb.closing_balance;

-- ------------------------------------------
-- 5. Row Level Security (RLS) Policies
-- ------------------------------------------

-- Organizations Policies
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY organizations_self_read ON public.organizations FOR SELECT TO authenticated
  USING (id = get_user_organization_id());
CREATE POLICY organizations_self_admin_update ON public.organizations FOR UPDATE TO authenticated
  USING (get_user_role() = 'admin' AND id = get_user_organization_id())
  WITH CHECK (get_user_role() = 'admin' AND id = get_user_organization_id());

-- Sites Policies
ALTER TABLE public.sites ENABLE ROW LEVEL SECURITY;
CREATE POLICY sites_admin_all ON public.sites TO authenticated
  USING (get_user_role() = 'admin' AND organization_id = get_user_organization_id())
  WITH CHECK (get_user_role() = 'admin' AND organization_id = get_user_organization_id());
CREATE POLICY sites_manager_read ON public.sites FOR SELECT TO authenticated USING (get_user_role() = 'site_manager' AND id = ANY (get_user_site_ids()));
CREATE POLICY sites_stakeholder_read ON public.sites FOR SELECT TO authenticated USING (get_user_role() = 'stakeholder' AND id IN (SELECT site_id FROM stakeholder_site_access WHERE stakeholder_user_id = auth.uid()));

-- Customers Policies
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY customers_admin ON public.customers TO authenticated
  USING (get_user_role() = 'admin' AND organization_id = get_user_organization_id())
  WITH CHECK (get_user_role() = 'admin' AND organization_id = get_user_organization_id());
CREATE POLICY customers_read ON public.customers FOR SELECT TO authenticated
  USING (organization_id = get_user_organization_id());

-- Transport Contractors Policies
ALTER TABLE public.transport_contractors ENABLE ROW LEVEL SECURITY;
CREATE POLICY contractors_admin ON public.transport_contractors TO authenticated
  USING (get_user_role() = 'admin' AND organization_id = get_user_organization_id())
  WITH CHECK (get_user_role() = 'admin' AND organization_id = get_user_organization_id());
CREATE POLICY contractors_read ON public.transport_contractors FOR SELECT TO authenticated USING (organization_id = get_user_organization_id());

-- Vehicles Policies
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY vehicles_admin ON public.vehicles TO authenticated
  USING (get_user_role() = 'admin' AND organization_id = get_user_organization_id())
  WITH CHECK (get_user_role() = 'admin' AND organization_id = get_user_organization_id());
CREATE POLICY vehicles_manager_insert ON public.vehicles FOR INSERT TO authenticated WITH CHECK (get_user_role() = 'site_manager' AND organization_id = get_user_organization_id());
CREATE POLICY vehicles_read ON public.vehicles FOR SELECT TO authenticated USING (organization_id = get_user_organization_id());

-- Negotiated Rates Policies
ALTER TABLE public.negotiated_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY negotiated_rates_admin ON public.negotiated_rates TO authenticated
  USING (get_user_role() = 'admin' AND organization_id = get_user_organization_id())
  WITH CHECK (get_user_role() = 'admin' AND organization_id = get_user_organization_id());
CREATE POLICY negotiated_rates_read ON public.negotiated_rates FOR SELECT TO authenticated
  USING (organization_id = get_user_organization_id());

-- Drivers Policies
ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;
CREATE POLICY drivers_admin ON public.drivers TO authenticated
  USING (get_user_role() = 'admin' AND organization_id = get_user_organization_id())
  WITH CHECK (get_user_role() = 'admin' AND organization_id = get_user_organization_id());
CREATE POLICY drivers_read ON public.drivers FOR SELECT TO authenticated USING (organization_id = get_user_organization_id());

-- Employees Policies
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY employees_admin ON public.employees TO authenticated
  USING (get_user_role() = 'admin' AND site_id = ANY (get_org_site_ids()))
  WITH CHECK (get_user_role() = 'admin' AND site_id = ANY (get_org_site_ids()));
CREATE POLICY employees_manager ON public.employees TO authenticated USING (get_user_role() = 'site_manager' AND site_id = ANY (get_user_site_ids())) WITH CHECK (get_user_role() = 'site_manager' AND site_id = ANY (get_user_site_ids()));

-- Trips Policies
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;
CREATE POLICY trips_admin ON public.trips TO authenticated
  USING (get_user_role() = 'admin' AND site_id = ANY (get_org_site_ids()))
  WITH CHECK (get_user_role() = 'admin' AND site_id = ANY (get_org_site_ids()));
CREATE POLICY trips_manager ON public.trips TO authenticated USING (get_user_role() = 'site_manager' AND site_id = ANY (get_user_site_ids())) WITH CHECK (get_user_role() = 'site_manager' AND site_id = ANY (get_user_site_ids()));
CREATE POLICY trips_stakeholder_read ON public.trips FOR SELECT TO authenticated USING (get_user_role() = 'stakeholder' AND site_id IN (SELECT site_id FROM stakeholder_site_access WHERE stakeholder_user_id = auth.uid()));
CREATE POLICY trips_employee_read ON public.trips FOR SELECT TO authenticated
  USING ((get_user_role() = 'employee' OR get_user_role() = 'site_employee') AND site_id = ANY (get_user_site_ids()));
CREATE POLICY trips_employee_insert ON public.trips FOR INSERT TO authenticated
  WITH CHECK ((get_user_role() = 'employee' OR get_user_role() = 'site_employee') AND site_id = ANY (get_user_site_ids()));
CREATE POLICY trips_employee_update ON public.trips FOR UPDATE TO authenticated
  USING ((get_user_role() = 'employee' OR get_user_role() = 'site_employee') AND site_id = ANY (get_user_site_ids()))
  WITH CHECK ((get_user_role() = 'employee' OR get_user_role() = 'site_employee') AND site_id = ANY (get_user_site_ids()));

-- Trip Photos Policies
ALTER TABLE public.trip_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY trip_photos_read ON public.trip_photos FOR SELECT TO authenticated
  USING (trip_id IN (SELECT id FROM public.trips));
CREATE POLICY trip_photos_write ON public.trip_photos FOR ALL TO authenticated
  USING (trip_id IN (SELECT id FROM public.trips))
  WITH CHECK (trip_id IN (SELECT id FROM public.trips));

-- Cash Books Policies
ALTER TABLE public.cash_books ENABLE ROW LEVEL SECURITY;
CREATE POLICY cashbooks_admin ON public.cash_books TO authenticated
  USING (get_user_role() = 'admin' AND site_id = ANY (get_org_site_ids()))
  WITH CHECK (get_user_role() = 'admin' AND site_id = ANY (get_org_site_ids()));
CREATE POLICY cashbooks_manager ON public.cash_books TO authenticated USING (get_user_role() = 'site_manager' AND site_id = ANY (get_user_site_ids())) WITH CHECK (get_user_role() = 'site_manager' AND site_id = ANY (get_user_site_ids()));

-- Cash Entries Policies
ALTER TABLE public.cash_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY cashentries_admin ON public.cash_entries TO authenticated
  USING (get_user_role() = 'admin' AND cash_book_id IN (SELECT id FROM cash_books WHERE site_id = ANY (get_org_site_ids())))
  WITH CHECK (get_user_role() = 'admin' AND cash_book_id IN (SELECT id FROM cash_books WHERE site_id = ANY (get_org_site_ids())));
CREATE POLICY cashentries_manager ON public.cash_entries TO authenticated USING (get_user_role() = 'site_manager' AND cash_book_id IN (SELECT id FROM cash_books WHERE site_id = ANY (get_user_site_ids()))) WITH CHECK (get_user_role() = 'site_manager' AND cash_book_id IN (SELECT id FROM cash_books WHERE site_id = ANY (get_user_site_ids())));
CREATE POLICY cashentries_employee ON public.cash_entries TO authenticated
  USING ((get_user_role() = 'employee' OR get_user_role() = 'site_employee') AND cash_book_id IN (SELECT id FROM cash_books WHERE site_id = ANY (get_user_site_ids())))
  WITH CHECK ((get_user_role() = 'employee' OR get_user_role() = 'site_employee') AND cash_book_id IN (SELECT id FROM cash_books WHERE site_id = ANY (get_user_site_ids())));

-- Attendance Policies
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY attendance_admin ON public.attendance TO authenticated
  USING (get_user_role() = 'admin' AND employee_id IN (SELECT id FROM employees WHERE site_id = ANY (get_org_site_ids())))
  WITH CHECK (get_user_role() = 'admin' AND employee_id IN (SELECT id FROM employees WHERE site_id = ANY (get_org_site_ids())));
CREATE POLICY attendance_manager ON public.attendance TO authenticated USING (get_user_role() = 'site_manager' AND employee_id IN (SELECT id FROM employees WHERE site_id = ANY (get_user_site_ids()))) WITH CHECK (get_user_role() = 'site_manager' AND employee_id IN (SELECT id FROM employees WHERE site_id = ANY (get_user_site_ids())));
CREATE POLICY attendance_self_insert ON public.attendance FOR INSERT TO authenticated
  WITH CHECK (employee_id IN (SELECT id FROM public.employees WHERE user_id = auth.uid()) AND att_date = CURRENT_DATE);
CREATE POLICY attendance_self_read ON public.attendance FOR SELECT TO authenticated
  USING (employee_id IN (SELECT id FROM public.employees WHERE user_id = auth.uid()));

-- Leave Applications Policies
ALTER TABLE public.leave_applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY leave_admin ON public.leave_applications TO authenticated
  USING (get_user_role() = 'admin' AND employee_id IN (SELECT id FROM employees WHERE site_id = ANY (get_org_site_ids())))
  WITH CHECK (get_user_role() = 'admin' AND employee_id IN (SELECT id FROM employees WHERE site_id = ANY (get_org_site_ids())));
CREATE POLICY leave_manager ON public.leave_applications TO authenticated USING (get_user_role() = 'site_manager' AND employee_id IN (SELECT id FROM employees WHERE site_id = ANY (get_user_site_ids()))) WITH CHECK (get_user_role() = 'site_manager' AND employee_id IN (SELECT id FROM employees WHERE site_id = ANY (get_user_site_ids())));
CREATE POLICY leave_self_insert ON public.leave_applications FOR INSERT TO authenticated
  WITH CHECK (employee_id IN (SELECT id FROM public.employees WHERE user_id = auth.uid()));
CREATE POLICY leave_self_read ON public.leave_applications FOR SELECT TO authenticated
  USING (employee_id IN (SELECT id FROM public.employees WHERE user_id = auth.uid()));

-- Payroll Runs Policies
ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY payroll_runs_admin ON public.payroll_runs TO authenticated
  USING (get_user_role() = 'admin' AND site_id = ANY (get_org_site_ids()))
  WITH CHECK (get_user_role() = 'admin' AND site_id = ANY (get_org_site_ids()));
CREATE POLICY payroll_runs_manager ON public.payroll_runs TO authenticated USING (get_user_role() = 'site_manager' AND site_id = ANY (get_user_site_ids())) WITH CHECK (get_user_role() = 'site_manager' AND site_id = ANY (get_user_site_ids()));

-- Payroll Lines Policies
ALTER TABLE public.payroll_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY payroll_lines_admin ON public.payroll_lines TO authenticated
  USING (get_user_role() = 'admin' AND payroll_run_id IN (SELECT id FROM payroll_runs WHERE site_id = ANY (get_org_site_ids())))
  WITH CHECK (get_user_role() = 'admin' AND payroll_run_id IN (SELECT id FROM payroll_runs WHERE site_id = ANY (get_org_site_ids())));
CREATE POLICY payroll_lines_manager ON public.payroll_lines TO authenticated USING (get_user_role() = 'site_manager' AND payroll_run_id IN (SELECT id FROM payroll_runs WHERE site_id = ANY (get_user_site_ids()))) WITH CHECK (get_user_role() = 'site_manager' AND payroll_run_id IN (SELECT id FROM payroll_runs WHERE site_id = ANY (get_user_site_ids())));

-- User Roles Policies
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_roles_admin ON public.user_roles TO authenticated
  USING (get_user_role() = 'admin' AND organization_id = get_user_organization_id())
  WITH CHECK (get_user_role() = 'admin' AND organization_id = get_user_organization_id());
CREATE POLICY user_roles_self_read ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Stakeholder Access Policies
ALTER TABLE public.stakeholder_site_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY stakeholder_access_admin ON public.stakeholder_site_access TO authenticated
  USING (get_user_role() = 'admin' AND site_id = ANY (get_org_site_ids()))
  WITH CHECK (get_user_role() = 'admin' AND site_id = ANY (get_org_site_ids()));
CREATE POLICY stakeholder_access_self_read ON public.stakeholder_site_access FOR SELECT TO authenticated USING (stakeholder_user_id = auth.uid());

-- ------------------------------------------
-- 6. Indexes
-- ------------------------------------------
CREATE INDEX IF NOT EXISTS idx_trips_site_date ON public.trips (site_id, trip_date) WHERE active IS NOT FALSE;
CREATE INDEX IF NOT EXISTS idx_cash_entries_book ON public.cash_entries (cash_book_id) WHERE active IS NOT FALSE;
CREATE INDEX IF NOT EXISTS idx_attendance_emp_date ON public.attendance (employee_id, att_date);
CREATE INDEX IF NOT EXISTS idx_payroll_lines_run ON public.payroll_lines (payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_user ON public.user_roles (user_id);
CREATE INDEX IF NOT EXISTS idx_stakeholder_access_user ON public.stakeholder_site_access (stakeholder_user_id);
CREATE INDEX IF NOT EXISTS idx_employees_site ON public.employees (site_id) WHERE active IS NOT FALSE;
CREATE INDEX IF NOT EXISTS idx_leave_applications_employee_id ON public.leave_applications(employee_id);
CREATE INDEX IF NOT EXISTS idx_sites_org ON public.sites (organization_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_org ON public.user_roles (organization_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_org ON public.vehicles (organization_id);
CREATE INDEX IF NOT EXISTS idx_drivers_org ON public.drivers (organization_id);
CREATE INDEX IF NOT EXISTS idx_transport_contractors_org ON public.transport_contractors (organization_id);
