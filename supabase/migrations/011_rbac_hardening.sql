-- Migration 011: RBAC Hardening
-- 1. Fix get_user_role() — deterministic priority ordering + SECURITY DEFINER
-- 2. Fix get_user_site_ids() — SECURITY DEFINER + search_path lock
-- 3. Add last-admin protection trigger

-- ─── 1. get_user_role() with priority: admin > site_manager > stakeholder ───
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT role
  FROM public.user_roles
  WHERE user_id = auth.uid()
  ORDER BY
    CASE role
      WHEN 'admin'        THEN 1
      WHEN 'site_manager' THEN 2
      WHEN 'stakeholder'  THEN 3
      ELSE 99
    END
  LIMIT 1;
$$;

-- ─── 2. get_user_site_ids() — SECURITY DEFINER + search_path lock ────────────
CREATE OR REPLACE FUNCTION public.get_user_site_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT ARRAY(
    SELECT site_id
    FROM public.user_roles
    WHERE user_id = auth.uid()
      AND site_id IS NOT NULL
  );
$$;

-- ─── 3. Last-admin protection ─────────────────────────────────────────────────
-- Prevents deleting or demoting the very last admin row, locking everyone out.
CREATE OR REPLACE FUNCTION public.check_last_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_remaining int;
BEGIN
  -- Only care about admin rows being removed
  IF OLD.role = 'admin' THEN
    SELECT COUNT(*) INTO v_remaining
    FROM public.user_roles
    WHERE role = 'admin'
      AND id != OLD.id;   -- exclude the row being deleted/updated

    IF v_remaining = 0 THEN
      RAISE EXCEPTION 'Cannot remove the last admin. Promote another user to admin first.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_last_admin ON public.user_roles;
CREATE TRIGGER trg_check_last_admin
  BEFORE DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.check_last_admin();

-- Also block UPDATE that changes an admin row to a non-admin role
CREATE OR REPLACE FUNCTION public.check_last_admin_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_remaining int;
BEGIN
  IF OLD.role = 'admin' AND NEW.role != 'admin' THEN
    SELECT COUNT(*) INTO v_remaining
    FROM public.user_roles
    WHERE role = 'admin'
      AND id != OLD.id;

    IF v_remaining = 0 THEN
      RAISE EXCEPTION 'Cannot demote the last admin. Promote another user to admin first.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_last_admin_update ON public.user_roles;
CREATE TRIGGER trg_check_last_admin_update
  BEFORE UPDATE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.check_last_admin_update();
