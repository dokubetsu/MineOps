-- Migration 035: Fix org_users API access + harden attendance org stamping
--
-- Production issues:
-- 1) GET /api/admin/list-users → 500 on public.org_users
--    (auth.users join + security_invoker / missing GRANTs)
-- 2) Attendance upsert fails: organization_id NOT NULL + admin RLS WITH CHECK

-- ============================================================
-- Part A: org_users view grants + owner-privilege read of auth.users
-- ============================================================

CREATE OR REPLACE VIEW public.org_users
WITH (security_invoker = false)
AS
SELECT
  u.id,
  u.email,
  u.created_at,
  ur.role,
  ur.site_id,
  ur.organization_id
FROM auth.users u
JOIN public.user_roles ur ON u.id = ur.user_id;

GRANT SELECT ON public.org_users TO authenticated;
GRANT SELECT ON public.org_users TO service_role;

COMMENT ON VIEW public.org_users IS
  'Org-scoped user directory (auth.users ⋈ user_roles). Filter by organization_id in API routes.';

-- ============================================================
-- Part B: Harden set_child_organization_id for attendance
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
  IF NEW.organization_id IS NULL THEN
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
    ELSIF TG_TABLE_NAME = 'payroll_runs' THEN
      SELECT organization_id INTO v_org_id FROM public.sites WHERE id = NEW.site_id;
    ELSIF TG_TABLE_NAME = 'payroll_lines' THEN
      SELECT organization_id INTO v_org_id FROM public.payroll_runs WHERE id = NEW.payroll_run_id;
    END IF;
    NEW.organization_id := v_org_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_set_org ON public.attendance;
CREATE TRIGGER trg_attendance_set_org
BEFORE INSERT OR UPDATE ON public.attendance
FOR EACH ROW EXECUTE FUNCTION public.set_child_organization_id();

-- Backfill null organization_id on attendance
UPDATE public.attendance a
SET organization_id = e.organization_id
FROM public.employees e
WHERE a.employee_id = e.id
  AND a.organization_id IS NULL
  AND e.organization_id IS NOT NULL;

UPDATE public.attendance a
SET organization_id = s.organization_id
FROM public.employees e
JOIN public.sites s ON s.id = e.site_id
WHERE a.employee_id = e.id
  AND a.organization_id IS NULL
  AND s.organization_id IS NOT NULL;

-- ============================================================
-- Part C: Clear attendance policies for admin + site_manager
-- ============================================================

DROP POLICY IF EXISTS attendance_admin ON public.attendance;
CREATE POLICY attendance_admin ON public.attendance TO authenticated
  USING (
    get_user_role() = 'admin'
    AND organization_id = get_user_organization_id()
  )
  WITH CHECK (
    get_user_role() = 'admin'
    AND organization_id = get_user_organization_id()
  );

DROP POLICY IF EXISTS attendance_manager ON public.attendance;
CREATE POLICY attendance_manager ON public.attendance TO authenticated
  USING (
    get_user_role() = 'site_manager'
    AND employee_id IN (
      SELECT id FROM public.employees WHERE site_id = ANY (get_user_site_ids())
    )
  )
  WITH CHECK (
    get_user_role() = 'site_manager'
    AND employee_id IN (
      SELECT id FROM public.employees WHERE site_id = ANY (get_user_site_ids())
    )
    AND organization_id = get_user_organization_id()
  );
