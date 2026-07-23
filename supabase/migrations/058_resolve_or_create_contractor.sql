-- Migration 058: Allow field users to resolve/create transport contractors by name
-- Used when trip/cash forms accept free-text contractor (not only MDM dropdown).

CREATE OR REPLACE FUNCTION public.resolve_or_create_contractor(p_name text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org uuid;
  v_id uuid;
  v_name text;
  v_role text;
BEGIN
  v_name := nullif(btrim(p_name), '');
  IF v_name IS NULL THEN
    RETURN NULL;
  END IF;

  v_org := public.get_user_organization_id();
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'No organization for current user'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_role := public.get_user_role();
  IF v_role IS NULL OR v_role NOT IN ('admin', 'site_manager', 'employee', 'site_employee') THEN
    RAISE EXCEPTION 'Not allowed to resolve contractors'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Match existing (case-insensitive) in same org
  SELECT c.id INTO v_id
  FROM public.transport_contractors c
  WHERE c.organization_id = v_org
    AND lower(btrim(c.name)) = lower(v_name)
  ORDER BY c.active DESC NULLS LAST, c.created_at ASC NULLS LAST
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    UPDATE public.transport_contractors
    SET active = true
    WHERE id = v_id AND COALESCE(active, true) = false;
    RETURN v_id;
  END IF;

  INSERT INTO public.transport_contractors (name, organization_id, active)
  VALUES (v_name, v_org, true)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_or_create_contractor(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_or_create_contractor(text) TO service_role;

COMMENT ON FUNCTION public.resolve_or_create_contractor(text) IS
  'Find org contractor by name (ci) or create; for free-text trip/cash contractor fields.';

-- Field staff may insert contractors when not using the RPC (client fallback)
DROP POLICY IF EXISTS contractors_field_insert ON public.transport_contractors;
CREATE POLICY contractors_field_insert ON public.transport_contractors
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.get_user_organization_id()
    AND public.get_user_role() IN ('admin', 'site_manager', 'employee', 'site_employee')
  );
