-- Migration 032: Sync JWT Claims, Audit Logging, and org_users View

-- ============================================================
-- Step 1: Create Database View public.org_users
-- ============================================================

CREATE OR REPLACE VIEW public.org_users WITH (security_invoker = true) AS
SELECT 
  u.id,
  u.email,
  u.created_at,
  ur.role,
  ur.site_id,
  ur.organization_id
FROM auth.users u
JOIN public.user_roles ur ON u.id = ur.user_id;

-- ============================================================
-- Step 2: Create public.audit_logs Table
-- ============================================================

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Admins can view audit logs for their organization
DROP POLICY IF EXISTS audit_logs_admin_read ON public.audit_logs;
CREATE POLICY audit_logs_admin_read ON public.audit_logs FOR SELECT TO authenticated
  USING (
    get_user_role() = 'admin' AND organization_id = get_user_organization_id()
  );

-- ============================================================
-- Step 3: Trigger to Sync user_roles with auth.users raw_app_meta_data (JWT Claims)
-- ============================================================

CREATE OR REPLACE FUNCTION public.sync_user_app_metadata()
RETURNS trigger AS $$
DECLARE
  v_org_id uuid;
  v_role text;
BEGIN
  -- Determine the user's active role and organization
  -- (Always select the highest priority role/org for the user)
  SELECT organization_id, role INTO v_org_id, v_role
  FROM public.user_roles
  WHERE user_id = COALESCE(NEW.user_id, OLD.user_id)
  ORDER BY CASE role
    WHEN 'admin' THEN 1
    WHEN 'site_manager' THEN 2
    WHEN 'stakeholder' THEN 3
    WHEN 'employee' THEN 4
    ELSE 5
  END
  LIMIT 1;

  -- Update raw_app_meta_data in auth.users
  UPDATE auth.users
  SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || 
    jsonb_build_object('organization_id', v_org_id, 'role', v_role)
  WHERE id = COALESCE(NEW.user_id, OLD.user_id);

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS trg_sync_user_app_metadata ON public.user_roles;
CREATE TRIGGER trg_sync_user_app_metadata
AFTER INSERT OR UPDATE OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.sync_user_app_metadata();

-- ============================================================
-- Step 4: Create audit_table_action trigger function
-- ============================================================

CREATE OR REPLACE FUNCTION public.audit_table_action()
RETURNS trigger AS $$
DECLARE
  v_org_id uuid;
  v_actor uuid;
  v_action text;
  v_target_type text;
  v_target_id text;
  v_metadata jsonb := '{}'::jsonb;
BEGIN
  v_actor := auth.uid();
  IF v_actor IS NULL THEN
    -- If executed outside of an auth session (e.g. CLI seed, migration), skip auditing
    RETURN NEW;
  END IF;

  -- Resolve organization_id
  v_org_id := public.get_user_organization_id();
  IF v_org_id IS NULL THEN
    -- If no org is found, try to resolve from the table itself (e.g. sites or table direct column)
    IF TG_TABLE_NAME = 'sites' THEN
      v_org_id := NEW.organization_id;
    ELSIF TG_TABLE_NAME = 'trips' THEN
      v_org_id := NEW.organization_id;
    ELSIF TG_TABLE_NAME = 'cash_books' THEN
      v_org_id := NEW.organization_id;
    ELSIF TG_TABLE_NAME = 'payroll_runs' THEN
      v_org_id := NEW.organization_id;
    END IF;
  END IF;

  IF v_org_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_target_type := TG_TABLE_NAME;
  v_target_id := NEW.id::text;

  -- Check actions based on table name and changed state
  IF TG_TABLE_NAME = 'trips' THEN
    IF OLD.payment_status IS DISTINCT FROM NEW.payment_status AND NEW.payment_status = 'settled' THEN
      v_action := 'settle_trip';
      v_metadata := jsonb_build_object(
        'payment_method', NEW.payment_method,
        'payment_reference', NEW.payment_reference,
        'trip_worth', NEW.trip_worth
      );
    ELSE
      RETURN NEW; -- Only audit settlement
    END IF;
  ELSIF TG_TABLE_NAME = 'cash_books' THEN
    IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'locked' THEN
      v_action := 'lock_cash_book';
      v_metadata := jsonb_build_object(
        'book_date', NEW.book_date,
        'closing_balance', NEW.closing_balance
      );
    ELSE
      RETURN NEW; -- Only audit locking
    END IF;
  ELSIF TG_TABLE_NAME = 'payroll_runs' THEN
    IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'finalized' THEN
      v_action := 'finalize_payroll';
      v_metadata := jsonb_build_object(
        'period_month', NEW.period_month
      );
    ELSE
      RETURN NEW; -- Only audit finalization
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  -- Insert audit log
  INSERT INTO public.audit_logs (organization_id, actor_user_id, action, target_type, target_id, metadata)
  VALUES (v_org_id, v_actor, v_action, v_target_type, v_target_id, v_metadata);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- Attach triggers
DROP TRIGGER IF EXISTS trg_audit_trips ON public.trips;
CREATE TRIGGER trg_audit_trips
AFTER UPDATE ON public.trips
FOR EACH ROW EXECUTE FUNCTION public.audit_table_action();

DROP TRIGGER IF EXISTS trg_audit_cash_books ON public.cash_books;
CREATE TRIGGER trg_audit_cash_books
AFTER UPDATE ON public.cash_books
FOR EACH ROW EXECUTE FUNCTION public.audit_table_action();

DROP TRIGGER IF EXISTS trg_audit_payroll_runs ON public.payroll_runs;
CREATE TRIGGER trg_audit_payroll_runs
AFTER UPDATE ON public.payroll_runs
FOR EACH ROW EXECUTE FUNCTION public.audit_table_action();
