-- Migration 030: Enforce single-org-per-user + atomic register_tenant RPC
-- 
-- Part A: Prevent a user from having roles in multiple organizations.
-- Problem: get_user_organization_id() returns the highest-priority role's org.
-- If a user has roles in two orgs, they silently lose access to the lower one.
--
-- Part B: Atomic tenant registration RPC.
-- Problem: register-tenant route does 3 separate DB operations with manual rollback.
-- Fix: Wrap org + role inserts in a single Postgres function (atomic transaction).

-- ============================================================
-- Part A: Single-org-per-user enforcement
-- ============================================================

CREATE OR REPLACE FUNCTION public.check_user_single_org()
RETURNS trigger AS $$
DECLARE
  v_existing_org uuid;
BEGIN
  -- Check if the user already has a role in a different org
  SELECT organization_id INTO v_existing_org
  FROM public.user_roles
  WHERE user_id = NEW.user_id
    AND id IS DISTINCT FROM NEW.id
    AND organization_id IS DISTINCT FROM NEW.organization_id
  LIMIT 1;

  IF v_existing_org IS NOT NULL THEN
    RAISE EXCEPTION 'User already belongs to organization %. A user cannot have roles in multiple organizations.'
      , v_existing_org
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_user_single_org ON public.user_roles;
CREATE TRIGGER trg_user_single_org
BEFORE INSERT OR UPDATE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.check_user_single_org();

-- ============================================================
-- Part B: Atomic tenant registration RPC
-- ============================================================

-- This function is called from the register-tenant API route.
-- It atomically creates an organization and assigns the admin role.
-- If either operation fails, the entire transaction rolls back.
-- The auth user must be created BEFORE calling this function.

CREATE OR REPLACE FUNCTION public.register_tenant(
  p_company_name text,
  p_user_id uuid
)
RETURNS uuid AS $$
DECLARE
  v_org_id uuid;
BEGIN
  -- Validate inputs
  IF p_company_name IS NULL OR length(trim(p_company_name)) < 2 THEN
    RAISE EXCEPTION 'Company name must be at least 2 characters' USING ERRCODE = 'check_violation';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'User ID is required' USING ERRCODE = 'check_violation';
  END IF;

  -- Step 1: Create the organization
  INSERT INTO public.organizations (name, active)
  VALUES (trim(p_company_name), true)
  RETURNING id INTO v_org_id;

  -- Step 2: Assign admin role (atomic with org creation)
  INSERT INTO public.user_roles (user_id, role, site_id, organization_id)
  VALUES (p_user_id, 'admin', NULL, v_org_id);

  RETURN v_org_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
