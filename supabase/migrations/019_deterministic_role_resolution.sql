-- Migration 019: Make get_user_role() deterministic for users with multiple role rows
--
-- get_user_role() previously did `SELECT role ... LIMIT 1` with no ORDER BY.
-- Every RLS policy in this schema (sites, trips, attendance, payroll, etc.)
-- gates admin access on `get_user_role() = 'admin'`, so for any user who ever
-- ends up with more than one row in user_roles, which row Postgres happened
-- to return first was undefined — an admin who is also scoped as a
-- site_manager on a specific site could non-deterministically lose admin
-- access. This makes the priority explicit: admin > site_manager >
-- stakeholder, matching the priority already used in frontend/src/middleware.ts.

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS text AS $$
  SELECT role FROM public.user_roles
  WHERE user_id = auth.uid()
  ORDER BY CASE role
    WHEN 'admin' THEN 1
    WHEN 'site_manager' THEN 2
    WHEN 'stakeholder' THEN 3
    ELSE 4
  END
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp;
