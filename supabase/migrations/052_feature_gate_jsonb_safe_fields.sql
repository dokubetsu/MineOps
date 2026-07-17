-- Migration 052: Feature gate safe field access (fix seed + multi-table triggers)
--
-- Root cause of SQLSTATE 42703 "record new has no field site_id":
-- enforce_module_feature_write() is shared across many tables. PL/pgSQL binds
-- NEW/OLD to the *firing table's* row type. Static references like NEW.site_id
-- fail on tables that lack site_id (sites, vehicles, drivers, negotiated_rates,
-- cash_entries, trip_photos, …) even when that CASE branch is not “logically”
-- intended for the table.
--
-- Fix:
-- 1) Read optional columns via to_jsonb(NEW/OLD) so missing keys are NULL.
-- 2) Skip enforcement when auth.uid() IS NULL (seed, superuser, service without JWT).

CREATE OR REPLACE FUNCTION public.enforce_module_feature_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r jsonb;
  v_org uuid;
  v_key text;
  v_site uuid;
  v_employee uuid;
  v_book uuid;
  v_run uuid;
  v_trip uuid;
BEGIN
  -- Service role / platform: full bypass
  IF coalesce(auth.role(), '') = 'service_role' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF public.is_platform_owner() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Seed, migrations, and superuser scripts have no JWT user
  IF auth.uid() IS NULL THEN
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

  -- Safe field extraction (missing keys → NULL, never "no field" errors)
  r := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);

  v_org := NULLIF(r->>'organization_id', '')::uuid;
  v_site := NULLIF(r->>'site_id', '')::uuid;
  v_employee := NULLIF(r->>'employee_id', '')::uuid;
  v_book := NULLIF(r->>'cash_book_id', '')::uuid;
  v_run := NULLIF(r->>'payroll_run_id', '')::uuid;
  v_trip := NULLIF(r->>'trip_id', '')::uuid;

  -- sites row: org is on the row; id is the site itself (not used for org lookup)
  IF v_org IS NULL AND TG_TABLE_NAME = 'trip_photos' AND v_trip IS NOT NULL THEN
    SELECT t.organization_id INTO v_org
    FROM public.trips t
    WHERE t.id = v_trip;
  END IF;

  IF v_org IS NULL THEN
    IF v_site IS NOT NULL THEN
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
  'Feature write gate. Phase 052: optional columns via to_jsonb; skip when auth.uid() is null (seed).';

-- Also harden set_child_organization_id for multi-table NEW field safety
CREATE OR REPLACE FUNCTION public.set_child_organization_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r jsonb;
  v_org_id uuid;
  v_site uuid;
  v_book uuid;
  v_emp uuid;
  v_run uuid;
  v_trip uuid;
BEGIN
  r := to_jsonb(NEW);
  v_site := NULLIF(r->>'site_id', '')::uuid;
  v_book := NULLIF(r->>'cash_book_id', '')::uuid;
  v_emp := NULLIF(r->>'employee_id', '')::uuid;
  v_run := NULLIF(r->>'payroll_run_id', '')::uuid;
  v_trip := NULLIF(r->>'trip_id', '')::uuid;

  IF TG_TABLE_NAME IN ('employees', 'trips', 'cash_books', 'payroll_runs') THEN
    IF v_site IS NOT NULL THEN
      SELECT organization_id INTO v_org_id FROM public.sites WHERE id = v_site;
    END IF;
  ELSIF TG_TABLE_NAME = 'cash_entries' THEN
    IF v_book IS NOT NULL THEN
      SELECT organization_id INTO v_org_id FROM public.cash_books WHERE id = v_book;
    END IF;
  ELSIF TG_TABLE_NAME IN ('attendance', 'leave_applications') THEN
    IF v_emp IS NOT NULL THEN
      SELECT organization_id INTO v_org_id FROM public.employees WHERE id = v_emp;
      IF v_org_id IS NULL THEN
        SELECT s.organization_id INTO v_org_id
        FROM public.employees e
        JOIN public.sites s ON s.id = e.site_id
        WHERE e.id = v_emp;
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'payroll_lines' THEN
    IF v_run IS NOT NULL THEN
      SELECT organization_id INTO v_org_id FROM public.payroll_runs WHERE id = v_run;
    END IF;
  ELSIF TG_TABLE_NAME = 'trip_photos' THEN
    IF v_trip IS NOT NULL THEN
      SELECT organization_id INTO v_org_id FROM public.trips WHERE id = v_trip;
    END IF;
  END IF;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Cannot resolve organization_id for %. Check parent row exists.', TG_TABLE_NAME
      USING ERRCODE = 'not_null_violation';
  END IF;

  NEW.organization_id := v_org_id;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.set_child_organization_id() IS
  'Stamp organization_id from parent. Phase 052: read child FKs via to_jsonb for multi-table safety.';
