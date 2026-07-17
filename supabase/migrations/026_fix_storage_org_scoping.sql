-- Migration 026: Fix storage bucket policies — org-scope admin access
-- Problem: All storage policies grant admin access with get_user_role() = 'admin'
-- but NO organization check. Org A's admin can read/write/delete org B's photos.
-- Fix: Drop all existing policies + catch-all, recreate with org-scoped admin branches.

-- ============================================================
-- Step 1: Drop ALL existing storage policies
-- ============================================================

DROP POLICY IF EXISTS "Trip photos read access" ON storage.objects;
DROP POLICY IF EXISTS "Trip photos write access" ON storage.objects;
DROP POLICY IF EXISTS "Attendance photos read access" ON storage.objects;
DROP POLICY IF EXISTS "Attendance photos write access" ON storage.objects;
DROP POLICY IF EXISTS "Cash receipts read access" ON storage.objects;
DROP POLICY IF EXISTS "Cash receipts write access" ON storage.objects;
DROP POLICY IF EXISTS "Cash receipts delete access" ON storage.objects;
DROP POLICY IF EXISTS "Objects admin access" ON storage.objects;

-- ============================================================
-- Step 2: Recreate per-bucket policies with org-scoped admin
-- ============================================================

-- Path format for trip-photos and attendance-photos: {site_id}/...
-- Path format for cash-receipts: {cash_book_id}/...

-- ----- TRIP PHOTOS -----

CREATE POLICY "Trip photos read access" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'trip-photos' AND (
      (get_user_role() = 'admin' AND (string_to_array(name, '/'))[1]::uuid = ANY (get_org_site_ids())) OR
      (get_user_role() = 'site_manager' AND (string_to_array(name, '/'))[1]::uuid = ANY (get_user_site_ids())) OR
      (get_user_role() = 'stakeholder' AND (string_to_array(name, '/'))[1]::uuid IN (
        SELECT site_id FROM public.stakeholder_site_access WHERE stakeholder_user_id = auth.uid()
      ))
    )
  );

CREATE POLICY "Trip photos write access" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'trip-photos' AND (
      (get_user_role() = 'admin' AND (string_to_array(name, '/'))[1]::uuid = ANY (get_org_site_ids())) OR
      (get_user_role() = 'site_manager' AND (string_to_array(name, '/'))[1]::uuid = ANY (get_user_site_ids()))
    )
  );

CREATE POLICY "Trip photos update access" ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'trip-photos' AND (
      (get_user_role() = 'admin' AND (string_to_array(name, '/'))[1]::uuid = ANY (get_org_site_ids())) OR
      (get_user_role() = 'site_manager' AND (string_to_array(name, '/'))[1]::uuid = ANY (get_user_site_ids()))
    )
  )
  WITH CHECK (
    bucket_id = 'trip-photos' AND (
      (get_user_role() = 'admin' AND (string_to_array(name, '/'))[1]::uuid = ANY (get_org_site_ids())) OR
      (get_user_role() = 'site_manager' AND (string_to_array(name, '/'))[1]::uuid = ANY (get_user_site_ids()))
    )
  );

CREATE POLICY "Trip photos delete access" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'trip-photos' AND (
      (get_user_role() = 'admin' AND (string_to_array(name, '/'))[1]::uuid = ANY (get_org_site_ids())) OR
      (get_user_role() = 'site_manager' AND (string_to_array(name, '/'))[1]::uuid = ANY (get_user_site_ids()))
    )
  );

-- ----- ATTENDANCE PHOTOS -----

CREATE POLICY "Attendance photos read access" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'attendance-photos' AND (
      (get_user_role() = 'admin' AND (string_to_array(name, '/'))[1]::uuid = ANY (get_org_site_ids())) OR
      (get_user_role() = 'site_manager' AND (string_to_array(name, '/'))[1]::uuid = ANY (get_user_site_ids())) OR
      (get_user_role() = 'stakeholder' AND (string_to_array(name, '/'))[1]::uuid IN (
        SELECT site_id FROM public.stakeholder_site_access WHERE stakeholder_user_id = auth.uid()
      ))
    )
  );

CREATE POLICY "Attendance photos write access" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'attendance-photos' AND (
      (get_user_role() = 'admin' AND (string_to_array(name, '/'))[1]::uuid = ANY (get_org_site_ids())) OR
      (get_user_role() = 'site_manager' AND (string_to_array(name, '/'))[1]::uuid = ANY (get_user_site_ids()))
    )
  );

CREATE POLICY "Attendance photos update access" ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'attendance-photos' AND (
      (get_user_role() = 'admin' AND (string_to_array(name, '/'))[1]::uuid = ANY (get_org_site_ids())) OR
      (get_user_role() = 'site_manager' AND (string_to_array(name, '/'))[1]::uuid = ANY (get_user_site_ids()))
    )
  )
  WITH CHECK (
    bucket_id = 'attendance-photos' AND (
      (get_user_role() = 'admin' AND (string_to_array(name, '/'))[1]::uuid = ANY (get_org_site_ids())) OR
      (get_user_role() = 'site_manager' AND (string_to_array(name, '/'))[1]::uuid = ANY (get_user_site_ids()))
    )
  );

CREATE POLICY "Attendance photos delete access" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'attendance-photos' AND (
      (get_user_role() = 'admin' AND (string_to_array(name, '/'))[1]::uuid = ANY (get_org_site_ids())) OR
      (get_user_role() = 'site_manager' AND (string_to_array(name, '/'))[1]::uuid = ANY (get_user_site_ids()))
    )
  );

-- ----- CASH RECEIPTS -----

CREATE POLICY "Cash receipts read access" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'cash-receipts' AND (
      (get_user_role() = 'admin' AND (string_to_array(name, '/'))[1]::uuid IN (
        SELECT id FROM public.cash_books WHERE site_id = ANY (get_org_site_ids())
      )) OR
      (get_user_role() = 'site_manager' AND (string_to_array(name, '/'))[1]::uuid IN (
        SELECT id FROM public.cash_books WHERE site_id = ANY (get_user_site_ids())
      )) OR
      (get_user_role() = 'stakeholder' AND (string_to_array(name, '/'))[1]::uuid IN (
        SELECT id FROM public.cash_books WHERE site_id IN (
          SELECT site_id FROM public.stakeholder_site_access WHERE stakeholder_user_id = auth.uid()
        )
      ))
    )
  );

CREATE POLICY "Cash receipts write access" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'cash-receipts' AND (
      (get_user_role() = 'admin' AND (string_to_array(name, '/'))[1]::uuid IN (
        SELECT id FROM public.cash_books WHERE site_id = ANY (get_org_site_ids())
      )) OR
      (get_user_role() = 'site_manager' AND (string_to_array(name, '/'))[1]::uuid IN (
        SELECT id FROM public.cash_books WHERE site_id = ANY (get_user_site_ids())
      ))
    )
  );

CREATE POLICY "Cash receipts update access" ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'cash-receipts' AND (
      (get_user_role() = 'admin' AND (string_to_array(name, '/'))[1]::uuid IN (
        SELECT id FROM public.cash_books WHERE site_id = ANY (get_org_site_ids())
      )) OR
      (get_user_role() = 'site_manager' AND (string_to_array(name, '/'))[1]::uuid IN (
        SELECT id FROM public.cash_books WHERE site_id = ANY (get_user_site_ids())
      ))
    )
  )
  WITH CHECK (
    bucket_id = 'cash-receipts' AND (
      (get_user_role() = 'admin' AND (string_to_array(name, '/'))[1]::uuid IN (
        SELECT id FROM public.cash_books WHERE site_id = ANY (get_org_site_ids())
      )) OR
      (get_user_role() = 'site_manager' AND (string_to_array(name, '/'))[1]::uuid IN (
        SELECT id FROM public.cash_books WHERE site_id = ANY (get_user_site_ids())
      ))
    )
  );

CREATE POLICY "Cash receipts delete access" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'cash-receipts' AND (
      (get_user_role() = 'admin' AND (string_to_array(name, '/'))[1]::uuid IN (
        SELECT id FROM public.cash_books WHERE site_id = ANY (get_org_site_ids())
      )) OR
      (get_user_role() = 'site_manager' AND (string_to_array(name, '/'))[1]::uuid IN (
        SELECT id FROM public.cash_books WHERE site_id = ANY (get_user_site_ids())
      ))
    )
  );
