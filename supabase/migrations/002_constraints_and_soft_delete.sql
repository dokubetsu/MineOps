-- Migration: Fix 7 — Unique constraint on cash_books(site_id, book_date)
-- Prevents race-condition duplicate rows when two concurrent requests hit get-or-create

ALTER TABLE cash_books
  ADD CONSTRAINT uq_cash_books_site_date UNIQUE (site_id, book_date);

-- Migration: Fix 10 — Validate entry_type and amount on cash_entries
ALTER TABLE cash_entries
  ADD CONSTRAINT chk_entry_type CHECK (entry_type IN ('in', 'out')),
  ADD CONSTRAINT chk_amount_positive CHECK (amount > 0);

-- Migration: Fix 8 — Add active column for soft-delete support
-- trips
ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

-- cash_entries
ALTER TABLE cash_entries
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
