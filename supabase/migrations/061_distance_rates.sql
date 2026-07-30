-- Migration 061: Per-vehicle-type distance rate (₹/km) and calculated distance cost

-- 1. Add rate_per_km column to negotiated_rates
ALTER TABLE public.negotiated_rates
  ADD COLUMN IF NOT EXISTS rate_per_km numeric DEFAULT 0.0;

COMMENT ON COLUMN public.negotiated_rates.rate_per_km IS
  'Rate per kilometer for vehicle type (e.g. 12WH = 200, 10WH = 150)';

-- 2. Add rate_per_km and distance_cost columns to trips
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS rate_per_km numeric,
  ADD COLUMN IF NOT EXISTS distance_cost numeric;

COMMENT ON COLUMN public.trips.rate_per_km IS
  'Snapshotted ₹/km rate for vehicle type at trip log time';

COMMENT ON COLUMN public.trips.distance_cost IS
  'Calculated distance cost: rate_per_km * distance_km';
