-- Migration 045: Phase E — hardening polish
--
-- E1  write_audit_event: bind organization_id to actor org only (no cross-org spoof)
-- E2  Re-assert storage.buckets file_size_limit = 5MB on app buckets
-- E3  Employee/site_employee trip-photo read/write parity (my-work uploads)
-- E6  Per-org vehicle plate uniqueness (drop global UNIQUE on plate_number)
--
-- E4 CSP nonce + E5 Upstash rate limit are frontend/docs (not this migration).

-- ============================================================
-- E1: write_audit_event — actor-org binding
-- ============================================================
-- Authenticated tenants must not pass a foreign p_organization_id.
-- Platform owners and service_role may stamp an explicit org (control plane).

CREATE OR REPLACE FUNCTION public.write_audit_event(
  p_action text,
  p_target_type text,
  p_target_id text,
  p_organization_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor uuid;
  v_org uuid;
  v_actor_org uuid;
  v_role text;
  v_meta jsonb;
BEGIN
  v_actor := auth.uid();
  v_role := coalesce(auth.role(), '');
  v_meta := COALESCE(p_metadata, '{}'::jsonb);

  -- service_role (API routes / migrations): trust explicit org
  IF v_role = 'service_role' THEN
    v_org := p_organization_id;
    IF v_org IS NULL THEN
      RETURN;
    END IF;
    -- Actor may be null when pure service key; store null actor
    INSERT INTO public.audit_logs (
      organization_id, actor_user_id, action, target_type, target_id, metadata
    ) VALUES (
      v_org, v_actor, p_action, p_target_type, p_target_id, v_meta
    );
    RETURN;
  END IF;

  IF v_actor IS NULL THEN
    RETURN;
  END IF;

  v_actor_org := public.get_user_organization_id();

  -- Platform owner may audit any org (console actions)
  IF public.is_platform_owner() THEN
    v_org := COALESCE(p_organization_id, v_actor_org);
    IF v_org IS NULL THEN
      RETURN;
    END IF;
  ELSE
    -- Tenant callers: always stamp the actor's org
    v_org := v_actor_org;
    IF v_org IS NULL THEN
      RETURN;
    END IF;
    IF p_organization_id IS NOT NULL AND p_organization_id IS DISTINCT FROM v_org THEN
      v_meta := v_meta || jsonb_build_object(
        'ignored_foreign_organization_id', p_organization_id
      );
    END IF;
  END IF;

  INSERT INTO public.audit_logs (
    organization_id,
    actor_user_id,
    action,
    target_type,
    target_id,
    metadata
  ) VALUES (
    v_org,
    v_actor,
    p_action,
    p_target_type,
    p_target_id,
    v_meta
  );
END;
$$;

-- Direct client calls should not invent audit rows in other orgs.
-- SECURITY DEFINER RPCs/triggers still invoke this as the function owner.
REVOKE ALL ON FUNCTION public.write_audit_event(text, text, text, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.write_audit_event(text, text, text, uuid, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.write_audit_event(text, text, text, uuid, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.write_audit_event(text, text, text, uuid, jsonb) TO service_role;
-- Nested calls from SECURITY DEFINER RPCs (owner) do not need authenticated GRANT.
-- Explicit postgres grant for Supabase SQL owners that are not superuser for all objects.
DO $$
BEGIN
  GRANT EXECUTE ON FUNCTION public.write_audit_event(text, text, text, uuid, jsonb) TO postgres;
EXCEPTION
  WHEN undefined_object THEN NULL; -- role missing in some local images
END $$;

COMMENT ON FUNCTION public.write_audit_event(text, text, text, uuid, jsonb) IS
  'Phase E: audit rows bound to actor org (tenant) or explicit org (platform/service_role). Not callable by authenticated clients.';

-- ============================================================
-- E2: Storage 5MB hard limit on buckets
-- ============================================================
-- Policy metadata size checks are unreliable; bucket file_size_limit is enforced by Storage.

UPDATE storage.buckets
SET file_size_limit = 5242880
WHERE id IN ('trip-photos', 'attendance-photos', 'cash-receipts');

-- ============================================================
-- E3: Employee trip-photo policies (parity with cash-receipts / my-work)
-- Path: {site_id}/...
-- ============================================================

DROP POLICY IF EXISTS "Trip photos read access" ON storage.objects;
CREATE POLICY "Trip photos read access" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'trip-photos' AND (
      (get_user_role() = 'admin' AND (string_to_array(name, '/'))[1]::uuid = ANY (get_org_site_ids())) OR
      (get_user_role() = 'site_manager' AND (string_to_array(name, '/'))[1]::uuid = ANY (get_user_site_ids())) OR
      (get_user_role() IN ('employee', 'site_employee') AND (string_to_array(name, '/'))[1]::uuid = ANY (get_user_site_ids())) OR
      (get_user_role() = 'stakeholder' AND (string_to_array(name, '/'))[1]::uuid IN (
        SELECT site_id FROM public.stakeholder_site_access WHERE stakeholder_user_id = auth.uid()
      ))
    )
  );

DROP POLICY IF EXISTS "Trip photos write access" ON storage.objects;
CREATE POLICY "Trip photos write access" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'trip-photos' AND (
      (get_user_role() = 'admin' AND (string_to_array(name, '/'))[1]::uuid = ANY (get_org_site_ids())) OR
      (get_user_role() = 'site_manager' AND (string_to_array(name, '/'))[1]::uuid = ANY (get_user_site_ids())) OR
      (get_user_role() IN ('employee', 'site_employee') AND (string_to_array(name, '/'))[1]::uuid = ANY (get_user_site_ids()))
    )
  );

-- upsert: true on client needs UPDATE
DROP POLICY IF EXISTS "Trip photos update access" ON storage.objects;
CREATE POLICY "Trip photos update access" ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'trip-photos' AND (
      (get_user_role() = 'admin' AND (string_to_array(name, '/'))[1]::uuid = ANY (get_org_site_ids())) OR
      (get_user_role() = 'site_manager' AND (string_to_array(name, '/'))[1]::uuid = ANY (get_user_site_ids())) OR
      (get_user_role() IN ('employee', 'site_employee') AND (string_to_array(name, '/'))[1]::uuid = ANY (get_user_site_ids()))
    )
  )
  WITH CHECK (
    bucket_id = 'trip-photos' AND (
      (get_user_role() = 'admin' AND (string_to_array(name, '/'))[1]::uuid = ANY (get_org_site_ids())) OR
      (get_user_role() = 'site_manager' AND (string_to_array(name, '/'))[1]::uuid = ANY (get_user_site_ids())) OR
      (get_user_role() IN ('employee', 'site_employee') AND (string_to_array(name, '/'))[1]::uuid = ANY (get_user_site_ids()))
    )
  );

DROP POLICY IF EXISTS "Trip photos delete access" ON storage.objects;
CREATE POLICY "Trip photos delete access" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'trip-photos' AND (
      (get_user_role() = 'admin' AND (string_to_array(name, '/'))[1]::uuid = ANY (get_org_site_ids())) OR
      (get_user_role() = 'site_manager' AND (string_to_array(name, '/'))[1]::uuid = ANY (get_user_site_ids()))
      -- Employees: no delete (soft retention); managers/admin can clean up
    )
  );

-- ============================================================
-- E6: Per-org vehicle plate uniqueness
-- ============================================================
-- Global UNIQUE(plate_number) blocks two tenants from sharing a plate string.
-- Scope uniqueness to (organization_id, plate_number).

DO $$
DECLARE
  r record;
BEGIN
  -- Drop any unique constraint solely on plate_number
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'vehicles'
      AND c.contype = 'u'
      AND pg_get_constraintdef(c.oid) ~* 'plate_number'
      AND pg_get_constraintdef(c.oid) !~* 'organization_id'
  LOOP
    EXECUTE format('ALTER TABLE public.vehicles DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;

  -- Drop legacy unique indexes on plate_number alone
  FOR r IN
    SELECT i.relname AS index_name
    FROM pg_index x
    JOIN pg_class t ON t.oid = x.indrelid
    JOIN pg_class i ON i.oid = x.indexrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (x.indkey)
    WHERE n.nspname = 'public'
      AND t.relname = 'vehicles'
      AND x.indisunique
      AND NOT x.indisprimary
      AND a.attname = 'plate_number'
      AND (
        SELECT count(*) FROM unnest(x.indkey) AS k(attnum)
        WHERE attnum > 0
      ) = 1
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS public.%I', r.index_name);
  END LOOP;
END $$;

-- Require organization_id for uniqueness (already NOT NULL after multi-tenant migrations)
CREATE UNIQUE INDEX IF NOT EXISTS vehicles_organization_id_plate_number_key
  ON public.vehicles (organization_id, plate_number);

COMMENT ON INDEX public.vehicles_organization_id_plate_number_key IS
  'Phase E: plate numbers unique per organization, not globally';
