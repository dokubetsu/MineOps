-- Migration 021: Multi-tenant schema (step 1 of 3) — additive only
--
-- Introduces organizations as the tenant boundary. This migration only adds
-- new, nullable structure and two read-only helper functions — it does not
-- change any existing table's RLS policy and enforces nothing yet, so it is
-- safe to run against a live database with existing customer data with zero
-- downtime or behavior change.
--
-- Sequence: 021 (this file, additive) -> 022 (backfill existing data into a
-- default org + enforce NOT NULL) -> 023 (switch every other table's RLS
-- over to be org-scoped). Do not run 023 before 022 has completed, or every
-- admin policy will start evaluating organization_id as NULL and deny access.

CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE RESTRICT;

ALTER TABLE public.user_roles
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE RESTRICT;

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE RESTRICT;

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE RESTRICT;

ALTER TABLE public.transport_contractors
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_sites_org ON public.sites (organization_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_org ON public.user_roles (organization_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_org ON public.vehicles (organization_id);
CREATE INDEX IF NOT EXISTS idx_drivers_org ON public.drivers (organization_id);
CREATE INDEX IF NOT EXISTS idx_transport_contractors_org ON public.transport_contractors (organization_id);

-- Deterministic priority (admin > site_manager > stakeholder), same pattern
-- as get_user_role() / get_user_site_ids() — a user is assumed to belong to
-- exactly one organization.
CREATE OR REPLACE FUNCTION public.get_user_organization_id()
RETURNS uuid AS $$
  SELECT organization_id FROM public.user_roles
  WHERE user_id = auth.uid()
  ORDER BY CASE role
    WHEN 'admin' THEN 1
    WHEN 'site_manager' THEN 2
    WHEN 'stakeholder' THEN 3
    ELSE 4
  END
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp;

-- All site ids belonging to the caller's organization — used by *_admin
-- policies so "admin" means "admin of my org", not "admin of every site in
-- the database". Distinct from get_user_site_ids(), which is only the sites
-- a site_manager/stakeholder is individually assigned to.
CREATE OR REPLACE FUNCTION public.get_org_site_ids()
RETURNS uuid[] AS $$
  SELECT ARRAY(
    SELECT id FROM public.sites WHERE organization_id = public.get_user_organization_id()
  );
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp;

-- Every authenticated user can see their own organization's name (used to
-- show which company's account you're in); only that org's own admin can
-- rename/update it. Nobody can list or create other organizations from the
-- client — provisioning a new tenant is a deliberate service-role operation
-- (see docs/vercel_deployment_guide.md).
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY organizations_self_read ON public.organizations FOR SELECT TO authenticated
  USING (id = get_user_organization_id());
CREATE POLICY organizations_self_admin_update ON public.organizations FOR UPDATE TO authenticated
  USING (get_user_role() = 'admin' AND id = get_user_organization_id())
  WITH CHECK (get_user_role() = 'admin' AND id = get_user_organization_id());
