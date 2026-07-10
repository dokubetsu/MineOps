-- Migration 007: Private Storage buckets, secure storage RLS, trigger corrections, and stakeholder constraints

-- 1. Private Storage Buckets (Fix N4)
-- Set public = false to secure access and force signed URL handshakes
INSERT INTO storage.buckets (id, name, public)
VALUES ('trip-photos', 'trip-photos', false)
ON CONFLICT (id) DO UPDATE SET public = false;

INSERT INTO storage.buckets (id, name, public)
VALUES ('attendance-photos', 'attendance-photos', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- Note: RLS is pre-enabled on storage.objects in Supabase by default.
-- Do not attempt to run ALTER TABLE storage.objects as it requires superuser ownership.

-- Recreate storage policies
DROP POLICY IF EXISTS "Trip photos read access" ON storage.objects;
DROP POLICY IF EXISTS "Trip photos write access" ON storage.objects;
DROP POLICY IF EXISTS "Attendance photos read access" ON storage.objects;
DROP POLICY IF EXISTS "Attendance photos write access" ON storage.objects;
DROP POLICY IF EXISTS "Objects admin access" ON storage.objects;

CREATE POLICY "Trip photos read access" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'trip-photos');

CREATE POLICY "Trip photos write access" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'trip-photos' AND get_user_role() IN ('admin', 'site_manager'));

CREATE POLICY "Attendance photos read access" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'attendance-photos');

CREATE POLICY "Attendance photos write access" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'attendance-photos' AND get_user_role() IN ('admin', 'site_manager'));

CREATE POLICY "Objects admin access" ON storage.objects TO authenticated
  USING (get_user_role() = 'admin')
  WITH CHECK (get_user_role() = 'admin');

-- 2. Correct payroll run lock trigger function (Fix B3)
-- Branches on TG_OP to check OLD row on DELETE, preventing unauthorized depletions
CREATE OR REPLACE FUNCTION public.check_payroll_run_not_finalized()
RETURNS trigger AS $$
DECLARE
  v_status text;
  v_run_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_run_id := OLD.payroll_run_id;
  ELSE
    v_run_id := NEW.payroll_run_id;
  END IF;

  SELECT status INTO v_status FROM public.payroll_runs WHERE id = v_run_id;

  IF v_status = 'finalized' THEN
    RAISE EXCEPTION 'Cannot modify payroll lines for a finalized run' USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 3. Correct set_approved_by trigger function (Fix B8)
-- Updates approver when status transitions, supporting re-approvals
CREATE OR REPLACE FUNCTION public.set_approved_by()
RETURNS trigger AS $$
BEGIN
  IF NEW.status IN ('approved', 'rejected') AND NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.approved_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- 4. Unique and check constraints on stakeholder_site_access (Fix B7)
-- Prevents double allocation and ensures valid share percentages
ALTER TABLE public.stakeholder_site_access
  DROP CONSTRAINT IF EXISTS uq_stakeholder_site,
  DROP CONSTRAINT IF EXISTS chk_share_range;

ALTER TABLE public.stakeholder_site_access
  ADD CONSTRAINT uq_stakeholder_site UNIQUE (stakeholder_user_id, site_id),
  ADD CONSTRAINT chk_share_range CHECK (share_percent >= 0.0 AND share_percent <= 100.0);
