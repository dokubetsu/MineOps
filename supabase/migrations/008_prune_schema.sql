-- Migration 008: Prune schema column deadwood and add ON DELETE referential integrity actions

-- 1. Drop unused/dead columns
ALTER TABLE public.trips DROP COLUMN IF EXISTS exit_time;
ALTER TABLE public.transport_contractors DROP COLUMN IF EXISTS contact_info;

-- 2. Drop unused cash_entry_categories table
DROP TABLE IF EXISTS public.cash_entry_categories CASCADE;

-- 3. Add ON DELETE actions to foreign key constraints for cascading deletes
-- Re-create constraint user_roles.site_id
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_site_id_fkey;
ALTER TABLE public.user_roles
  ADD CONSTRAINT user_roles_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE CASCADE;

-- Re-create constraint employees.site_id
ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_site_id_fkey;
ALTER TABLE public.employees
  ADD CONSTRAINT employees_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE CASCADE;

-- Re-create constraint attendance.employee_id
ALTER TABLE public.attendance DROP CONSTRAINT IF EXISTS attendance_employee_id_fkey;
ALTER TABLE public.attendance
  ADD CONSTRAINT attendance_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;

-- Re-create constraint leave_applications.employee_id
ALTER TABLE public.leave_applications DROP CONSTRAINT IF EXISTS leave_applications_employee_id_fkey;
ALTER TABLE public.leave_applications
  ADD CONSTRAINT leave_applications_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;

-- Re-create constraint payroll_runs.site_id
ALTER TABLE public.payroll_runs DROP CONSTRAINT IF EXISTS payroll_runs_site_id_fkey;
ALTER TABLE public.payroll_runs
  ADD CONSTRAINT payroll_runs_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE CASCADE;

-- Re-create constraint payroll_lines.payroll_run_id
ALTER TABLE public.payroll_lines DROP CONSTRAINT IF EXISTS payroll_lines_payroll_run_id_fkey;
ALTER TABLE public.payroll_lines
  ADD CONSTRAINT payroll_lines_payroll_run_id_fkey FOREIGN KEY (payroll_run_id) REFERENCES public.payroll_runs(id) ON DELETE CASCADE;

-- Re-create constraint payroll_lines.employee_id
ALTER TABLE public.payroll_lines DROP CONSTRAINT IF EXISTS payroll_lines_employee_id_fkey;
ALTER TABLE public.payroll_lines
  ADD CONSTRAINT payroll_lines_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.employees(id) ON DELETE CASCADE;

-- Re-create constraint trips.site_id
ALTER TABLE public.trips DROP CONSTRAINT IF EXISTS trips_site_id_fkey;
ALTER TABLE public.trips
  ADD CONSTRAINT trips_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE CASCADE;

-- Re-create constraint trips.vehicle_id
ALTER TABLE public.trips DROP CONSTRAINT IF EXISTS trips_vehicle_id_fkey;
ALTER TABLE public.trips
  ADD CONSTRAINT trips_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id) ON DELETE SET NULL;

-- Re-create constraint trips.contractor_id
ALTER TABLE public.trips DROP CONSTRAINT IF EXISTS trips_contractor_id_fkey;
ALTER TABLE public.trips
  ADD CONSTRAINT trips_contractor_id_fkey FOREIGN KEY (contractor_id) REFERENCES public.transport_contractors(id) ON DELETE SET NULL;

-- Re-create constraint cash_books.site_id
ALTER TABLE public.cash_books DROP CONSTRAINT IF EXISTS cash_books_site_id_fkey;
ALTER TABLE public.cash_books
  ADD CONSTRAINT cash_books_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE CASCADE;

-- Re-create constraint cash_entries.cash_book_id
ALTER TABLE public.cash_entries DROP CONSTRAINT IF EXISTS cash_entries_cash_book_id_fkey;
ALTER TABLE public.cash_entries
  ADD CONSTRAINT cash_entries_cash_book_id_fkey FOREIGN KEY (cash_book_id) REFERENCES public.cash_books(id) ON DELETE CASCADE;

-- Re-create constraint stakeholder_site_access.site_id
ALTER TABLE public.stakeholder_site_access DROP CONSTRAINT IF EXISTS stakeholder_site_access_site_id_fkey;
ALTER TABLE public.stakeholder_site_access
  ADD CONSTRAINT stakeholder_site_access_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE CASCADE;
