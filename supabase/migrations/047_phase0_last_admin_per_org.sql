-- Migration 047: Phase 0 — last-admin protection scoped per organization
--
-- Problem: 011 added global check_last_admin / check_last_admin_update
-- (COUNT all admins DB-wide). 022 fixed check_last_admin_deletion() to be
-- per-org, but 013 dropped the only trigger that called that function.
-- Net: org A could remove its sole admin while org B still had admins.
--
-- Fix: rewrite the LIVE trigger functions to filter by organization_id,
-- and keep check_last_admin_deletion() aligned for consistency.

CREATE OR REPLACE FUNCTION public.check_last_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_remaining int;
BEGIN
  IF OLD.role = 'admin' THEN
    SELECT COUNT(*) INTO v_remaining
    FROM public.user_roles
    WHERE role = 'admin'
      AND organization_id = OLD.organization_id
      AND id <> OLD.id;

    IF v_remaining = 0 THEN
      RAISE EXCEPTION
        'Cannot remove the last admin for this organization. Promote another user to admin first.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_last_admin_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_remaining int;
BEGIN
  IF OLD.role = 'admin' AND NEW.role IS DISTINCT FROM 'admin' THEN
    SELECT COUNT(*) INTO v_remaining
    FROM public.user_roles
    WHERE role = 'admin'
      AND organization_id = OLD.organization_id
      AND id <> OLD.id;

    IF v_remaining = 0 THEN
      RAISE EXCEPTION
        'Cannot demote the last admin for this organization. Promote another user to admin first.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Align unused-but-historical function with the same per-org rule
CREATE OR REPLACE FUNCTION public.check_last_admin_deletion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  IF OLD.role = 'admin' THEN
    SELECT COUNT(*) INTO v_count
    FROM public.user_roles
    WHERE role = 'admin'
      AND organization_id = OLD.organization_id
      AND id <> OLD.id;

    IF v_count = 0 THEN
      RAISE EXCEPTION
        'Cannot remove this admin. At least one admin must exist per organization to prevent lockout.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN OLD;
END;
$$;

-- Ensure live triggers still point at the corrected functions
DROP TRIGGER IF EXISTS trg_check_last_admin ON public.user_roles;
CREATE TRIGGER trg_check_last_admin
  BEFORE DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.check_last_admin();

DROP TRIGGER IF EXISTS trg_check_last_admin_update ON public.user_roles;
CREATE TRIGGER trg_check_last_admin_update
  BEFORE UPDATE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.check_last_admin_update();

-- Ghost trigger from early schema — must stay dropped (013); do not re-create
DROP TRIGGER IF EXISTS trg_user_roles_last_admin ON public.user_roles;

COMMENT ON FUNCTION public.check_last_admin() IS
  'Phase 0 / 047: block DELETE of the last admin within the same organization_id.';
COMMENT ON FUNCTION public.check_last_admin_update() IS
  'Phase 0 / 047: block demotion of the last admin within the same organization_id.';
