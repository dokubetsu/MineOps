-- Migration: Fix 5 — Closing balance trigger
-- Automatically recalculates cash_books.closing_balance on every cash_entries change

CREATE OR REPLACE FUNCTION recalculate_closing_balance()
RETURNS TRIGGER AS $$
DECLARE
  v_book_id uuid;
  v_opening  numeric;
  v_in       numeric;
  v_out      numeric;
BEGIN
  -- Determine which cash_book was affected
  IF TG_OP = 'DELETE' THEN
    v_book_id := OLD.cash_book_id;
  ELSE
    v_book_id := NEW.cash_book_id;
  END IF;

  -- Sum only active entries
  SELECT
    COALESCE(SUM(CASE WHEN entry_type = 'in'  AND active IS NOT FALSE THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN entry_type = 'out' AND active IS NOT FALSE THEN amount ELSE 0 END), 0)
  INTO v_in, v_out
  FROM cash_entries
  WHERE cash_book_id = v_book_id;

  SELECT opening_balance INTO v_opening FROM cash_books WHERE id = v_book_id;

  UPDATE cash_books
  SET closing_balance = v_opening + v_in - v_out
  WHERE id = v_book_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_recalculate_balance ON cash_entries;
CREATE TRIGGER trg_recalculate_balance
AFTER INSERT OR UPDATE OR DELETE ON cash_entries
FOR EACH ROW EXECUTE FUNCTION recalculate_closing_balance();
