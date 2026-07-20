-- Month-end close / purge audit trail (admin operational cleanup)
CREATE TABLE IF NOT EXISTS public.period_ops_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id uuid REFERENCES public.sites(id) ON DELETE SET NULL,
  from_date date NOT NULL,
  to_date date NOT NULL,
  action text NOT NULL CHECK (action IN ('close', 'reopen', 'purge')),
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT period_ops_log_dates CHECK (from_date <= to_date)
);

CREATE INDEX IF NOT EXISTS idx_period_ops_log_org_created
  ON public.period_ops_log (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_period_ops_log_site_period
  ON public.period_ops_log (site_id, from_date, to_date);

ALTER TABLE public.period_ops_log ENABLE ROW LEVEL SECURITY;

-- Tenant admins can read their org's log; writes go through service_role API
DROP POLICY IF EXISTS period_ops_log_select_admin ON public.period_ops_log;
CREATE POLICY period_ops_log_select_admin ON public.period_ops_log
  FOR SELECT TO authenticated
  USING (
    organization_id IN (
      SELECT ur.organization_id FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'admin'
    )
    OR public.is_platform_owner()
  );

GRANT SELECT ON public.period_ops_log TO authenticated;
GRANT ALL ON public.period_ops_log TO service_role;

COMMENT ON TABLE public.period_ops_log IS
  'Audit of month-end close and optional admin purge of operational data for a site/date range.';
