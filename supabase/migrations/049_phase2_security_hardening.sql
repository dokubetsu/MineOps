-- Migration 049: Phase 2 — security hardening
--
-- P2.1 Tenant org UPDATE: name only; active only platform/service
-- P2.3 user_roles: no authenticated INSERT (provision via service_role RPC only)
-- P2.6 Storage buckets: image MIME allowlist + re-assert 5MB limit

-- ============================================================
-- P2.1: Protect organizations.active (and id) from tenant admins
-- ============================================================
-- Platform PATCH / service_role may still set active.
-- Tenant settings UI only renames; this blocks active self-DoS / self-reactivate.

CREATE OR REPLACE FUNCTION public.protect_organization_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF coalesce(auth.role(), '') = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF public.is_platform_owner() THEN
    RETURN NEW;
  END IF;

  -- Tenant callers (admin RLS) may not flip active or change id
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'organization id is immutable'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.active IS DISTINCT FROM OLD.active THEN
    RAISE EXCEPTION
      'Only platform operators can activate or deactivate an organization'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Force active stable even if client spoofs other paths
  NEW.active := OLD.active;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_organization_columns ON public.organizations;
CREATE TRIGGER trg_protect_organization_columns
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_organization_columns();

COMMENT ON FUNCTION public.protect_organization_columns() IS
  'Phase 2: tenant admins may rename org; active is platform/service only.';

-- ============================================================
-- P2.3: Split user_roles RLS — no authenticated INSERT
-- ============================================================
-- Prevents tenant admin from binding arbitrary orphan Auth user_ids into
-- their org. New memberships only via provision_user_access (service_role).
-- Admins retain SELECT / UPDATE / DELETE within their organization.

DROP POLICY IF EXISTS user_roles_admin ON public.user_roles;
DROP POLICY IF EXISTS user_roles_admin_select ON public.user_roles;
DROP POLICY IF EXISTS user_roles_admin_update ON public.user_roles;
DROP POLICY IF EXISTS user_roles_admin_delete ON public.user_roles;
DROP POLICY IF EXISTS user_roles_admin_insert ON public.user_roles;

CREATE POLICY user_roles_admin_select ON public.user_roles
  FOR SELECT TO authenticated
  USING (
    get_user_role() = 'admin'
    AND organization_id = get_user_organization_id()
  );

CREATE POLICY user_roles_admin_update ON public.user_roles
  FOR UPDATE TO authenticated
  USING (
    get_user_role() = 'admin'
    AND organization_id = get_user_organization_id()
  )
  WITH CHECK (
    get_user_role() = 'admin'
    AND organization_id = get_user_organization_id()
  );

CREATE POLICY user_roles_admin_delete ON public.user_roles
  FOR DELETE TO authenticated
  USING (
    get_user_role() = 'admin'
    AND organization_id = get_user_organization_id()
  );

-- Intentionally NO INSERT policy for authenticated.
-- service_role bypasses RLS (create-user / platform admins / provision_user_access).

COMMENT ON TABLE public.user_roles IS
  'Tenant RBAC. INSERT only via service_role (provision_user_access / platform APIs). Admins may SELECT/UPDATE/DELETE in their org.';

-- ============================================================
-- P2.6: Storage MIME allowlist (images only) + 5MB
-- ============================================================

UPDATE storage.buckets
SET
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY[
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif'
  ]
WHERE id IN ('trip-photos', 'attendance-photos', 'cash-receipts');
