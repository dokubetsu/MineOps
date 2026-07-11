-- Migration 009: Restrict site-level deletes to prevent accidental data destruction and make driver_id SET NULL for consistency

-- 1. Restrict deletes on trips.site_id
ALTER TABLE public.trips DROP CONSTRAINT IF EXISTS trips_site_id_fkey;
ALTER TABLE public.trips
  ADD CONSTRAINT trips_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE RESTRICT;

-- 2. Restrict deletes on cash_books.site_id
ALTER TABLE public.cash_books DROP CONSTRAINT IF EXISTS cash_books_site_id_fkey;
ALTER TABLE public.cash_books
  ADD CONSTRAINT cash_books_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE RESTRICT;

-- 3. Restrict deletes on employees.site_id
ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_site_id_fkey;
ALTER TABLE public.employees
  ADD CONSTRAINT employees_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE RESTRICT;

-- 4. Restrict deletes on payroll_runs.site_id
ALTER TABLE public.payroll_runs DROP CONSTRAINT IF EXISTS payroll_runs_site_id_fkey;
ALTER TABLE public.payroll_runs
  ADD CONSTRAINT payroll_runs_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE RESTRICT;

-- 5. Restrict deletes on user_roles.site_id
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_site_id_fkey;
ALTER TABLE public.user_roles
  ADD CONSTRAINT user_roles_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE RESTRICT;

-- 6. Restrict deletes on stakeholder_site_access.site_id
ALTER TABLE public.stakeholder_site_access DROP CONSTRAINT IF EXISTS stakeholder_site_access_site_id_fkey;
ALTER TABLE public.stakeholder_site_access
  ADD CONSTRAINT stakeholder_site_access_site_id_fkey FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE RESTRICT;

-- 7. Consistent driver_id deletion behaviour (SET NULL)
ALTER TABLE public.trips DROP CONSTRAINT IF EXISTS trips_driver_id_fkey;
ALTER TABLE public.trips
  ADD CONSTRAINT trips_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.drivers(id) ON DELETE SET NULL;
