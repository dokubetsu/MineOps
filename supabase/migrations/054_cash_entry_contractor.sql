-- Optional transport contractor on cash entries (Fastag / fuel expenses)
ALTER TABLE public.cash_entries
  ADD COLUMN IF NOT EXISTS contractor_id uuid REFERENCES public.transport_contractors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cash_entries_contractor
  ON public.cash_entries (contractor_id)
  WHERE contractor_id IS NOT NULL;

COMMENT ON COLUMN public.cash_entries.contractor_id IS
  'Transport contractor for Trip Expense (Fastag) and Fuel/Diesel cash outs; optional elsewhere.';
