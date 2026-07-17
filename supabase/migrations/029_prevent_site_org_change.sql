-- Migration 029: Prevent site organization_id change after creation
-- Problem: sites_admin_all RLS policy allows admin to UPDATE organization_id.
-- Changing a site's org silently orphans all child user_roles, employees,
-- trips, attendance, etc. from their correct org scope.
-- Fix: Trigger prevents any UPDATE to sites.organization_id.

CREATE OR REPLACE FUNCTION public.prevent_site_org_change()
RETURNS trigger AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'Cannot change site organization_id after creation. Delete and recreate the site instead.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_site_org_change ON public.sites;
CREATE TRIGGER trg_prevent_site_org_change
BEFORE UPDATE OF organization_id ON public.sites
FOR EACH ROW EXECUTE FUNCTION public.prevent_site_org_change();
