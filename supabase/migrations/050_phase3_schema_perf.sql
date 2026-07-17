-- Migration 050: Phase 3 — schema denorm + performance + RLS defense-in-depth
--
-- P3.1 trip_photos.organization_id denorm, stamp, indexes, tighter RLS
-- P3.2 Manager/employee policies: require organization_id match
-- P3.3 Hot-path indexes (customers, leave, trip_photos)
-- P3.4 set_child_organization_id handles trip_photos; feature gate uses denorm org

-- ============================================================
-- P3.1: trip_photos organization_id
-- ============================================================

ALTER TABLE public.trip_photos
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE RESTRICT;

UPDATE public.trip_photos tp
SET organization_id = t.organization_id
FROM public.trips t
WHERE tp.trip_id = t.id
  AND tp.organization_id IS NULL;

-- Orphan photos without parent trip: drop (cannot satisfy NOT NULL safely)
DELETE FROM public.trip_photos WHERE organization_id IS NULL;

ALTER TABLE public.trip_photos
  ALTER COLUMN organization_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_trip_photos_trip_id ON public.trip_photos (trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_photos_org ON public.trip_photos (organization_id);
CREATE INDEX IF NOT EXISTS idx_trip_photos_org_trip ON public.trip_photos (organization_id, trip_id);

-- ============================================================
-- Extend set_child_organization_id for trip_photos
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_child_organization_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'employees' THEN
    SELECT organization_id INTO v_org_id FROM public.sites WHERE id = NEW.site_id;
  ELSIF TG_TABLE_NAME = 'trips' THEN
    SELECT organization_id INTO v_org_id FROM public.sites WHERE id = NEW.site_id;
  ELSIF TG_TABLE_NAME = 'cash_books' THEN
    SELECT organization_id INTO v_org_id FROM public.sites WHERE id = NEW.site_id;
  ELSIF TG_TABLE_NAME = 'cash_entries' THEN
    SELECT organization_id INTO v_org_id FROM public.cash_books WHERE id = NEW.cash_book_id;
  ELSIF TG_TABLE_NAME = 'attendance' THEN
    SELECT organization_id INTO v_org_id FROM public.employees WHERE id = NEW.employee_id;
    IF v_org_id IS NULL THEN
      SELECT s.organization_id INTO v_org_id
      FROM public.employees e
      JOIN public.sites s ON s.id = e.site_id
      WHERE e.id = NEW.employee_id;
    END IF;
  ELSIF TG_TABLE_NAME = 'leave_applications' THEN
    SELECT organization_id INTO v_org_id FROM public.employees WHERE id = NEW.employee_id;
    IF v_org_id IS NULL THEN
      SELECT s.organization_id INTO v_org_id
      FROM public.employees e
      JOIN public.sites s ON s.id = e.site_id
      WHERE e.id = NEW.employee_id;
    END IF;
  ELSIF TG_TABLE_NAME = 'payroll_runs' THEN
    SELECT organization_id INTO v_org_id FROM public.sites WHERE id = NEW.site_id;
  ELSIF TG_TABLE_NAME = 'payroll_lines' THEN
    SELECT organization_id INTO v_org_id FROM public.payroll_runs WHERE id = NEW.payroll_run_id;
  ELSIF TG_TABLE_NAME = 'trip_photos' THEN
    SELECT organization_id INTO v_org_id FROM public.trips WHERE id = NEW.trip_id;
  END IF;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Cannot resolve organization_id for %. Check parent row exists.', TG_TABLE_NAME
      USING ERRCODE = 'not_null_violation';
  END IF;

  NEW.organization_id := v_org_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_trip_photos_set_org ON public.trip_photos;
CREATE TRIGGER trg_trip_photos_set_org
  BEFORE INSERT OR UPDATE OF trip_id ON public.trip_photos
  FOR EACH ROW
  EXECUTE FUNCTION public.set_child_organization_id();

-- ============================================================
-- trip_photos RLS: org + visible parent trip (no unrestricted FOR ALL)
-- ============================================================

DROP POLICY IF EXISTS trip_photos_read ON public.trip_photos;
DROP POLICY IF EXISTS trip_photos_write ON public.trip_photos;
DROP POLICY IF EXISTS trip_photos_admin ON public.trip_photos;
DROP POLICY IF EXISTS trip_photos_manager ON public.trip_photos;
DROP POLICY IF EXISTS trip_photos_employee ON public.trip_photos;
DROP POLICY IF EXISTS trip_photos_select ON public.trip_photos;
DROP POLICY IF EXISTS trip_photos_insert ON public.trip_photos;
DROP POLICY IF EXISTS trip_photos_update ON public.trip_photos;
DROP POLICY IF EXISTS trip_photos_delete ON public.trip_photos;

CREATE POLICY trip_photos_select ON public.trip_photos
  FOR SELECT TO authenticated
  USING (
    organization_id = get_user_organization_id()
    AND trip_id IN (SELECT id FROM public.trips)
  );

CREATE POLICY trip_photos_insert ON public.trip_photos
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = get_user_organization_id()
    AND trip_id IN (
      SELECT id FROM public.trips t
      WHERE t.organization_id = get_user_organization_id()
        AND (
          get_user_role() = 'admin'
          OR (get_user_role() = 'site_manager' AND t.site_id = ANY (get_user_site_ids()))
          OR (
            get_user_role() IN ('employee', 'site_employee')
            AND t.site_id = ANY (get_user_site_ids())
          )
        )
    )
  );

CREATE POLICY trip_photos_update ON public.trip_photos
  FOR UPDATE TO authenticated
  USING (
    organization_id = get_user_organization_id()
    AND (
      get_user_role() = 'admin'
      OR (
        get_user_role() = 'site_manager'
        AND trip_id IN (
          SELECT id FROM public.trips
          WHERE site_id = ANY (get_user_site_ids())
            AND organization_id = get_user_organization_id()
        )
      )
    )
  )
  WITH CHECK (
    organization_id = get_user_organization_id()
  );

CREATE POLICY trip_photos_delete ON public.trip_photos
  FOR DELETE TO authenticated
  USING (
    organization_id = get_user_organization_id()
    AND (
      get_user_role() = 'admin'
      OR (
        get_user_role() = 'site_manager'
        AND trip_id IN (
          SELECT id FROM public.trips
          WHERE site_id = ANY (get_user_site_ids())
            AND organization_id = get_user_organization_id()
        )
      )
      OR (
        get_user_role() IN ('employee', 'site_employee')
        AND trip_id IN (
          SELECT id FROM public.trips
          WHERE created_by = auth.uid()
            AND site_id = ANY (get_user_site_ids())
            AND organization_id = get_user_organization_id()
        )
      )
    )
  );

-- Feature gate: prefer denorm organization_id on trip_photos
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
    v_site := CASE
      WHEN TG_TABLE_NAME IN ('payroll_runs', 'trips', 'cash_books', 'sites') THEN OLD.site_id
      WHEN TG_TABLE_NAME = 'stakeholder_site_access' THEN OLD.site_id
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
      WHEN TG_TABLE_NAME IN ('payroll_runs', 'trips', 'cash_books', 'sites') THEN NEW.site_id
      WHEN TG_TABLE_NAME = 'stakeholder_site_access' THEN NEW.site_id
      ELSE NULL
    END;
    v_employee := CASE
      WHEN TG_TABLE_NAME IN ('attendance', 'leave_applications', 'payroll_lines') THEN NEW.employee_id
      ELSE NULL
    END;
    v_book := CASE WHEN TG_TABLE_NAME = 'cash_entries' THEN NEW.cash_book_id ELSE NULL END;
    v_run := CASE WHEN TG_TABLE_NAME = 'payroll_lines' THEN NEW.payroll_run_id ELSE NULL END;
  END IF;

  -- trip_photos now has organization_id; still allow parent fallback
  IF v_org IS NULL AND TG_TABLE_NAME = 'trip_photos' THEN
    SELECT t.organization_id INTO v_org
    FROM public.trips t
    WHERE t.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.trip_id ELSE NEW.trip_id END;
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

-- ============================================================
-- P3.2: Manager + employee policies — org defense-in-depth
-- ============================================================

-- Employees
DROP POLICY IF EXISTS employees_manager ON public.employees;
CREATE POLICY employees_manager ON public.employees TO authenticated
  USING (
    get_user_role() = 'site_manager'
    AND site_id = ANY (get_user_site_ids())
    AND organization_id = get_user_organization_id()
  )
  WITH CHECK (
    get_user_role() = 'site_manager'
    AND site_id = ANY (get_user_site_ids())
    AND organization_id = get_user_organization_id()
  );

-- Trips
DROP POLICY IF EXISTS trips_manager ON public.trips;
CREATE POLICY trips_manager ON public.trips TO authenticated
  USING (
    get_user_role() = 'site_manager'
    AND site_id = ANY (get_user_site_ids())
    AND organization_id = get_user_organization_id()
  )
  WITH CHECK (
    get_user_role() = 'site_manager'
    AND site_id = ANY (get_user_site_ids())
    AND organization_id = get_user_organization_id()
  );

DROP POLICY IF EXISTS trips_employee_read ON public.trips;
CREATE POLICY trips_employee_read ON public.trips FOR SELECT TO authenticated
  USING (
    get_user_role() IN ('employee', 'site_employee')
    AND site_id = ANY (get_user_site_ids())
    AND organization_id = get_user_organization_id()
  );

DROP POLICY IF EXISTS trips_employee_insert ON public.trips;
CREATE POLICY trips_employee_insert ON public.trips FOR INSERT TO authenticated
  WITH CHECK (
    get_user_role() IN ('employee', 'site_employee')
    AND site_id = ANY (get_user_site_ids())
    AND organization_id = get_user_organization_id()
  );

DROP POLICY IF EXISTS trips_employee_update ON public.trips;
CREATE POLICY trips_employee_update ON public.trips FOR UPDATE TO authenticated
  USING (
    get_user_role() IN ('employee', 'site_employee')
    AND site_id = ANY (get_user_site_ids())
    AND organization_id = get_user_organization_id()
    AND created_by = auth.uid()
  )
  WITH CHECK (
    get_user_role() IN ('employee', 'site_employee')
    AND site_id = ANY (get_user_site_ids())
    AND organization_id = get_user_organization_id()
    AND created_by = auth.uid()
  );

-- Cash books
DROP POLICY IF EXISTS cashbooks_manager ON public.cash_books;
CREATE POLICY cashbooks_manager ON public.cash_books TO authenticated
  USING (
    get_user_role() = 'site_manager'
    AND site_id = ANY (get_user_site_ids())
    AND organization_id = get_user_organization_id()
  )
  WITH CHECK (
    get_user_role() = 'site_manager'
    AND site_id = ANY (get_user_site_ids())
    AND organization_id = get_user_organization_id()
  );

DROP POLICY IF EXISTS cashbooks_employee_select ON public.cash_books;
CREATE POLICY cashbooks_employee_select ON public.cash_books FOR SELECT TO authenticated
  USING (
    get_user_role() IN ('employee', 'site_employee')
    AND site_id = ANY (get_user_site_ids())
    AND organization_id = get_user_organization_id()
  );

DROP POLICY IF EXISTS cashbooks_employee_insert ON public.cash_books;
CREATE POLICY cashbooks_employee_insert ON public.cash_books FOR INSERT TO authenticated
  WITH CHECK (
    get_user_role() IN ('employee', 'site_employee')
    AND site_id = ANY (get_user_site_ids())
    AND organization_id = get_user_organization_id()
    AND status = 'draft'
  );

-- Cash entries
DROP POLICY IF EXISTS cashentries_manager ON public.cash_entries;
CREATE POLICY cashentries_manager ON public.cash_entries TO authenticated
  USING (
    get_user_role() = 'site_manager'
    AND organization_id = get_user_organization_id()
    AND cash_book_id IN (
      SELECT id FROM public.cash_books
      WHERE site_id = ANY (get_user_site_ids())
        AND organization_id = get_user_organization_id()
    )
  )
  WITH CHECK (
    get_user_role() = 'site_manager'
    AND organization_id = get_user_organization_id()
    AND cash_book_id IN (
      SELECT id FROM public.cash_books
      WHERE site_id = ANY (get_user_site_ids())
        AND organization_id = get_user_organization_id()
    )
  );

DROP POLICY IF EXISTS cashentries_employee ON public.cash_entries;
DROP POLICY IF EXISTS cashentries_employee_select ON public.cash_entries;
DROP POLICY IF EXISTS cashentries_employee_insert ON public.cash_entries;
DROP POLICY IF EXISTS cashentries_employee_update ON public.cash_entries;

CREATE POLICY cashentries_employee_select ON public.cash_entries FOR SELECT TO authenticated
  USING (
    get_user_role() IN ('employee', 'site_employee')
    AND organization_id = get_user_organization_id()
    AND cash_book_id IN (
      SELECT id FROM public.cash_books
      WHERE site_id = ANY (get_user_site_ids())
        AND organization_id = get_user_organization_id()
    )
  );

CREATE POLICY cashentries_employee_insert ON public.cash_entries FOR INSERT TO authenticated
  WITH CHECK (
    get_user_role() IN ('employee', 'site_employee')
    AND organization_id = get_user_organization_id()
    AND cash_book_id IN (
      SELECT id FROM public.cash_books
      WHERE site_id = ANY (get_user_site_ids())
        AND organization_id = get_user_organization_id()
    )
  );

CREATE POLICY cashentries_employee_update ON public.cash_entries FOR UPDATE TO authenticated
  USING (
    get_user_role() IN ('employee', 'site_employee')
    AND organization_id = get_user_organization_id()
    AND created_by = auth.uid()
    AND cash_book_id IN (
      SELECT id FROM public.cash_books
      WHERE site_id = ANY (get_user_site_ids())
        AND organization_id = get_user_organization_id()
    )
  )
  WITH CHECK (
    get_user_role() IN ('employee', 'site_employee')
    AND organization_id = get_user_organization_id()
    AND created_by = auth.uid()
  );

-- Attendance
DROP POLICY IF EXISTS attendance_manager ON public.attendance;
CREATE POLICY attendance_manager ON public.attendance TO authenticated
  USING (
    get_user_role() = 'site_manager'
    AND organization_id = get_user_organization_id()
    AND employee_id IN (
      SELECT id FROM public.employees
      WHERE site_id = ANY (get_user_site_ids())
        AND organization_id = get_user_organization_id()
    )
  )
  WITH CHECK (
    get_user_role() = 'site_manager'
    AND organization_id = get_user_organization_id()
    AND employee_id IN (
      SELECT id FROM public.employees
      WHERE site_id = ANY (get_user_site_ids())
        AND organization_id = get_user_organization_id()
    )
  );

DROP POLICY IF EXISTS attendance_self_insert ON public.attendance;
CREATE POLICY attendance_self_insert ON public.attendance FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = get_user_organization_id()
    AND employee_id IN (SELECT id FROM public.employees WHERE user_id = auth.uid())
    AND att_date = CURRENT_DATE
  );

DROP POLICY IF EXISTS attendance_self_read ON public.attendance;
CREATE POLICY attendance_self_read ON public.attendance FOR SELECT TO authenticated
  USING (
    organization_id = get_user_organization_id()
    AND employee_id IN (SELECT id FROM public.employees WHERE user_id = auth.uid())
  );

-- Leave
DROP POLICY IF EXISTS leave_manager ON public.leave_applications;
CREATE POLICY leave_manager ON public.leave_applications TO authenticated
  USING (
    get_user_role() = 'site_manager'
    AND organization_id = get_user_organization_id()
    AND employee_id IN (
      SELECT id FROM public.employees
      WHERE site_id = ANY (get_user_site_ids())
        AND organization_id = get_user_organization_id()
    )
  )
  WITH CHECK (
    get_user_role() = 'site_manager'
    AND organization_id = get_user_organization_id()
    AND employee_id IN (
      SELECT id FROM public.employees
      WHERE site_id = ANY (get_user_site_ids())
        AND organization_id = get_user_organization_id()
    )
  );

DROP POLICY IF EXISTS leave_self_insert ON public.leave_applications;
CREATE POLICY leave_self_insert ON public.leave_applications FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = get_user_organization_id()
    AND employee_id IN (SELECT id FROM public.employees WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS leave_self_read ON public.leave_applications;
CREATE POLICY leave_self_read ON public.leave_applications FOR SELECT TO authenticated
  USING (
    organization_id = get_user_organization_id()
    AND employee_id IN (SELECT id FROM public.employees WHERE user_id = auth.uid())
  );

-- Payroll
DROP POLICY IF EXISTS payroll_runs_manager ON public.payroll_runs;
CREATE POLICY payroll_runs_manager ON public.payroll_runs TO authenticated
  USING (
    get_user_role() = 'site_manager'
    AND site_id = ANY (get_user_site_ids())
    AND organization_id = get_user_organization_id()
  )
  WITH CHECK (
    get_user_role() = 'site_manager'
    AND site_id = ANY (get_user_site_ids())
    AND organization_id = get_user_organization_id()
  );

DROP POLICY IF EXISTS payroll_lines_manager ON public.payroll_lines;
CREATE POLICY payroll_lines_manager ON public.payroll_lines TO authenticated
  USING (
    get_user_role() = 'site_manager'
    AND organization_id = get_user_organization_id()
    AND payroll_run_id IN (
      SELECT id FROM public.payroll_runs
      WHERE site_id = ANY (get_user_site_ids())
        AND organization_id = get_user_organization_id()
    )
  )
  WITH CHECK (
    get_user_role() = 'site_manager'
    AND organization_id = get_user_organization_id()
    AND payroll_run_id IN (
      SELECT id FROM public.payroll_runs
      WHERE site_id = ANY (get_user_site_ids())
        AND organization_id = get_user_organization_id()
    )
  );

-- ============================================================
-- P3.3: Additional indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_customers_org ON public.customers (organization_id);
CREATE INDEX IF NOT EXISTS idx_leave_applications_org_status
  ON public.leave_applications (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_leave_applications_employee_status
  ON public.leave_applications (employee_id, status);
CREATE INDEX IF NOT EXISTS idx_attendance_employee_date
  ON public.attendance (employee_id, att_date);
CREATE INDEX IF NOT EXISTS idx_trips_site_date
  ON public.trips (site_id, trip_date)
  WHERE active IS NOT FALSE;

COMMENT ON COLUMN public.trip_photos.organization_id IS
  'Phase 3 denorm from parent trip; stamped by set_child_organization_id; used by RLS and feature gates.';
