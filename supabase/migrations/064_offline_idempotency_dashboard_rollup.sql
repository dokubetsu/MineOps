-- ============================================================
-- 064 — Offline idempotency + dashboard day rollup + settle cash marker support
-- ============================================================

-- Client-generated idempotency keys for offline outbox flush retries
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS client_id text;

ALTER TABLE public.cash_entries
  ADD COLUMN IF NOT EXISTS client_id text;

COMMENT ON COLUMN public.trips.client_id IS
  'Optional offline/outbox idempotency key; unique per organization when set';
COMMENT ON COLUMN public.cash_entries.client_id IS
  'Optional offline/outbox idempotency key; unique per organization when set';

CREATE UNIQUE INDEX IF NOT EXISTS trips_org_client_id_uidx
  ON public.trips (organization_id, client_id)
  WHERE client_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS cash_entries_org_client_id_uidx
  ON public.cash_entries (organization_id, client_id)
  WHERE client_id IS NOT NULL;

-- Aggregate today’s trips per site without shipping every row to the browser
CREATE OR REPLACE FUNCTION public.dashboard_trip_day_rollup(
  p_site_ids uuid[],
  p_trip_date date
)
RETURNS TABLE (
  site_id uuid,
  trip_count bigint,
  material numeric,
  advance numeric,
  inward numeric,
  unsettled numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT
    t.site_id,
    count(*)::bigint AS trip_count,
    coalesce(sum(coalesce(t.cubic_capacity, 0)), 0)::numeric AS material,
    coalesce(sum(coalesce(t.advance_amount, 0)), 0)::numeric AS advance,
    coalesce(
      sum(coalesce(t.total_shipment_cost, t.trip_worth, 0)),
      0
    )::numeric AS inward,
    coalesce(
      sum(
        CASE
          WHEN t.settled IS TRUE THEN 0
          ELSE coalesce(t.total_shipment_cost, t.trip_worth, 0)
        END
      ),
      0
    )::numeric AS unsettled
  FROM public.trips t
  WHERE t.active IS TRUE
    AND t.trip_date = p_trip_date
    AND t.site_id = ANY (p_site_ids)
  GROUP BY t.site_id;
$$;

REVOKE ALL ON FUNCTION public.dashboard_trip_day_rollup(uuid[], date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dashboard_trip_day_rollup(uuid[], date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_trip_day_rollup(uuid[], date) TO service_role;

COMMENT ON FUNCTION public.dashboard_trip_day_rollup(uuid[], date) IS
  'Per-site trip aggregates for a calendar day (dashboard home rollup).';
