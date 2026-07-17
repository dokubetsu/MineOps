-- Migration 040: Phase 2 ops hardening
--
-- 1) Admin-only cash book unlock (locked → draft)
-- 2) Document payroll adjustment path remains via RLS + draft line updates
--
-- Depends on: 003 cash lock, 019 role helpers, multi-tenant RLS

-- ============================================================
-- Part A: Only tenant admins may unlock a cash book
-- ============================================================

CREATE OR REPLACE FUNCTION public.check_cash_book_unlock_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Unlock path only: locked → draft (or any non-locked)
  IF OLD.status = 'locked' AND NEW.status IS DISTINCT FROM 'locked' THEN
    IF public.get_user_role() IS DISTINCT FROM 'admin' THEN
      RAISE EXCEPTION 'Only organization admins can unlock a cash book'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cash_book_unlock_admin ON public.cash_books;
CREATE TRIGGER trg_cash_book_unlock_admin
BEFORE UPDATE OF status ON public.cash_books
FOR EACH ROW
EXECUTE FUNCTION public.check_cash_book_unlock_admin();

COMMENT ON FUNCTION public.check_cash_book_unlock_admin() IS
  'Site managers may lock; only admin may unlock (Phase 2).';
