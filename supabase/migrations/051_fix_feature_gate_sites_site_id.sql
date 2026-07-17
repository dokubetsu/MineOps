-- Migration 051: Fix enforce_module_feature_write on public.sites
--
-- Bug (Phase 3 / 050 rewrite of enforce_module_feature_write, also present in 046):
--   v_site := CASE WHEN TG_TABLE_NAME IN (..., 'sites') THEN NEW.site_id ...
-- public.sites has no site_id column (it IS the site). Seed and any site INSERT
-- raised: record "new" has no field "site_id" (SQLSTATE 42703).
--
-- Fix: never read NEW/OLD.site_id for TG_TABLE_NAME = 'sites'.
-- organization_id on sites is enough for the feature gate.

CREATE OR REPLACE FUNCTION public.enforce_module_feature_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org uuid;
  v_key text;
  v_site uuid;
  v_employee uuid;
  v_book uuid;
  v_run uuid;
BEGIN
  IF coalesce(auth.role(), '') = 'service_role' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF public.is_platform_owner() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_key := CASE TG_TABLE_NAME
    WHEN 'payroll_runs' THEN 'payroll'
    WHEN 'payroll_lines' THEN 'payroll'
    WHEN 'trips' THEN 'trips'
    WHEN 'trip_photos' THEN 'trips'
    WHEN 'cash_books' THEN 'cash_book'
    WHEN 'cash_entries' THEN 'cash_book'
    WHEN 'attendance' THEN 'attendance'
    WHEN 'leave_applications' THEN 'leave'
    WHEN 'employees' THEN 'manage_employees'
    WHEN 'sites' THEN 'master_data'
    WHEN 'vehicles' THEN 'master_data'
    WHEN 'drivers' THEN 'master_data'
    WHEN 'transport_contractors' THEN 'master_data'
    WHEN 'customers' THEN 'master_data'
    WHEN 'negotiated_rates' THEN 'master_data'
    WHEN 'user_roles' THEN 'users'
    WHEN 'stakeholder_site_access' THEN 'users'
    ELSE NULL
  END;

  IF v_key IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_org := OLD.organization_id;
    -- sites has no site_id column — do not reference OLD.site_id for sites
    v_site := CASE
      WHEN TG_TABLE_NAME IN ('payroll_runs', 'trips', 'cash_books') THEN OLD.site_id
      WHEN TG_TABLE_NAME = 'stakeholder_site_access' THEN OLD.site_id
      WHEN TG_TABLE_NAME = 'sites' THEN OLD.id
      ELSE NULL
    END;
    v_employee := CASE
      WHEN TG_TABLE_NAME IN ('attendance', 'leave_applications', 'payroll_lines') THEN OLD.employee_id
      ELSE NULL
    END;
    v_book := CASE WHEN TG_TABLE_NAME = 'cash_entries' THEN OLD.cash_book_id ELSE NULL END;
    v_run := CASE WHEN TG_TABLE_NAME = 'payroll_lines' THEN OLD.payroll_run_id ELSE NULL END;
  ELSE
    v_org := NEW.organization_id;
    v_site := CASE
      WHEN TG_TABLE_NAME IN ('payroll_runs', 'trips', 'cash_books') THEN NEW.site_id
      WHEN TG_TABLE_NAME = 'stakeholder_site_access' THEN NEW.site_id
      WHEN TG_TABLE_NAME = 'sites' THEN NEW.id
      ELSE NULL
    END;
    v_employee := CASE
      WHEN TG_TABLE_NAME IN ('attendance', 'leave_applications', 'payroll_lines') THEN NEW.employee_id
      ELSE NULL
    END;
    v_book := CASE WHEN TG_TABLE_NAME = 'cash_entries' THEN NEW.cash_book_id ELSE NULL END;
    v_run := CASE WHEN TG_TABLE_NAME = 'payroll_lines' THEN NEW.payroll_run_id ELSE NULL END;
  END IF;

  IF v_org IS NULL AND TG_TABLE_NAME = 'trip_photos' THEN
    SELECT t.organization_id INTO v_org
    FROM public.trips t
    WHERE t.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.trip_id ELSE NEW.trip_id END;
  END IF;

  IF v_org IS NULL THEN
    IF TG_TABLE_NAME = 'sites' THEN
      -- org is the row itself; already attempted NEW/OLD.organization_id
      NULL;
    ELSIF v_site IS NOT NULL THEN
      SELECT organization_id INTO v_org FROM public.sites WHERE id = v_site;
    ELSIF v_employee IS NOT NULL THEN
      SELECT organization_id INTO v_org FROM public.employees WHERE id = v_employee;
    ELSIF v_book IS NOT NULL THEN
      SELECT organization_id INTO v_org FROM public.cash_books WHERE id = v_book;
    ELSIF v_run IS NOT NULL THEN
      SELECT organization_id INTO v_org FROM public.payroll_runs WHERE id = v_run;
    END IF;
  END IF;

  IF v_org IS NULL THEN
    v_org := public.get_user_organization_id();
  END IF;

  IF v_org IS NOT NULL AND NOT public.org_has_feature(v_org, v_key) THEN
    RAISE EXCEPTION
      'Feature "%" is not enabled for this organization',
      v_key
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION public.enforce_module_feature_write() IS
  'Feature write gate. Phase 051: sites use organization_id / id — never NEW.site_id (column does not exist on sites).';
