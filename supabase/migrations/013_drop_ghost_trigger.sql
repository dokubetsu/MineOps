-- Drop the deprecated trg_user_roles_last_admin trigger to prevent silent rollbacks on admin role updates
DROP TRIGGER IF EXISTS trg_user_roles_last_admin ON public.user_roles;
