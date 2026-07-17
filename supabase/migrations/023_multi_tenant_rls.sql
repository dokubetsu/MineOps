-- Migration 023: Multi-tenant schema (step 3 of 3) — RLS switchover
--
-- Requires 021 and 022 to have already run (organization_id must be backfilled
-- and NOT NULL before this applies, or every *_admin policy below evaluates
-- organization_id as NULL and denies everyone, including existing admins).
--
-- This is the migration that actually closes the cross-tenant leak: today,
-- get_user_role() = 'admin' alone grants access to every row in the table,
-- regardless of which company it belongs to. Every policy below adds an
-- explicit organization scope on top of the existing role check.

-- ------------------------------------------
-- Auto-stamp organization_id on insert
-- ------------------------------------------
-- Same idea as the existing set_created_by()/set_marked_by() triggers: if
-- the client doesn't send organization_id, fill it in from the caller's own
-- session so app code that creates sites, vehicles, drivers, and contractors
-- needs no changes at all. If a client *does* send one (e.g. a spoofed value
-- from a different org), this trigger leaves it alone and the table's own
-- WITH CHECK policy below rejects the insert for not matching the caller's
-- real organization.
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

-- user_roles is populated by /api/admin/create-user using the service role
-- (no client session, so get_user_organization_id() has no auth.uid() to
-- resolve) — that route now sets organization_id explicitly instead. This
-- trigger is the safety net: it rejects a role row whose site_id points at
-- a site from a *different* organization than the one on the row itself.
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
-- Sites
-- ------------------------------------------
DROP POLICY IF EXISTS sites_admin_all ON public.sites;
CREATE POLICY sites_admin_all ON public.sites TO authenticated
  USING (get_user_role() = 'admin' AND organization_id = get_user_organization_id())
  WITH CHECK (get_user_role() = 'admin' AND organization_id = get_user_organization_id());
-- sites_manager_read / sites_stakeholder_read are unchanged: they already
-- scope to specific sites the user is individually assigned/granted, and
-- trg_user_roles_org_site_match guarantees those sites are within the
-- user's own org, so they were never able to leak across tenants.

-- ------------------------------------------
-- Transport Contractors
-- ------------------------------------------
DROP POLICY IF EXISTS contractors_admin ON public.transport_contractors;
CREATE POLICY contractors_admin ON public.transport_contractors TO authenticated
  USING (get_user_role() = 'admin' AND organization_id = get_user_organization_id())
  WITH CHECK (get_user_role() = 'admin' AND organization_id = get_user_organization_id());

DROP POLICY IF EXISTS contractors_read ON public.transport_contractors;
CREATE POLICY contractors_read ON public.transport_contractors FOR SELECT TO authenticated
  USING (organization_id = get_user_organization_id());

-- ------------------------------------------
-- Vehicles
-- ------------------------------------------
DROP POLICY IF EXISTS vehicles_admin ON public.vehicles;
CREATE POLICY vehicles_admin ON public.vehicles TO authenticated
  USING (get_user_role() = 'admin' AND organization_id = get_user_organization_id())
  WITH CHECK (get_user_role() = 'admin' AND organization_id = get_user_organization_id());

DROP POLICY IF EXISTS vehicles_manager_insert ON public.vehicles;
CREATE POLICY vehicles_manager_insert ON public.vehicles FOR INSERT TO authenticated
  WITH CHECK (get_user_role() = 'site_manager' AND organization_id = get_user_organization_id());

DROP POLICY IF EXISTS vehicles_read ON public.vehicles;
CREATE POLICY vehicles_read ON public.vehicles FOR SELECT TO authenticated
  USING (organization_id = get_user_organization_id());

-- ------------------------------------------
-- Drivers
-- ------------------------------------------
DROP POLICY IF EXISTS drivers_admin ON public.drivers;
CREATE POLICY drivers_admin ON public.drivers TO authenticated
  USING (get_user_role() = 'admin' AND organization_id = get_user_organization_id())
  WITH CHECK (get_user_role() = 'admin' AND organization_id = get_user_organization_id());

DROP POLICY IF EXISTS drivers_read ON public.drivers;
CREATE POLICY drivers_read ON public.drivers FOR SELECT TO authenticated
  USING (organization_id = get_user_organization_id());

-- ------------------------------------------
-- Employees
-- ------------------------------------------
DROP POLICY IF EXISTS employees_admin ON public.employees;
CREATE POLICY employees_admin ON public.employees TO authenticated
  USING (get_user_role() = 'admin' AND site_id = ANY (get_org_site_ids()))
  WITH CHECK (get_user_role() = 'admin' AND site_id = ANY (get_org_site_ids()));
-- employees_manager is unchanged (already scoped via get_user_site_ids()).

-- ------------------------------------------
-- Trips
-- ------------------------------------------
DROP POLICY IF EXISTS trips_admin ON public.trips;
CREATE POLICY trips_admin ON public.trips TO authenticated
  USING (get_user_role() = 'admin' AND site_id = ANY (get_org_site_ids()))
  WITH CHECK (get_user_role() = 'admin' AND site_id = ANY (get_org_site_ids()));
-- trips_manager / trips_stakeholder_read are unchanged.

-- ------------------------------------------
-- Cash Books
-- ------------------------------------------
DROP POLICY IF EXISTS cashbooks_admin ON public.cash_books;
CREATE POLICY cashbooks_admin ON public.cash_books TO authenticated
  USING (get_user_role() = 'admin' AND site_id = ANY (get_org_site_ids()))
  WITH CHECK (get_user_role() = 'admin' AND site_id = ANY (get_org_site_ids()));
-- cashbooks_manager is unchanged.

-- ------------------------------------------
-- Cash Entries
-- ------------------------------------------
DROP POLICY IF EXISTS cashentries_admin ON public.cash_entries;
CREATE POLICY cashentries_admin ON public.cash_entries TO authenticated
  USING (get_user_role() = 'admin' AND cash_book_id IN (SELECT id FROM cash_books WHERE site_id = ANY (get_org_site_ids())))
  WITH CHECK (get_user_role() = 'admin' AND cash_book_id IN (SELECT id FROM cash_books WHERE site_id = ANY (get_org_site_ids())));
-- cashentries_manager is unchanged.

-- ------------------------------------------
-- Attendance
-- ------------------------------------------
DROP POLICY IF EXISTS attendance_admin ON public.attendance;
CREATE POLICY attendance_admin ON public.attendance TO authenticated
  USING (get_user_role() = 'admin' AND employee_id IN (SELECT id FROM employees WHERE site_id = ANY (get_org_site_ids())))
  WITH CHECK (get_user_role() = 'admin' AND employee_id IN (SELECT id FROM employees WHERE site_id = ANY (get_org_site_ids())));
-- attendance_manager is unchanged.

-- ------------------------------------------
-- Leave Applications
-- ------------------------------------------
DROP POLICY IF EXISTS leave_admin ON public.leave_applications;
CREATE POLICY leave_admin ON public.leave_applications TO authenticated
  USING (get_user_role() = 'admin' AND employee_id IN (SELECT id FROM employees WHERE site_id = ANY (get_org_site_ids())))
  WITH CHECK (get_user_role() = 'admin' AND employee_id IN (SELECT id FROM employees WHERE site_id = ANY (get_org_site_ids())));
-- leave_manager is unchanged.

-- ------------------------------------------
-- Payroll Runs
-- ------------------------------------------
DROP POLICY IF EXISTS payroll_runs_admin ON public.payroll_runs;
CREATE POLICY payroll_runs_admin ON public.payroll_runs TO authenticated
  USING (get_user_role() = 'admin' AND site_id = ANY (get_org_site_ids()))
  WITH CHECK (get_user_role() = 'admin' AND site_id = ANY (get_org_site_ids()));
-- payroll_runs_manager is unchanged.

-- ------------------------------------------
-- Payroll Lines
-- ------------------------------------------
DROP POLICY IF EXISTS payroll_lines_admin ON public.payroll_lines;
CREATE POLICY payroll_lines_admin ON public.payroll_lines TO authenticated
  USING (get_user_role() = 'admin' AND payroll_run_id IN (SELECT id FROM payroll_runs WHERE site_id = ANY (get_org_site_ids())))
  WITH CHECK (get_user_role() = 'admin' AND payroll_run_id IN (SELECT id FROM payroll_runs WHERE site_id = ANY (get_org_site_ids())));
-- payroll_lines_manager is unchanged.

-- ------------------------------------------
-- User Roles
-- ------------------------------------------
DROP POLICY IF EXISTS user_roles_admin ON public.user_roles;
CREATE POLICY user_roles_admin ON public.user_roles TO authenticated
  USING (get_user_role() = 'admin' AND organization_id = get_user_organization_id())
  WITH CHECK (get_user_role() = 'admin' AND organization_id = get_user_organization_id());
-- user_roles_self_read is unchanged — reading your own row(s) is always safe.

-- ------------------------------------------
-- Stakeholder Site Access
-- ------------------------------------------
DROP POLICY IF EXISTS stakeholder_access_admin ON public.stakeholder_site_access;
CREATE POLICY stakeholder_access_admin ON public.stakeholder_site_access TO authenticated
  USING (get_user_role() = 'admin' AND site_id = ANY (get_org_site_ids()))
  WITH CHECK (get_user_role() = 'admin' AND site_id = ANY (get_org_site_ids()));
-- stakeholder_access_self_read is unchanged.
