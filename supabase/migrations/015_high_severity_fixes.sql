-- Migration 015: High-severity security, logic, trigger, and RLS improvements

-- ─── H1. Stakeholder Daily Summary View access ────────────────────────────────
-- Grant SELECT permissions to stakeholders on cash_books and cash_entries by defining RLS policies.
DROP POLICY IF EXISTS cashbooks_stakeholder_select ON public.cash_books;
CREATE POLICY cashbooks_stakeholder_select ON public.cash_books FOR SELECT TO authenticated
  USING (
    get_user_role() = 'stakeholder' AND 
    site_id IN (SELECT site_id FROM public.stakeholder_site_access WHERE stakeholder_user_id = auth.uid())
  );

DROP POLICY IF EXISTS cashentries_stakeholder_select ON public.cash_entries;
CREATE POLICY cashentries_stakeholder_select ON public.cash_entries FOR SELECT TO authenticated
  USING (
    get_user_role() = 'stakeholder' AND 
    cash_book_id IN (
      SELECT id FROM public.cash_books 
      WHERE site_id IN (SELECT site_id FROM public.stakeholder_site_access WHERE stakeholder_user_id = auth.uid())
    )
  );

-- ─── H2. Storage Bucket 5MB limit validation ────────────────────────────────
-- Restrict file size limit directly inside storage.buckets schema to make the 5MB limits highly effective.
UPDATE storage.buckets SET file_size_limit = 5242880 WHERE id IN ('trip-photos', 'attendance-photos', 'cash-receipts');

-- Recreate write policies without the ineffective client-metadata size filter
DROP POLICY IF EXISTS "Trip photos write access" ON storage.objects;
CREATE POLICY "Trip photos write access" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'trip-photos' AND (
      get_user_role() = 'admin' OR
      (get_user_role() = 'site_manager' AND (string_to_array(name, '/'))[1]::uuid = ANY (get_user_site_ids()))
    )
  );

DROP POLICY IF EXISTS "Attendance photos write access" ON storage.objects;
CREATE POLICY "Attendance photos write access" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'attendance-photos' AND (
      get_user_role() = 'admin' OR
      (get_user_role() = 'site_manager' AND (string_to_array(name, '/'))[1]::uuid = ANY (get_user_site_ids()))
    )
  );

DROP POLICY IF EXISTS "Cash receipts write access" ON storage.objects;
CREATE POLICY "Cash receipts write access" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'cash-receipts' AND (
      get_user_role() = 'admin' OR
      (get_user_role() = 'site_manager' AND (string_to_array(name, '/'))[1]::uuid IN (
        SELECT id FROM public.cash_books WHERE site_id = ANY (get_user_site_ids())
      ))
    )
  );

-- ─── H3. Marked By updated on Attendance Upsert ──────────────────────────────
-- Make trg_attendance_set_marked_by trigger BEFORE INSERT OR UPDATE to capture modifications
DROP TRIGGER IF EXISTS trg_attendance_set_marked_by ON public.attendance;
CREATE TRIGGER trg_attendance_set_marked_by
BEFORE INSERT OR UPDATE ON public.attendance
FOR EACH ROW EXECUTE FUNCTION public.set_marked_by();

-- ─── H4. Admin Storage Bucket Scope Filter ───────────────────────────────
-- Restrict generic admin storage policy to only the application's buckets.
DROP POLICY IF EXISTS "Objects admin access" ON storage.objects;
CREATE POLICY "Objects admin access" ON storage.objects TO authenticated
  USING (
    get_user_role() = 'admin' AND 
    bucket_id IN ('trip-photos', 'attendance-photos', 'cash-receipts')
  )
  WITH CHECK (
    get_user_role() = 'admin' AND 
    bucket_id IN ('trip-photos', 'attendance-photos', 'cash-receipts')
  );

-- ─── H6. Trigger Functions Security Definer & search_path ───────────────────
-- Re-create recalculate_closing_balance, check_cash_book_not_locked, and approve_leave_application
-- explicitly specifying SECURITY DEFINER and search_path to prevent path injection.

CREATE OR REPLACE FUNCTION public.recalculate_closing_balance()
RETURNS TRIGGER AS $$
DECLARE
  v_book_id uuid;
  v_opening  numeric;
  v_in       numeric;
  v_out      numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_book_id := OLD.cash_book_id;
  ELSE
    v_book_id := NEW.cash_book_id;
  END IF;

  SELECT
    COALESCE(SUM(CASE WHEN entry_type = 'in'  AND active IS NOT FALSE THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN entry_type = 'out' AND active IS NOT FALSE THEN amount ELSE 0 END), 0)
  INTO v_in, v_out
  FROM public.cash_entries
  WHERE cash_book_id = v_book_id;

  SELECT opening_balance INTO v_opening FROM public.cash_books WHERE id = v_book_id;

  UPDATE public.cash_books
  SET closing_balance = v_opening + v_in - v_out
  WHERE id = v_book_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.check_cash_book_not_locked()
RETURNS TRIGGER AS $$
DECLARE
  v_status text;
  v_book_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_book_id := OLD.cash_book_id;
  ELSE
    v_book_id := NEW.cash_book_id;
  END IF;

  SELECT status INTO v_status FROM public.cash_books WHERE id = v_book_id;

  IF v_status = 'locked' THEN
    RAISE EXCEPTION 'Cannot modify cash entries for a locked cash book' USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.approve_leave_application(p_application_id uuid)
RETURNS void AS $$
DECLARE
  v_employee_id uuid;
  v_from_date date;
  v_to_date date;
  v_cur_date date;
BEGIN
  SELECT employee_id, from_date, to_date INTO v_employee_id, v_from_date, v_to_date
  FROM public.leave_applications
  WHERE id = p_application_id AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Leave application not found or not pending';
  END IF;

  UPDATE public.leave_applications
  SET status = 'approved'
  WHERE id = p_application_id;

  v_cur_date := v_from_date;
  WHILE v_cur_date <= v_to_date LOOP
    INSERT INTO public.attendance (employee_id, att_date, status)
    VALUES (v_employee_id, v_cur_date, 'leave')
    ON CONFLICT (employee_id, att_date)
    DO UPDATE SET status = 'leave';
    
    v_cur_date := v_cur_date + 1;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- ─── H7. Cash Book Balance Chain Propagation ──────────────────────────────────
-- Setup chronological propagation function and trigger on cash_books to keep opening/closing balances consistent.

CREATE OR REPLACE FUNCTION public.propagate_cash_book_balances(p_site_id uuid, p_start_date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_last_closing numeric;
  r RECORD;
  v_in numeric;
  v_out numeric;
BEGIN
  -- Fetch closing balance of the immediately preceding book
  SELECT closing_balance INTO v_last_closing
  FROM public.cash_books
  WHERE site_id = p_site_id AND book_date < p_start_date
  ORDER BY book_date DESC
  LIMIT 1;

  -- Propagate forward from the start date cash book onwards
  FOR r IN
    SELECT id, book_date, opening_balance, closing_balance
    FROM public.cash_books
    WHERE site_id = p_site_id AND book_date >= p_start_date
    ORDER BY book_date ASC
  LOOP
    SELECT
      COALESCE(SUM(CASE WHEN entry_type = 'in'  AND active IS NOT FALSE THEN amount ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN entry_type = 'out' AND active IS NOT FALSE THEN amount ELSE 0 END), 0)
    INTO v_in, v_out
    FROM public.cash_entries
    WHERE cash_book_id = r.id;

    IF v_last_closing IS NOT NULL THEN
      UPDATE public.cash_books
      SET opening_balance = v_last_closing,
          closing_balance = v_last_closing + v_in - v_out
      WHERE id = r.id;
      v_last_closing := v_last_closing + v_in - v_out;
    ELSE
      UPDATE public.cash_books
      SET closing_balance = opening_balance + v_in - v_out
      WHERE id = r.id;
      v_last_closing := r.opening_balance + v_in - v_out;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_propagate_cash_books()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_setting('mineops.skip_propagation', true) = 'true' THEN
    RETURN NEW;
  END IF;

  PERFORM set_config('mineops.skip_propagation', 'true', true);

  PERFORM public.propagate_cash_book_balances(NEW.site_id, NEW.book_date);

  PERFORM set_config('mineops.skip_propagation', 'false', true);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_propagate_cash_books_balance ON public.cash_books;
CREATE TRIGGER trg_propagate_cash_books_balance
AFTER INSERT OR UPDATE OF opening_balance, closing_balance ON public.cash_books
FOR EACH ROW EXECUTE FUNCTION public.trg_propagate_cash_books();
