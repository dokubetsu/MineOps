-- Migration 012: Site-scoped storage policies & 5MB file size limit validation

-- ─── 1. Drop existing policies to recreate them cleanly ──────────────────
DROP POLICY IF EXISTS "Trip photos read access" ON storage.objects;
DROP POLICY IF EXISTS "Trip photos write access" ON storage.objects;
DROP POLICY IF EXISTS "Attendance photos read access" ON storage.objects;
DROP POLICY IF EXISTS "Attendance photos write access" ON storage.objects;
DROP POLICY IF EXISTS "Cash receipts read access" ON storage.objects;
DROP POLICY IF EXISTS "Cash receipts write access" ON storage.objects;
DROP POLICY IF EXISTS "Cash receipts delete access" ON storage.objects;

-- ─── 2. Trip Photos Bucket Scoping ─────────────────────────────────────────
-- READ: Admin, Site Managers for their site, Stakeholders for their site
CREATE POLICY "Trip photos read access" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'trip-photos' AND (
      get_user_role() = 'admin' OR
      (get_user_role() = 'site_manager' AND (string_to_array(name, '/'))[1]::uuid = ANY (get_user_site_ids())) OR
      (get_user_role() = 'stakeholder' AND (string_to_array(name, '/'))[1]::uuid IN (
        SELECT site_id FROM public.stakeholder_site_access WHERE stakeholder_user_id = auth.uid()
      ))
    )
  );

-- WRITE (INSERT): Admin or Site Managers for their site. Size limit 5MB.
CREATE POLICY "Trip photos write access" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'trip-photos' AND (
      get_user_role() = 'admin' OR
      (get_user_role() = 'site_manager' AND (string_to_array(name, '/'))[1]::uuid = ANY (get_user_site_ids()))
    ) AND
    COALESCE((metadata->>'size')::int, 0) <= 5242880
  );

-- ─── 3. Attendance Photos Bucket Scoping ────────────────────────────────────
-- READ: Admin, Site Managers for their site, Stakeholders for their site
CREATE POLICY "Attendance photos read access" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'attendance-photos' AND (
      get_user_role() = 'admin' OR
      (get_user_role() = 'site_manager' AND (string_to_array(name, '/'))[1]::uuid = ANY (get_user_site_ids())) OR
      (get_user_role() = 'stakeholder' AND (string_to_array(name, '/'))[1]::uuid IN (
        SELECT site_id FROM public.stakeholder_site_access WHERE stakeholder_user_id = auth.uid()
      ))
    )
  );

-- WRITE (INSERT): Admin or Site Managers for their site. Size limit 5MB.
CREATE POLICY "Attendance photos write access" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'attendance-photos' AND (
      get_user_role() = 'admin' OR
      (get_user_role() = 'site_manager' AND (string_to_array(name, '/'))[1]::uuid = ANY (get_user_site_ids()))
    ) AND
    COALESCE((metadata->>'size')::int, 0) <= 5242880
  );

-- ─── 4. Cash Receipts Bucket Scoping ────────────────────────────────────────
-- Note: Cash receipts are stored as cashBookId/filename. We resolve the site_id from cash_books.
-- READ: Admin, Site Managers for their site, Stakeholders for their site
CREATE POLICY "Cash receipts read access" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'cash-receipts' AND (
      get_user_role() = 'admin' OR
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

-- WRITE (INSERT): Admin or Site Managers for their site. Size limit 5MB.
CREATE POLICY "Cash receipts write access" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'cash-receipts' AND (
      get_user_role() = 'admin' OR
      (get_user_role() = 'site_manager' AND (string_to_array(name, '/'))[1]::uuid IN (
        SELECT id FROM public.cash_books WHERE site_id = ANY (get_user_site_ids())
      ))
    ) AND
    COALESCE((metadata->>'size')::int, 0) <= 5242880
  );

-- DELETE: Admin or Site Managers for their site
CREATE POLICY "Cash receipts delete access" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'cash-receipts' AND (
      get_user_role() = 'admin' OR
      (get_user_role() = 'site_manager' AND (string_to_array(name, '/'))[1]::uuid IN (
        SELECT id FROM public.cash_books WHERE site_id = ANY (get_user_site_ids())
      ))
    )
  );
