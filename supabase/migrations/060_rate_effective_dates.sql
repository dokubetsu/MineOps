-- Add effective date range to negotiated rates for rate history tracking
ALTER TABLE public.negotiated_rates
  ADD COLUMN IF NOT EXISTS effective_from date NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS effective_to date;

COMMENT ON COLUMN public.negotiated_rates.effective_from IS 'Date from which this rate is effective';
COMMENT ON COLUMN public.negotiated_rates.effective_to IS 'Date until which this rate is effective (NULL = current/active)';

-- Add effective date range to customer rates as well
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS rates_effective_from date,
  ADD COLUMN IF NOT EXISTS rates_effective_to date;

COMMENT ON COLUMN public.customers.rates_effective_from IS 'Date from which customer rates are effective';
COMMENT ON COLUMN public.customers.rates_effective_to IS 'Date until which customer rates are effective (NULL = current/active)';
