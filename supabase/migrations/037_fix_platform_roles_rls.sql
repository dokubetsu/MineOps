-- Migration 037: Fix platform_roles RLS (avoid recursive policy) + ensure grants
--
-- The previous SELECT policy used EXISTS (SELECT … FROM platform_roles …)
-- which can recurse under RLS and fail to return the caller's own row.
-- Keep detection reliable via is_platform_owner() SECURITY DEFINER + simple self-read.

DROP POLICY IF EXISTS platform_roles_self_read ON public.platform_roles;

-- Any authenticated user can read THEIR OWN platform role row only
CREATE POLICY platform_roles_self_read ON public.platform_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Recreate helper with explicit grants (idempotent)
CREATE OR REPLACE FUNCTION public.is_platform_owner()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.platform_roles
    WHERE user_id = auth.uid()
      AND role = 'platform_owner'
  );
$$;

REVOKE ALL ON FUNCTION public.is_platform_owner() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_platform_owner() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_platform_owner() TO service_role;
GRANT EXECUTE ON FUNCTION public.is_platform_owner() TO anon;

-- Ensure table is exposed for authenticated SELECT under RLS
GRANT SELECT ON public.platform_roles TO authenticated;
GRANT SELECT ON public.platform_roles TO service_role;
