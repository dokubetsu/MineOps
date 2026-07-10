-- Migration: RLS & View Security Adjustments
-- Fix Site Manager permissions on payroll runs & lines to allow generating payroll
-- Enforce RLS on stakeholder daily summary view using security_invoker = true

-- 1. Redefine payroll_runs policies for Site Manager
DROP POLICY IF EXISTS payroll_runs_manager ON public.payroll_runs;
CREATE POLICY payroll_runs_manager ON public.payroll_runs TO authenticated
  USING (get_user_role() = 'site_manager' AND site_id = ANY (get_user_site_ids()));

-- 2. Redefine payroll_lines policies for Site Manager
DROP POLICY IF EXISTS payroll_lines_manager ON public.payroll_lines;
CREATE POLICY payroll_lines_manager ON public.payroll_lines TO authenticated
  USING (get_user_role() = 'site_manager' AND payroll_run_id IN (SELECT id FROM payroll_runs WHERE site_id = ANY (get_user_site_ids())));

-- 3. Set security_invoker on stakeholder summary view
ALTER VIEW public.stakeholder_daily_summary SET (security_invoker = true);
