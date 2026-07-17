-- Migration 042: Employee expense logging — cash_books + cash-receipts access
--
-- Employees already have cash_entries insert on site cash books (039).
-- They still cannot create/select cash_books or upload receipts. Fix that.

-- ============================================================
-- Part A: cash_books SELECT + INSERT for employees on assigned sites
-- ============================================================

DROP POLICY IF EXISTS cashbooks_employee_select ON public.cash_books;
CREATE POLICY cashbooks_employee_select ON public.cash_books FOR SELECT TO authenticated
  USING (
    get_user_role() IN ('employee', 'site_employee')
    AND site_id = ANY (get_user_site_ids())
  );

DROP POLICY IF EXISTS cashbooks_employee_insert ON public.cash_books;
CREATE POLICY cashbooks_employee_insert ON public.cash_books FOR INSERT TO authenticated
  WITH CHECK (
    get_user_role() IN ('employee', 'site_employee')
    AND site_id = ANY (get_user_site_ids())
    AND status = 'draft'
  );

-- Employees must not lock/unlock cash books (no UPDATE policy for them)

-- ============================================================
-- Part B: cash-receipts storage for employees
-- Path: {cash_book_id}/...  (matches 026 org-scoping contract)
-- ============================================================

DROP POLICY IF EXISTS "Cash receipts read access" ON storage.objects;
CREATE POLICY "Cash receipts read access" ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'cash-receipts' AND (
      (get_user_role() = 'admin' AND (string_to_array(name, '/'))[1]::uuid IN (
        SELECT id FROM public.cash_books WHERE site_id = ANY (get_org_site_ids())
      )) OR
      (get_user_role() = 'site_manager' AND (string_to_array(name, '/'))[1]::uuid IN (
        SELECT id FROM public.cash_books WHERE site_id = ANY (get_user_site_ids())
      )) OR
      (get_user_role() IN ('employee', 'site_employee') AND (string_to_array(name, '/'))[1]::uuid IN (
        SELECT id FROM public.cash_books WHERE site_id = ANY (get_user_site_ids())
      )) OR
      (get_user_role() = 'stakeholder' AND (string_to_array(name, '/'))[1]::uuid IN (
        SELECT id FROM public.cash_books WHERE site_id IN (
          SELECT site_id FROM public.stakeholder_site_access WHERE stakeholder_user_id = auth.uid()
        )
      ))
    )
  );

DROP POLICY IF EXISTS "Cash receipts write access" ON storage.objects;
CREATE POLICY "Cash receipts write access" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'cash-receipts' AND (
      (get_user_role() = 'admin' AND (string_to_array(name, '/'))[1]::uuid IN (
        SELECT id FROM public.cash_books WHERE site_id = ANY (get_org_site_ids())
      )) OR
      (get_user_role() = 'site_manager' AND (string_to_array(name, '/'))[1]::uuid IN (
        SELECT id FROM public.cash_books WHERE site_id = ANY (get_user_site_ids())
      )) OR
      (get_user_role() IN ('employee', 'site_employee') AND (string_to_array(name, '/'))[1]::uuid IN (
        SELECT id FROM public.cash_books WHERE site_id = ANY (get_user_site_ids())
      ))
    )
  );
