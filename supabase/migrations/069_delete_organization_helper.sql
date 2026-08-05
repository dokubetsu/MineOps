-- ============================================================
-- 069 — Delete organization helper function
-- Delete an organization and all its cascade dependencies
-- in the correct foreign key constraint order.
-- ============================================================

CREATE OR REPLACE FUNCTION public.delete_organization_cascade(p_organization_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Verify caller is a service_role (safe protection)
  IF coalesce(auth.role(), '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Forbidden: only service_role / platform owner can delete organizations'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Delete from dependent tables in correct constraint order (child first)
  DELETE FROM public.payroll_lines WHERE organization_id = p_organization_id;
  DELETE FROM public.payroll_runs WHERE organization_id = p_organization_id;
  DELETE FROM public.attendance WHERE organization_id = p_organization_id;
  DELETE FROM public.leave_applications WHERE organization_id = p_organization_id;
  DELETE FROM public.cash_entries WHERE organization_id = p_organization_id;
  DELETE FROM public.cash_books WHERE organization_id = p_organization_id;
  DELETE FROM public.trips WHERE organization_id = p_organization_id;
  DELETE FROM public.employees WHERE organization_id = p_organization_id;
  DELETE FROM public.vehicles WHERE organization_id = p_organization_id;
  DELETE FROM public.drivers WHERE organization_id = p_organization_id;
  DELETE FROM public.stakeholder_site_access WHERE organization_id = p_organization_id;
  DELETE FROM public.negotiated_rates WHERE organization_id = p_organization_id;
  DELETE FROM public.customers WHERE organization_id = p_organization_id;
  DELETE FROM public.sites WHERE organization_id = p_organization_id;
  DELETE FROM public.transport_contractors WHERE organization_id = p_organization_id;
  DELETE FROM public.user_roles WHERE organization_id = p_organization_id;
  DELETE FROM public.audit_logs WHERE organization_id = p_organization_id;
  DELETE FROM public.organization_features WHERE organization_id = p_organization_id;

  BEGIN
    DELETE FROM public.period_ops_logs WHERE organization_id = p_organization_id;
  EXCEPTION WHEN OTHERS THEN
    -- Table may not exist or not have organization_id
  END;

  DELETE FROM public.organizations WHERE id = p_organization_id;
END;
$$;

COMMENT ON FUNCTION public.delete_organization_cascade(uuid) IS
  'Secure cascade deletion of organization data. Restrict to service_role.';

REVOKE ALL ON FUNCTION public.delete_organization_cascade(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_organization_cascade(uuid) TO service_role;
