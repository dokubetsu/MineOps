-- ============================================================
-- 062 — Pre-handover hardening
-- 1) Trip cost: when rate_source is MDM (non-manual), always
--    trip_worth = rate_per_cubic × cubic_capacity
-- 2) Site employees cannot override MDM rates / worth
-- 3) service_role may soft-delete cash entries on locked books
--    (needed for admin period purge)
-- ============================================================

-- Force MDM pricing on trips (customer/org negotiated rate × CC)
CREATE OR REPLACE FUNCTION public.normalize_trip_worth()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text;
BEGIN
  -- MDM rates: total cost is always rate × cubic capacity (never raw ₹/m³)
  IF NEW.rate_per_cubic IS NOT NULL
     AND NEW.cubic_capacity IS NOT NULL
     AND COALESCE(NEW.rate_source, 'manual') <> 'manual'
  THEN
    NEW.trip_worth := round(
      ((COALESCE(NEW.rate_per_cubic, 0) * COALESCE(NEW.cubic_capacity, 0)) + 1e-9)::numeric,
      2
    );
    NEW.total_shipment_cost := NEW.trip_worth;
  ELSIF TG_OP = 'UPDATE'
     AND (
       NEW.cubic_capacity IS DISTINCT FROM OLD.cubic_capacity
       OR NEW.rate_per_cubic IS DISTINCT FROM OLD.rate_per_cubic
     )
     AND NEW.rate_per_cubic IS NOT NULL
     AND NEW.cubic_capacity IS NOT NULL
     AND (
       NEW.trip_worth IS NULL
       OR NEW.trip_worth IS NOT DISTINCT FROM OLD.trip_worth
     )
  THEN
    NEW.trip_worth := round(
      ((COALESCE(NEW.rate_per_cubic, 0) * COALESCE(NEW.cubic_capacity, 0)) + 1e-9)::numeric,
      2
    );
  ELSIF TG_OP = 'INSERT'
     AND NEW.trip_worth IS NULL
     AND NEW.rate_per_cubic IS NOT NULL
     AND NEW.cubic_capacity IS NOT NULL
  THEN
    NEW.trip_worth := round(
      ((COALESCE(NEW.rate_per_cubic, 0) * COALESCE(NEW.cubic_capacity, 0)) + 1e-9)::numeric,
      2
    );
  END IF;

  IF NEW.trip_worth IS NOT NULL THEN
    NEW.trip_worth := round((NEW.trip_worth + 1e-9)::numeric, 2);
  END IF;
  IF NEW.total_shipment_cost IS NOT NULL THEN
    NEW.total_shipment_cost := round((NEW.total_shipment_cost + 1e-9)::numeric, 2);
  ELSIF NEW.trip_worth IS NOT NULL THEN
    NEW.total_shipment_cost := NEW.trip_worth;
  END IF;

  -- Employees cannot escape MDM pricing by switching to manual or rewriting amounts
  v_role := public.get_user_role();
  IF v_role IN ('employee', 'site_employee') AND TG_OP = 'UPDATE' THEN
    IF OLD.rate_source IS NOT NULL AND OLD.rate_source <> 'manual' THEN
      IF NEW.rate_source IS DISTINCT FROM OLD.rate_source
         OR NEW.rate_per_cubic IS DISTINCT FROM OLD.rate_per_cubic
      THEN
        RAISE EXCEPTION 'Site employees cannot override negotiated trip rates'
          USING ERRCODE = 'check_violation';
      END IF;
      -- Worth must stay rate × CC (already forced above); reject any other drift
      IF NEW.trip_worth IS DISTINCT FROM round(
           ((COALESCE(NEW.rate_per_cubic, 0) * COALESCE(NEW.cubic_capacity, 0)) + 1e-9)::numeric,
           2
         )
      THEN
        NEW.trip_worth := round(
          ((COALESCE(NEW.rate_per_cubic, 0) * COALESCE(NEW.cubic_capacity, 0)) + 1e-9)::numeric,
          2
        );
        NEW.total_shipment_cost := NEW.trip_worth;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_trip_worth ON public.trips;
CREATE TRIGGER trg_normalize_trip_worth
  BEFORE INSERT OR UPDATE OF trip_worth, total_shipment_cost, cubic_capacity, rate_per_cubic, rate_source
  ON public.trips
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_trip_worth();

COMMENT ON FUNCTION public.normalize_trip_worth() IS
  'MDM pricing: non-manual rate_source ⇒ trip_worth = rate_per_cubic × cubic_capacity; employees cannot override.';

-- Allow service_role period purge to soft-delete entries on locked cash books.
-- Tenant clients (authenticated) remain blocked when locked.
CREATE OR REPLACE FUNCTION public.check_cash_book_not_locked()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status text;
  v_book_id uuid;
BEGIN
  -- Admin period-ops uses service_role; bypass lock for that path only.
  IF auth.role() = 'service_role' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_book_id := OLD.cash_book_id;
  ELSE
    v_book_id := NEW.cash_book_id;
  END IF;

  SELECT status INTO v_status FROM public.cash_books WHERE id = v_book_id;

  IF v_status = 'locked' THEN
    RAISE EXCEPTION 'Cannot modify cash entries for a locked cash book'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
