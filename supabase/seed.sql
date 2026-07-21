-- =============================================================================
-- LOCAL / CI SEED ONLY — DO NOT RUN AGAINST PRODUCTION
-- Demo credentials (password123) are intentionally weak for Playwright.
-- Production: provision platform owner via /platform/setup + PLATFORM_BOOTSTRAP_SECRET.
-- See docs/DEPLOYMENT_CHECKLIST.md and docs/platform_owner_bootstrap.md.
-- =============================================================================

-- Seed default organization
INSERT INTO public.organizations (id, name, active)
VALUES ('00000000-0000-0000-0000-000000000000', 'MineOps Demo Org', true)
ON CONFLICT (id) DO NOTHING;

-- Seed org feature entitlements (migration 036 creates table + seed_organization_features)
SELECT public.seed_organization_features('00000000-0000-0000-0000-000000000000');

-- Seed sites
INSERT INTO public.sites (id, name, location, active, organization_id)
VALUES 
  ('00000000-0000-0000-0000-000000000001', 'Test Mine Site 1', 'North Quarry', true, '00000000-0000-0000-0000-000000000000'),
  ('00000000-0000-0000-0000-000000000002', 'Test Mine Site 2', 'South Quarry', true, '00000000-0000-0000-0000-000000000000')
ON CONFLICT (id) DO NOTHING;

-- Seed an auth user in Supabase Auth (using pre-computed bcrypt hash for 'password123')
INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  recovery_sent_at,
  last_sign_in_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  email_change,
  email_change_token_new,
  recovery_token,
  is_sso_user,
  is_anonymous
) VALUES (
  '00000000-0000-0000-0000-000000000000'::uuid,
  'd0a0b0c0-d0e0-f0a0-b0c0-d0e0f0a0b0c0'::uuid,
  'authenticated',
  'authenticated',
  'admin@mineops.com',
  '$2b$10$JiePxFoho6oUAiA2KRIQYub1rY0xXpjWOa9g8rqIkO2Veon5GK1KW', -- bcrypt hash for password123
  now(),
  null,
  null,
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now(),
  '',
  '',
  '',
  '',
  false,
  false
) ON CONFLICT (id) DO NOTHING;

-- Seed an auth identity in Supabase Auth (required for email provider logins to succeed)
INSERT INTO auth.identities (
  id,
  user_id,
  identity_data,
  provider,
  provider_id,
  last_sign_in_at,
  created_at,
  updated_at
) VALUES (
  'd0a0b0c0-d0e0-f0a0-b0c0-d0e0f0a0b0c0'::uuid,
  'd0a0b0c0-d0e0-f0a0-b0c0-d0e0f0a0b0c0'::uuid,
  '{"sub":"d0a0b0c0-d0e0-f0a0-b0c0-d0e0f0a0b0c0","email":"admin@mineops.com","email_verified":true,"phone_verified":false}'::jsonb,
  'email',
  'd0a0b0c0-d0e0-f0a0-b0c0-d0e0f0a0b0c0',
  now(),
  now(),
  now()
) ON CONFLICT (provider_id, provider) DO NOTHING;

-- Grant admin role to the user in user_roles
INSERT INTO public.user_roles (id, user_id, role, site_id, organization_id)
VALUES ('00000000-0000-0000-0000-000000000100', 'd0a0b0c0-d0e0-f0a0-b0c0-d0e0f0a0b0c0', 'admin', null, '00000000-0000-0000-0000-000000000000')
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- Platform owner (control plane) — separate from tenant admin
-- Login: platform@mineops.com / password123
-- ============================================================
INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  recovery_sent_at,
  last_sign_in_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  email_change,
  email_change_token_new,
  recovery_token,
  is_sso_user,
  is_anonymous
) VALUES (
  '00000000-0000-0000-0000-000000000000'::uuid,
  'e1b1c1d1-e1f1-a1b1-c1d1-e1f1a1b1c1d1'::uuid,
  'authenticated',
  'authenticated',
  'platform@mineops.com',
  '$2b$10$JiePxFoho6oUAiA2KRIQYub1rY0xXpjWOa9g8rqIkO2Veon5GK1KW', -- password123
  now(),
  null,
  null,
  '{"provider":"email","providers":["email"],"platform_role":"platform_owner"}'::jsonb,
  '{}'::jsonb,
  now(),
  now(),
  '',
  '',
  '',
  '',
  false,
  false
) ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.identities (
  id,
  user_id,
  identity_data,
  provider,
  provider_id,
  last_sign_in_at,
  created_at,
  updated_at
) VALUES (
  'e1b1c1d1-e1f1-a1b1-c1d1-e1f1a1b1c1d1'::uuid,
  'e1b1c1d1-e1f1-a1b1-c1d1-e1f1a1b1c1d1'::uuid,
  '{"sub":"e1b1c1d1-e1f1-a1b1-c1d1-e1f1a1b1c1d1","email":"platform@mineops.com","email_verified":true,"phone_verified":false}'::jsonb,
  'email',
  'e1b1c1d1-e1f1-a1b1-c1d1-e1f1a1b1c1d1',
  now(),
  now(),
  now()
) ON CONFLICT (provider_id, provider) DO NOTHING;

-- platform_roles table is created in migration 036; seed runs after migrations
INSERT INTO public.platform_roles (id, user_id, role)
VALUES (
  '00000000-0000-0000-0000-0000000000f1',
  'e1b1c1d1-e1f1-a1b1-c1d1-e1f1a1b1c1d1',
  'platform_owner'
) ON CONFLICT (user_id) DO NOTHING;

-- Add transport contractors
INSERT INTO public.transport_contractors (id, name, active, organization_id)
VALUES 
  ('00000000-0000-0000-0000-000000000201', 'Deccan Logistics Co', true, '00000000-0000-0000-0000-000000000000'),
  ('00000000-0000-0000-0000-000000000202', 'Vanguard Haulers Ltd', true, '00000000-0000-0000-0000-000000000000'),
  ('00000000-0000-0000-0000-000000000203', 'Speedways Transport', true, '00000000-0000-0000-0000-000000000000')
ON CONFLICT (id) DO NOTHING;

-- Add vehicles
INSERT INTO public.vehicles (id, plate_number, vehicle_type, ownership, default_contractor_id, active, organization_id)
VALUES 
  ('00000000-0000-0000-0000-000000000301', 'KA01MH1234', '12WH', 'rented', '00000000-0000-0000-0000-000000000201', true, '00000000-0000-0000-0000-000000000000'),
  ('00000000-0000-0000-0000-000000000302', 'KA01MH5678', '10WH', 'rented', '00000000-0000-0000-0000-000000000202', true, '00000000-0000-0000-0000-000000000000'),
  ('00000000-0000-0000-0000-000000000303', 'KA01MH9999', '6WH', 'owned', null, true, '00000000-0000-0000-0000-000000000000'),
  ('00000000-0000-0000-0000-000000000304', 'MH02XY1111', '12WH', 'rented', '00000000-0000-0000-0000-000000000203', true, '00000000-0000-0000-0000-000000000000'),
  ('00000000-0000-0000-0000-000000000305', 'MH02XY2222', '10WH', 'rented', '00000000-0000-0000-0000-000000000201', true, '00000000-0000-0000-0000-000000000000'),
  ('00000000-0000-0000-0000-000000000306', 'MH02XY3333', 'Other', 'owned', null, true, '00000000-0000-0000-0000-000000000000')
ON CONFLICT (id) DO NOTHING;

-- Add default drivers
INSERT INTO public.drivers (id, name, license_number, active, organization_id)
VALUES 
  ('00000000-0000-0000-0000-000000000401', 'Rajesh Kumar', 'DL-12345', true, '00000000-0000-0000-0000-000000000000'),
  ('00000000-0000-0000-0000-000000000402', 'Suresh Singh', 'DL-67890', true, '00000000-0000-0000-0000-000000000000'),
  ('00000000-0000-0000-0000-000000000403', 'Amit Patel', 'DL-11223', true, '00000000-0000-0000-0000-000000000000')
ON CONFLICT (id) DO NOTHING;

-- Add employees to sites
INSERT INTO public.employees (id, name, role, wage_type, wage_rate, site_id, active, join_date)
VALUES 
  ('00000000-0000-0000-0000-000000000501', 'John Doe Operator', 'supervisor', 'monthly', 25000.0, '00000000-0000-0000-0000-000000000001', true, '2026-07-01'),
  ('00000000-0000-0000-0000-000000000502', 'Ramesh Rao', 'worker', 'daily', 600.0, '00000000-0000-0000-0000-000000000001', true, '2026-07-02'),
  ('00000000-0000-0000-0000-000000000503', 'Sanjay Dutt', 'worker', 'daily', 550.0, '00000000-0000-0000-0000-000000000001', true, '2026-07-02'),
  ('00000000-0000-0000-0000-000000000504', 'Karan Johar', 'worker', 'daily', 500.0, '00000000-0000-0000-0000-000000000001', true, '2026-07-03'),
  ('00000000-0000-0000-0000-000000000505', 'Aditya Roy', 'driver', 'daily', 700.0, '00000000-0000-0000-0000-000000000001', true, '2026-07-03'),
  
  ('00000000-0000-0000-0000-000000000506', 'Alice Smith', 'supervisor', 'monthly', 30000.0, '00000000-0000-0000-0000-000000000002', true, '2026-07-01'),
  ('00000000-0000-0000-0000-000000000507', 'Bob Johnson', 'worker', 'daily', 650.0, '00000000-0000-0000-0000-000000000002', true, '2026-07-02'),
  ('00000000-0000-0000-0000-000000000508', 'Charlie Brown', 'worker', 'daily', 600.0, '00000000-0000-0000-0000-000000000002', true, '2026-07-02'),
  ('00000000-0000-0000-0000-000000000509', 'Diana Prince', 'worker', 'daily', 550.0, '00000000-0000-0000-0000-000000000002', true, '2026-07-03'),
  ('00000000-0000-0000-0000-000000000510', 'Ethan Hunt', 'driver', 'daily', 750.0, '00000000-0000-0000-0000-000000000002', true, '2026-07-03')
ON CONFLICT (id) DO NOTHING;

-- Seed initial cash book (today)
INSERT INTO public.cash_books (id, site_id, book_date, opening_balance, closing_balance, status, organization_id)
VALUES 
  ('00000000-0000-0000-0000-000000000601', '00000000-0000-0000-0000-000000000001', CURRENT_DATE, 50000.0, 50000.0, 'draft', '00000000-0000-0000-0000-000000000000')
ON CONFLICT (id) DO NOTHING;

-- Seed negotiated rates: ₹ per trip by vehicle type (field paper model, not ₹/m³)
INSERT INTO public.negotiated_rates (id, vehicle_type, rate_per_cubic, organization_id)
VALUES
  ('00000000-0000-0000-0000-000000000701', '12WH', 1000.0, '00000000-0000-0000-0000-000000000000'),
  ('00000000-0000-0000-0000-000000000702', '10WH', 800.0, '00000000-0000-0000-0000-000000000000'),
  ('00000000-0000-0000-0000-000000000703', '6WH', 600.0, '00000000-0000-0000-0000-000000000000')
ON CONFLICT (organization_id, vehicle_type) DO NOTHING;

-- Seed customers with trip rates (buyer-specific negotiated prices)
INSERT INTO public.customers (id, name, contact, active, organization_id, default_trip_rate, trip_rates)
VALUES
  (
    '00000000-0000-0000-0000-000000000801',
    'DSR Infra',
    null,
    true,
    '00000000-0000-0000-0000-000000000000',
    1000,
    '{"12WH": 1000, "10WH": 800, "6WH": 600}'::jsonb
  ),
  (
    '00000000-0000-0000-0000-000000000802',
    'Madha Buyer',
    null,
    true,
    '00000000-0000-0000-0000-000000000000',
    950,
    '{"12WH": 950, "10WH": 750}'::jsonb
  )
ON CONFLICT (id) DO NOTHING;
