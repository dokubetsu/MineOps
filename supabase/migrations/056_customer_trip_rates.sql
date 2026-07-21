-- Customer negotiated rates (field pricing: rate discussed with customer)
-- trip_rates: { "12WH": 1000, "10WH": 800, ... }  — ₹ per trip by vehicle type
-- default_trip_rate: fallback when type-specific rate missing

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS default_trip_rate numeric,
  ADD COLUMN IF NOT EXISTS trip_rates jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS notes text;

COMMENT ON COLUMN public.customers.default_trip_rate IS
  'Default ₹ per trip for this customer when type-specific rate absent';
COMMENT ON COLUMN public.customers.trip_rates IS
  'Map of vehicle_type → ₹ per trip, e.g. {"12WH":1000,"10WH":800}';

-- Ensure service_role / authenticated can use new columns (RLS already on table)
GRANT SELECT, INSERT, UPDATE ON public.customers TO authenticated;
GRANT ALL ON public.customers TO service_role;
