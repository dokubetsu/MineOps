-- Seed a test site
INSERT INTO public.sites (id, name, location, active)
VALUES ('00000000-0000-0000-0000-000000000001', 'Test Mine Site 1', 'Test Location', true)
ON CONFLICT (id) DO NOTHING;

-- Seed an auth user in Supabase Auth (using pgcrypto's crypt function to generate password123 hash)
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
  recovery_token
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  'd0a0b0c0-d0e0-f0a0-b0c0-d0e0f0a0b0c0',
  'authenticated',
  'authenticated',
  'admin@mineops.com',
  crypt('password123', gen_salt('bf')),
  now(),
  null,
  null,
  '{"provider":"email","providers":["email"]}',
  '{}',
  now(),
  now(),
  '',
  '',
  '',
  ''
) ON CONFLICT (id) DO NOTHING;

-- Seed an auth identity in Supabase Auth (required for email provider logins to succeed)
INSERT INTO auth.identities (
  id,
  user_id,
  identity_data,
  provider,
  provider_id,
  email,
  last_sign_in_at,
  created_at,
  updated_at
) VALUES (
  'd0a0b0c0-d0e0-f0a0-b0c0-d0e0f0a0b0c0',
  'd0a0b0c0-d0e0-f0a0-b0c0-d0e0f0a0b0c0',
  jsonb_build_object('sub', 'd0a0b0c0-d0e0-f0a0-b0c0-d0e0f0a0b0c0', 'email', 'admin@mineops.com', 'email_verified', true, 'phone_verified', false),
  'email',
  'd0a0b0c0-d0e0-f0a0-b0c0-d0e0f0a0b0c0',
  'admin@mineops.com',
  now(),
  now(),
  now()
) ON CONFLICT (provider_id, provider) DO NOTHING;

-- Grant admin role to the user in user_roles
INSERT INTO public.user_roles (id, user_id, role, site_id)
VALUES ('00000000-0000-0000-0000-000000000002', 'd0a0b0c0-d0e0-f0a0-b0c0-d0e0f0a0b0c0', 'admin', null)
ON CONFLICT (id) DO NOTHING;

-- Add a default employee to the site for payroll/attendance E2E testing
INSERT INTO public.employees (id, name, role, wage_type, wage_rate, site_id, active, join_date)
VALUES ('00000000-0000-0000-0000-000000000003', 'John Doe Operator', 'Operator', 'daily', 500.0, '00000000-0000-0000-0000-000000000001', true, '2026-07-01')
ON CONFLICT (id) DO NOTHING;

-- Add a transport contractor and vehicle for E2E trips testing
INSERT INTO public.transport_contractors (id, name, active)
VALUES ('00000000-0000-0000-0000-000000000004', 'Test Logistics Co', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.vehicles (id, plate_number, vehicle_type, ownership, default_contractor_id, active)
VALUES ('00000000-0000-0000-0000-000000000005', 'KA01MH1234', '12WH', 'rented', '00000000-0000-0000-0000-000000000004', true)
ON CONFLICT (id) DO NOTHING;
