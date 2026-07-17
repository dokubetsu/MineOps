-- Migration 028: Validate employee.user_id belongs to same org
-- Problem: employees.user_id can point at an auth user from a different org.
-- When that user logs in, attendance_self_read/leave_self_read policies
-- return data from the wrong org via the cross-org employee link.
-- Fix: Trigger validates user_id's org matches employee's site's org.

CREATE OR REPLACE FUNCTION public.check_employee_user_org_match()
RETURNS trigger AS $$
DECLARE
  v_user_org uuid;
  v_site_org uuid;
BEGIN
  -- Only validate when user_id is being set/changed
  IF NEW.user_id IS NOT NULL THEN
    -- Get the user's organization from user_roles
    SELECT organization_id INTO v_user_org
    FROM public.user_roles
    WHERE user_id = NEW.user_id
    LIMIT 1;

    -- Get the employee's site's organization
    IF NEW.site_id IS NOT NULL THEN
      SELECT organization_id INTO v_site_org
      FROM public.sites
      WHERE id = NEW.site_id;
    END IF;

    -- If user has roles, validate org match
    IF v_user_org IS NOT NULL AND v_site_org IS NOT NULL
       AND v_user_org IS DISTINCT FROM v_site_org THEN
      RAISE EXCEPTION 'Employee user_id must belong to the same organization as the employee site'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_employee_user_org_match ON public.employees;
CREATE TRIGGER trg_employee_user_org_match
BEFORE INSERT OR UPDATE OF user_id ON public.employees
FOR EACH ROW EXECUTE FUNCTION public.check_employee_user_org_match();
