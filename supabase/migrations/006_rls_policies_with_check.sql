-- Migration 006: Recreate RLS policies with explicit WITH CHECK conditions (Fix #9)

-- 1. Sites
DROP POLICY IF EXISTS sites_admin_all ON public.sites;
DROP POLICY IF EXISTS sites_manager_read ON public.sites;
DROP POLICY IF EXISTS sites_stakeholder_read ON public.sites;

CREATE POLICY sites_admin_all ON public.sites TO authenticated 
  USING (get_user_role() = 'admin') 
  WITH CHECK (get_user_role() = 'admin');

CREATE POLICY sites_manager_read ON public.sites FOR SELECT TO authenticated 
  USING (get_user_role() = 'site_manager' AND id = ANY (get_user_site_ids()));

CREATE POLICY sites_stakeholder_read ON public.sites FOR SELECT TO authenticated 
  USING (get_user_role() = 'stakeholder' AND id IN (SELECT site_id FROM stakeholder_site_access WHERE stakeholder_user_id = auth.uid()));

-- 2. Transport Contractors
DROP POLICY IF EXISTS contractors_admin ON public.transport_contractors;
DROP POLICY IF EXISTS contractors_read ON public.transport_contractors;

CREATE POLICY contractors_admin ON public.transport_contractors TO authenticated 
  USING (get_user_role() = 'admin') 
  WITH CHECK (get_user_role() = 'admin');

CREATE POLICY contractors_read ON public.transport_contractors FOR SELECT TO authenticated 
  USING (true);

-- 3. Vehicles
DROP POLICY IF EXISTS vehicles_admin ON public.vehicles;
DROP POLICY IF EXISTS vehicles_read ON public.vehicles;
DROP POLICY IF EXISTS vehicles_manager_insert ON public.vehicles;

CREATE POLICY vehicles_admin ON public.vehicles TO authenticated 
  USING (get_user_role() = 'admin') 
  WITH CHECK (get_user_role() = 'admin');

CREATE POLICY vehicles_manager_insert ON public.vehicles FOR INSERT TO authenticated 
  WITH CHECK (get_user_role() = 'site_manager');

CREATE POLICY vehicles_read ON public.vehicles FOR SELECT TO authenticated 
  USING (true);

-- 4. Drivers
DROP POLICY IF EXISTS drivers_admin ON public.drivers;
DROP POLICY IF EXISTS drivers_read ON public.drivers;

CREATE POLICY drivers_admin ON public.drivers TO authenticated 
  USING (get_user_role() = 'admin') 
  WITH CHECK (get_user_role() = 'admin');

CREATE POLICY drivers_read ON public.drivers FOR SELECT TO authenticated 
  USING (true);

-- 5. Employees
DROP POLICY IF EXISTS employees_admin ON public.employees;
DROP POLICY IF EXISTS employees_manager ON public.employees;

CREATE POLICY employees_admin ON public.employees TO authenticated 
  USING (get_user_role() = 'admin') 
  WITH CHECK (get_user_role() = 'admin');

CREATE POLICY employees_manager ON public.employees TO authenticated 
  USING (get_user_role() = 'site_manager' AND site_id = ANY (get_user_site_ids())) 
  WITH CHECK (get_user_role() = 'site_manager' AND site_id = ANY (get_user_site_ids()));

-- 6. Trips
DROP POLICY IF EXISTS trips_admin ON public.trips;
DROP POLICY IF EXISTS trips_manager ON public.trips;
DROP POLICY IF EXISTS trips_stakeholder_read ON public.trips;

CREATE POLICY trips_admin ON public.trips TO authenticated 
  USING (get_user_role() = 'admin') 
  WITH CHECK (get_user_role() = 'admin');

CREATE POLICY trips_manager ON public.trips TO authenticated 
  USING (get_user_role() = 'site_manager' AND site_id = ANY (get_user_site_ids())) 
  WITH CHECK (get_user_role() = 'site_manager' AND site_id = ANY (get_user_site_ids()));

CREATE POLICY trips_stakeholder_read ON public.trips FOR SELECT TO authenticated 
  USING (get_user_role() = 'stakeholder' AND site_id IN (SELECT site_id FROM stakeholder_site_access WHERE stakeholder_user_id = auth.uid()));

-- 7. Cash Books
DROP POLICY IF EXISTS cashbooks_admin ON public.cash_books;
DROP POLICY IF EXISTS cashbooks_manager ON public.cash_books;

CREATE POLICY cashbooks_admin ON public.cash_books TO authenticated 
  USING (get_user_role() = 'admin') 
  WITH CHECK (get_user_role() = 'admin');

CREATE POLICY cashbooks_manager ON public.cash_books TO authenticated 
  USING (get_user_role() = 'site_manager' AND site_id = ANY (get_user_site_ids())) 
  WITH CHECK (get_user_role() = 'site_manager' AND site_id = ANY (get_user_site_ids()));

-- 8. Cash Entries
DROP POLICY IF EXISTS cashentries_admin ON public.cash_entries;
DROP POLICY IF EXISTS cashentries_manager ON public.cash_entries;

CREATE POLICY cashentries_admin ON public.cash_entries TO authenticated 
  USING (get_user_role() = 'admin') 
  WITH CHECK (get_user_role() = 'admin');

CREATE POLICY cashentries_manager ON public.cash_entries TO authenticated 
  USING (get_user_role() = 'site_manager' AND cash_book_id IN (SELECT id FROM cash_books WHERE site_id = ANY (get_user_site_ids()))) 
  WITH CHECK (get_user_role() = 'site_manager' AND cash_book_id IN (SELECT id FROM cash_books WHERE site_id = ANY (get_user_site_ids())));

-- 9. Attendance
DROP POLICY IF EXISTS attendance_admin ON public.attendance;
DROP POLICY IF EXISTS attendance_manager ON public.attendance;

CREATE POLICY attendance_admin ON public.attendance TO authenticated 
  USING (get_user_role() = 'admin') 
  WITH CHECK (get_user_role() = 'admin');

CREATE POLICY attendance_manager ON public.attendance TO authenticated 
  USING (get_user_role() = 'site_manager' AND employee_id IN (SELECT id FROM employees WHERE site_id = ANY (get_user_site_ids()))) 
  WITH CHECK (get_user_role() = 'site_manager' AND employee_id IN (SELECT id FROM employees WHERE site_id = ANY (get_user_site_ids())));

-- 10. Leave Applications
DROP POLICY IF EXISTS leave_admin ON public.leave_applications;
DROP POLICY IF EXISTS leave_manager ON public.leave_applications;

CREATE POLICY leave_admin ON public.leave_applications TO authenticated 
  USING (get_user_role() = 'admin') 
  WITH CHECK (get_user_role() = 'admin');

CREATE POLICY leave_manager ON public.leave_applications TO authenticated 
  USING (get_user_role() = 'site_manager' AND employee_id IN (SELECT id FROM employees WHERE site_id = ANY (get_user_site_ids()))) 
  WITH CHECK (get_user_role() = 'site_manager' AND employee_id IN (SELECT id FROM employees WHERE site_id = ANY (get_user_site_ids())));

-- 11. Payroll Runs
DROP POLICY IF EXISTS payroll_runs_admin ON public.payroll_runs;
DROP POLICY IF EXISTS payroll_runs_manager ON public.payroll_runs;

CREATE POLICY payroll_runs_admin ON public.payroll_runs TO authenticated 
  USING (get_user_role() = 'admin') 
  WITH CHECK (get_user_role() = 'admin');

CREATE POLICY payroll_runs_manager ON public.payroll_runs TO authenticated 
  USING (get_user_role() = 'site_manager' AND site_id = ANY (get_user_site_ids())) 
  WITH CHECK (get_user_role() = 'site_manager' AND site_id = ANY (get_user_site_ids()));

-- 12. Payroll Lines
DROP POLICY IF EXISTS payroll_lines_admin ON public.payroll_lines;
DROP POLICY IF EXISTS payroll_lines_manager ON public.payroll_lines;

CREATE POLICY payroll_lines_admin ON public.payroll_lines TO authenticated 
  USING (get_user_role() = 'admin') 
  WITH CHECK (get_user_role() = 'admin');

CREATE POLICY payroll_lines_manager ON public.payroll_lines TO authenticated 
  USING (get_user_role() = 'site_manager' AND payroll_run_id IN (SELECT id FROM payroll_runs WHERE site_id = ANY (get_user_site_ids()))) 
  WITH CHECK (get_user_role() = 'site_manager' AND payroll_run_id IN (SELECT id FROM payroll_runs WHERE site_id = ANY (get_user_site_ids())));

-- 13. User Roles
DROP POLICY IF EXISTS user_roles_admin ON public.user_roles;
DROP POLICY IF EXISTS user_roles_self_read ON public.user_roles;

CREATE POLICY user_roles_admin ON public.user_roles TO authenticated 
  USING (get_user_role() = 'admin') 
  WITH CHECK (get_user_role() = 'admin');

CREATE POLICY user_roles_self_read ON public.user_roles FOR SELECT TO authenticated 
  USING (user_id = auth.uid());

-- 14. Stakeholder Site Access
DROP POLICY IF EXISTS stakeholder_access_admin ON public.stakeholder_site_access;
DROP POLICY IF EXISTS stakeholder_access_self_read ON public.stakeholder_site_access;

CREATE POLICY stakeholder_access_admin ON public.stakeholder_site_access TO authenticated 
  USING (get_user_role() = 'admin') 
  WITH CHECK (get_user_role() = 'admin');

CREATE POLICY stakeholder_access_self_read ON public.stakeholder_site_access FOR SELECT TO authenticated 
  USING (stakeholder_user_id = auth.uid());
