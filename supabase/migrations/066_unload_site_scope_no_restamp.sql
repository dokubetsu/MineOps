-- ============================================================
-- 066 — Tighten unload: site scope + no clerk re-stamp
-- ============================================================

CREATE OR REPLACE FUNCTION public.document_trip_unload(
  p_trip_id uuid,
  p_unload_notes text DEFAULT NULL,
  p_unload_quantity numeric DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
  v_org uuid;
  v_sites uuid[];
  v_trip_site uuid;
  v_trip_org uuid;
  v_unloaded_at timestamptz;
BEGIN
  v_role := public.get_user_role();
  v_org := public.get_user_organization_id();
  v_sites := public.get_user_site_ids();

  IF v_role IS NULL OR v_org IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_role NOT IN ('admin', 'unload_clerk') THEN
    RAISE EXCEPTION 'Only admin or unload clerk can document unload'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT site_id, organization_id, unloaded_at
  INTO v_trip_site, v_trip_org, v_unloaded_at
  FROM public.trips
  WHERE id = p_trip_id AND active IS TRUE;

  IF v_trip_site IS NULL THEN
    RAISE EXCEPTION 'Trip not found' USING ERRCODE = 'no_data_found';
  END IF;

  IF v_trip_org IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'Trip not in your organization' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Unload clerks only document trips for their assigned site(s)
  IF v_role = 'unload_clerk' THEN
    IF v_sites IS NULL OR cardinality(v_sites) = 0 OR NOT (v_trip_site = ANY (v_sites)) THEN
      RAISE EXCEPTION 'Unload clerk can only document trips for an assigned site'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- Clerks cannot overwrite an existing unload; admin may correct
    IF v_unloaded_at IS NOT NULL THEN
      RAISE EXCEPTION 'Trip already documented as unloaded; ask an admin to correct it'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  UPDATE public.trips
  SET
    unloaded_at = now(),
    unloaded_by = auth.uid(),
    unload_notes = NULLIF(trim(COALESCE(p_unload_notes, '')), ''),
    unload_quantity = p_unload_quantity,
    updated_at = now()
  WHERE id = p_trip_id;
END;
$$;

COMMENT ON FUNCTION public.document_trip_unload(uuid, text, numeric) IS
  'Unload documentation: unload_clerk site-scoped, no re-stamp; admin may overwrite.';

-- Site-scoped SELECT for unload clerks (replaces org-wide policy)
DROP POLICY IF EXISTS trips_unload_clerk_select ON public.trips;
CREATE POLICY trips_unload_clerk_select ON public.trips
  FOR SELECT TO authenticated
  USING (
    get_user_role() = 'unload_clerk'
    AND organization_id = get_user_organization_id()
    AND site_id = ANY (get_user_site_ids())
  );
