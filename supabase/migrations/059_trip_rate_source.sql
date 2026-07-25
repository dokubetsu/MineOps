-- Track which rate tier was used for each trip's pricing
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS rate_source text
  CHECK (rate_source IN ('customer_type', 'customer_default', 'vehicle_type', 'manual'));

COMMENT ON COLUMN public.trips.rate_source IS
  'Source of ₹/m³ rate used to compute trip_worth: customer_type, customer_default, vehicle_type, or manual';
