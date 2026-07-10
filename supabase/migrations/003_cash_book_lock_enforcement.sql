-- Migration: Fix 9 — Cash Book Lock Trigger
-- Rejects any INSERT, UPDATE, or DELETE on cash_entries if the parent cash_book is locked.

CREATE OR REPLACE FUNCTION check_cash_book_not_locked()
RETURNS TRIGGER AS $$
DECLARE
  v_status text;
  v_book_id uuid;
BEGIN
  -- Determine which cash_book_id is affected
  IF TG_OP = 'DELETE' THEN
    v_book_id := OLD.cash_book_id;
  ELSE
    v_book_id := NEW.cash_book_id;
  END IF;

  -- Get lock status of the parent cash book
  SELECT status INTO v_status FROM cash_books WHERE id = v_book_id;

  -- Block modification if locked
  IF v_status = 'locked' THEN
    RAISE EXCEPTION 'Cannot modify cash entries for a locked cash book' USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_cash_book_lock ON cash_entries;
CREATE TRIGGER trg_check_cash_book_lock
BEFORE INSERT OR UPDATE OR DELETE ON cash_entries
FOR EACH ROW EXECUTE FUNCTION check_cash_book_not_locked();
