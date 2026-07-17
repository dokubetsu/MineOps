-- Migration 025: Site Employee rebuild, trip photos, custom check constraints, and vehicles capacity defaults

-- 1. Alter user_roles check constraint to support 'site_employee' in addition to 'employee'
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS chk_user_roles_role;
ALTER TABLE public.user_roles ADD CONSTRAINT chk_user_roles_role CHECK (role IN ('admin', 'site_manager', 'stakeholder', 'employee', 'site_employee'));

-- 2. Modify customers table to include contact info and site scope
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS contact text;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL;

-- 3. Modify trips table
ALTER TABLE public.trips DROP COLUMN IF EXISTS dd_number;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS payment_status text CHECK (payment_status IN ('pending', 'settled')) DEFAULT 'pending';
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS payment_method text CHECK (payment_method IN ('cash', 'upi'));
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS payment_reference text;

-- Sync existing settled states to payment_status/payment_method/payment_reference for trips
UPDATE public.trips SET payment_status = 'settled' WHERE settled = true;
UPDATE public.trips SET payment_status = 'pending' WHERE settled = false OR settled IS NULL;
UPDATE public.trips SET payment_method = settlement_method WHERE settlement_method IS NOT NULL;
UPDATE public.trips SET payment_reference = settlement_ref WHERE settlement_ref IS NOT NULL;

-- 4. Create trip_photos table
CREATE TABLE IF NOT EXISTS public.trip_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  photo_url text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone DEFAULT now()
);

ALTER TABLE public.trip_photos ENABLE ROW LEVEL SECURITY;

-- 5. Modify vehicles table to include default capacity per vehicle type
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS default_cubic_capacity numeric;

-- Backfill capacities
UPDATE public.vehicles SET default_cubic_capacity = 20 WHERE vehicle_type = '12WH' AND default_cubic_capacity IS NULL;
UPDATE public.vehicles SET default_cubic_capacity = 16 WHERE vehicle_type = '10WH' AND default_cubic_capacity IS NULL;
UPDATE public.vehicles SET default_cubic_capacity = 10 WHERE vehicle_type = '6WH' AND default_cubic_capacity IS NULL;
UPDATE public.vehicles SET default_cubic_capacity = 8 WHERE vehicle_type = 'Other' AND default_cubic_capacity IS NULL;

-- 6. Setup RLS Policies for site_employee / employee
-- Trips policies
DROP POLICY IF EXISTS trips_employee_read ON public.trips;
CREATE POLICY trips_employee_read ON public.trips FOR SELECT TO authenticated
  USING ((get_user_role() = 'employee' OR get_user_role() = 'site_employee') AND site_id = ANY (get_user_site_ids()));

DROP POLICY IF EXISTS trips_employee_insert ON public.trips;
CREATE POLICY trips_employee_insert ON public.trips FOR INSERT TO authenticated
  WITH CHECK ((get_user_role() = 'employee' OR get_user_role() = 'site_employee') AND site_id = ANY (get_user_site_ids()));

DROP POLICY IF EXISTS trips_employee_update ON public.trips;
CREATE POLICY trips_employee_update ON public.trips FOR UPDATE TO authenticated
  USING ((get_user_role() = 'employee' OR get_user_role() = 'site_employee') AND site_id = ANY (get_user_site_ids()))
  WITH CHECK ((get_user_role() = 'employee' OR get_user_role() = 'site_employee') AND site_id = ANY (get_user_site_ids()));

-- Cash entries (expenses) policies
DROP POLICY IF EXISTS cashentries_employee ON public.cash_entries;
CREATE POLICY cashentries_employee ON public.cash_entries TO authenticated
  USING ((get_user_role() = 'employee' OR get_user_role() = 'site_employee') AND cash_book_id IN (SELECT id FROM cash_books WHERE site_id = ANY (get_user_site_ids())))
  WITH CHECK ((get_user_role() = 'employee' OR get_user_role() = 'site_employee') AND cash_book_id IN (SELECT id FROM cash_books WHERE site_id = ANY (get_user_site_ids())));

-- Attendance policies for employees self-marking
DROP POLICY IF EXISTS attendance_self_insert ON public.attendance;
CREATE POLICY attendance_self_insert ON public.attendance FOR INSERT TO authenticated
  WITH CHECK (employee_id IN (SELECT id FROM public.employees WHERE user_id = auth.uid()) AND att_date = CURRENT_DATE);

DROP POLICY IF EXISTS attendance_self_read ON public.attendance;
CREATE POLICY attendance_self_read ON public.attendance FOR SELECT TO authenticated
  USING (employee_id IN (SELECT id FROM public.employees WHERE user_id = auth.uid()));

-- Leave applications policies for employee self
DROP POLICY IF EXISTS leave_self_insert ON public.leave_applications;
CREATE POLICY leave_self_insert ON public.leave_applications FOR INSERT TO authenticated
  WITH CHECK (employee_id IN (SELECT id FROM public.employees WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS leave_self_read ON public.leave_applications;
CREATE POLICY leave_self_read ON public.leave_applications FOR SELECT TO authenticated
  USING (employee_id IN (SELECT id FROM public.employees WHERE user_id = auth.uid()));

-- Trip photos policies (matches parent trip read/write access)
DROP POLICY IF EXISTS trip_photos_read ON public.trip_photos;
CREATE POLICY trip_photos_read ON public.trip_photos FOR SELECT TO authenticated
  USING (trip_id IN (SELECT id FROM public.trips));

DROP POLICY IF EXISTS trip_photos_write ON public.trip_photos;
CREATE POLICY trip_photos_write ON public.trip_photos FOR ALL TO authenticated
  USING (trip_id IN (SELECT id FROM public.trips))
  WITH CHECK (trip_id IN (SELECT id FROM public.trips));
