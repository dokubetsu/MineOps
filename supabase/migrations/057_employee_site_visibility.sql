-- Migration 057: Site employees can see their assigned site
--
-- Problem: sites RLS only allowed admin / site_manager / stakeholder SELECT.
-- Employee My Work loads employees(*, sites(name)) — the sites embed returned null
-- so the UI showed "Unassigned" even when user_roles.site_id was set.
-- Employees also lacked a self-read policy on their own employees roster row.

-- 1) Own employee roster row (name, site_id, attendance / leave links)
DROP POLICY IF EXISTS employees_self_select ON public.employees;
CREATE POLICY employees_self_select ON public.employees
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- 2) Read sites assigned via user_roles.site_id (get_user_site_ids)
DROP POLICY IF EXISTS sites_employee_read ON public.sites;
CREATE POLICY sites_employee_read ON public.sites
  FOR SELECT TO authenticated
  USING (
    get_user_role() IN ('employee', 'site_employee')
    AND id = ANY (public.get_user_site_ids())
  );

-- 3) Helper for UI: assigned site label (SECURITY DEFINER — reliable under RLS)
CREATE OR REPLACE FUNCTION public.get_my_assigned_sites()
RETURNS TABLE (id uuid, name text, location text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT s.id, s.name, s.location
  FROM public.sites s
  WHERE s.id = ANY (public.get_user_site_ids())
    AND COALESCE(s.active, true) = true
  ORDER BY s.name;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_assigned_sites() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_assigned_sites() TO service_role;

COMMENT ON FUNCTION public.get_my_assigned_sites() IS
  'Sites assigned to the current user via user_roles.site_id (employee / manager).';
