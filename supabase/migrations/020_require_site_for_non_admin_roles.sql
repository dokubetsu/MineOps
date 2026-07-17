-- Migration 020: Require site_id for non-admin roles
--
-- Nothing previously stopped a site_manager or stakeholder row from being
-- inserted with site_id = null. Every site_manager/stakeholder RLS policy
-- scopes access through get_user_site_ids(), which only returns rows where
-- site_id IS NOT NULL — so a site_manager or stakeholder row with a null
-- site_id resolves to zero accessible sites, reproducing the exact "role
-- exists but nothing works" symptom from the missing-admin-row bug, just for
-- these two roles instead. This is easy to hit when inserting user_roles by
-- hand (e.g. bootstrapping a user directly in SQL) since the app's own "Add
-- User" form already requires a site for these roles but raw SQL doesn't.
--
-- Admins keep site_id = null (global access), so the check only applies to
-- the other two roles.

ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS chk_user_roles_site_required;
ALTER TABLE public.user_roles
  ADD CONSTRAINT chk_user_roles_site_required
  CHECK (role = 'admin' OR site_id IS NOT NULL);
