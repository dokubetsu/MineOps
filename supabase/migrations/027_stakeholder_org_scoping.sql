-- Migration 027: Add organization_id to stakeholder_site_access
-- Problem: No org column means cross-org stakeholder assignment is possible.
-- An admin could grant org B's stakeholder access to org A's site data.
-- Fix: Add org column, backfill, add validation trigger, update RLS.

-- ============================================================
-- Step 1: Add organization_id column with temporary default
-- ============================================================

ALTER TABLE public.stakeholder_site_access
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE RESTRICT;

-- ============================================================
-- Step 2: Backfill from sites table
-- ============================================================

UPDATE public.stakeholder_site_access ssa
SET organization_id = s.organization_id
FROM public.sites s
WHERE ssa.site_id = s.id
  AND ssa.organization_id IS NULL;

-- Set NOT NULL after backfill
ALTER TABLE public.stakeholder_site_access
  ALTER COLUMN organization_id SET NOT NULL;

-- ============================================================
-- Step 3: Auto-stamp trigger (reuse existing set_organization_id)
-- ============================================================

DROP TRIGGER IF EXISTS trg_stakeholder_access_set_org ON public.stakeholder_site_access;
CREATE TRIGGER trg_stakeholder_access_set_org
BEFORE INSERT ON public.stakeholder_site_access
FOR EACH ROW EXECUTE FUNCTION public.set_organization_id();

-- ============================================================
-- Step 4: Cross-org validation trigger
-- Validates: stakeholder's user_roles org = site's org = row's org
-- ============================================================

CREATE OR REPLACE FUNCTION public.check_stakeholder_org_match()
RETURNS trigger AS $$
DECLARE
  v_site_org uuid;
  v_stakeholder_org uuid;
BEGIN
  -- Get the site's organization
  SELECT organization_id INTO v_site_org
  FROM public.sites WHERE id = NEW.site_id;

  IF v_site_org IS NULL THEN
    RAISE EXCEPTION 'Site not found' USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- Get the stakeholder's organization (from their user_roles)
  SELECT organization_id INTO v_stakeholder_org
  FROM public.user_roles
  WHERE user_id = NEW.stakeholder_user_id
  LIMIT 1;

  -- Validate stakeholder belongs to same org as site
  IF v_stakeholder_org IS DISTINCT FROM v_site_org THEN
    RAISE EXCEPTION 'Stakeholder must belong to the same organization as the site'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Validate the row's organization_id matches
  IF NEW.organization_id IS DISTINCT FROM v_site_org THEN
    RAISE EXCEPTION 'organization_id must match site organization'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_stakeholder_org_match ON public.stakeholder_site_access;
CREATE TRIGGER trg_stakeholder_org_match
BEFORE INSERT OR UPDATE ON public.stakeholder_site_access
FOR EACH ROW EXECUTE FUNCTION public.check_stakeholder_org_match();

-- ============================================================
-- Step 5: Update RLS policy to also check organization_id
-- ============================================================

DROP POLICY IF EXISTS stakeholder_access_admin ON public.stakeholder_site_access;
CREATE POLICY stakeholder_access_admin ON public.stakeholder_site_access TO authenticated
  USING (
    get_user_role() = 'admin'
    AND site_id = ANY (get_org_site_ids())
    AND organization_id = get_user_organization_id()
  )
  WITH CHECK (
    get_user_role() = 'admin'
    AND site_id = ANY (get_org_site_ids())
    AND organization_id = get_user_organization_id()
  );

-- Self-read policy remains unchanged (stakeholder_user_id = auth.uid())
