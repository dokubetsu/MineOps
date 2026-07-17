-- Migration 053: Explicit table privileges for Data API roles
--
-- Newer Supabase (local + cloud) does NOT auto-GRANT public tables to
-- anon / authenticated / service_role (config: auto_expose_new_tables unset).
-- service_role still bypasses RLS but needs table-level privileges.
--
-- Without this:
--   - Platform org create / seed / e2e global-setup fail with
--     "permission denied for table organizations|user_roles"
--   - Phase 5 multi-tenant unit tests cannot insert via service role

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Core tables: service_role full DML (control plane + admin APIs + tests)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Authenticated: DML where RLS allows (default for app users)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Anon: no table DML by default (login is Auth API only)
-- (intentionally no broad GRANT to anon)

-- Future tables created by postgres in public
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated;

-- Views
GRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role;
-- org_users already had selective grants; re-assert service + authenticated SELECT
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_schema = 'public' AND table_name = 'org_users'
  ) THEN
    GRANT SELECT ON public.org_users TO authenticated, service_role;
  END IF;
END $$;

COMMENT ON SCHEMA public IS
  'MineOps public schema. Table privileges for service_role/authenticated set in migration 053 (Supabase no longer auto-exposes).';
