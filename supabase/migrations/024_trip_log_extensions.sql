-- Migration 024: Expanded trip logs, customers, negotiated rates, and employee role

-- 1. Alter user_roles check constraint to support 'employee' role
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_role_check;
ALTER TABLE public.user_roles ADD CONSTRAINT chk_user_roles_role CHECK (role IN ('admin', 'site_manager', 'stakeholder', 'employee'));

-- 2. Link users to employees table
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;

-- 3. Create customers table
CREATE TABLE IF NOT EXISTS public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone DEFAULT now()
);

-- RLS for customers
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY customers_admin ON public.customers TO authenticated
  USING (get_user_role() = 'admin' AND organization_id = get_user_organization_id())
  WITH CHECK (get_user_role() = 'admin' AND organization_id = get_user_organization_id());

CREATE POLICY customers_read ON public.customers FOR SELECT TO authenticated
  USING (organization_id = get_user_organization_id());

-- 4. Create negotiated_rates table
CREATE TABLE IF NOT EXISTS public.negotiated_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  vehicle_type text NOT NULL CHECK (vehicle_type IN ('12WH','10WH','6WH','Other')),
  rate_per_cubic numeric NOT NULL DEFAULT 0.0,
  created_at timestamp with time zone DEFAULT now(),
  UNIQUE(organization_id, vehicle_type)
);

-- RLS for negotiated_rates
ALTER TABLE public.negotiated_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY negotiated_rates_admin ON public.negotiated_rates TO authenticated
  USING (get_user_role() = 'admin' AND organization_id = get_user_organization_id())
  WITH CHECK (get_user_role() = 'admin' AND organization_id = get_user_organization_id());

CREATE POLICY negotiated_rates_read ON public.negotiated_rates FOR SELECT TO authenticated
  USING (organization_id = get_user_organization_id());

-- 5. Add new columns to trips table
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS cubic_capacity numeric;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS advance_amount numeric NOT NULL DEFAULT 0.0;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS photo_urls text[] DEFAULT '{}';
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS drop_location text;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS distance_km numeric;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS total_shipment_cost numeric;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS trip_worth numeric;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS settled boolean NOT NULL DEFAULT false;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS settlement_method text CHECK (settlement_method IN ('cash','upi'));
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS settlement_ref text;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS settled_at timestamp with time zone;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS settled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Make dd_number nullable (it is already nullable by default, but let's be safe)
ALTER TABLE public.trips ALTER COLUMN dd_number DROP NOT NULL;

-- 6. Setup auto-stamp triggers on customers and negotiated_rates
DROP TRIGGER IF EXISTS trg_customers_set_org ON public.customers;
CREATE TRIGGER trg_customers_set_org BEFORE INSERT ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.set_organization_id();

DROP TRIGGER IF EXISTS trg_negotiated_rates_set_org ON public.negotiated_rates;
CREATE TRIGGER trg_negotiated_rates_set_org BEFORE INSERT ON public.negotiated_rates
FOR EACH ROW EXECUTE FUNCTION public.set_organization_id();
