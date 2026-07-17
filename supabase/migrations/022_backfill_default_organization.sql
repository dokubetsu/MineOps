-- Migration 022: Multi-tenant schema (step 2 of 3) — backfill + enforce
--
-- Assigns every existing site/user_role/vehicle/driver/contractor (all of
-- which predate organizations and so still have organization_id = NULL) to
-- one newly-created default organization, then makes organization_id
-- required everywhere it was just added. Idempotent — safe to re-run.
--
-- After this runs, rename the default org via:
--   update public.organizations set name = 'Your Actual Company Name'
--   where name = 'Default Organization (rename me)';

DO $$
DECLARE
  v_default_org_id uuid;
BEGIN
  SELECT id INTO v_default_org_id FROM public.organizations WHERE name = 'Default Organization (rename me)';

  IF v_default_org_id IS NULL THEN
    INSERT INTO public.organizations (name) VALUES ('Default Organization (rename me)')
    RETURNING id INTO v_default_org_id;
  END IF;

  UPDATE public.sites SET organization_id = v_default_org_id WHERE organization_id IS NULL;
  UPDATE public.user_roles SET organization_id = v_default_org_id WHERE organization_id IS NULL;
  UPDATE public.vehicles SET organization_id = v_default_org_id WHERE organization_id IS NULL;
  UPDATE public.drivers SET organization_id = v_default_org_id WHERE organization_id IS NULL;
  UPDATE public.transport_contractors SET organization_id = v_default_org_id WHERE organization_id IS NULL;
END $$;

ALTER TABLE public.sites ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.user_roles ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.vehicles ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.drivers ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.transport_contractors ALTER COLUMN organization_id SET NOT NULL;

-- check_last_admin_deletion() previously counted admins across the whole
-- database. Once a second organization exists, that global count means one
-- org's own last admin could be removed as long as *some other org* still
-- has an admin — the trigger would wrongly allow it. Scope the count to the
-- row's own organization.
CREATE OR REPLACE FUNCTION public.check_last_admin_deletion()
RETURNS trigger AS $$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.user_roles
  WHERE role = 'admin' AND organization_id = OLD.organization_id AND id <> OLD.id;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'Cannot remove this admin. At least one admin must exist per organization to prevent lockout.' USING ERRCODE = 'check_violation';
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
