-- Seed sites
INSERT INTO public.sites (id, name, location, active)
VALUES 
  ('00000000-0000-0000-0000-000000000001', 'Test Mine Site 1', 'North Quarry', true),
  ('00000000-0000-0000-0000-000000000002', 'Test Mine Site 2', 'South Quarry', true)
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
  '$2b$10$k9w6pk2UNlP4LCek3i57N.t8fFGCANArlAHjGgYUDgumh8vpmsBOC', -- verified bcrypt hash for password123
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
INSERT INTO public.user_roles (id, user_id, role, site_id)
VALUES ('00000000-0000-0000-0000-000000000100', 'd0a0b0c0-d0e0-f0a0-b0c0-d0e0f0a0b0c0', 'admin', null)
ON CONFLICT (id) DO NOTHING;

-- Add transport contractors
INSERT INTO public.transport_contractors (id, name, active)
VALUES 
  ('00000000-0000-0000-0000-000000000201', 'Deccan Logistics Co', true),
  ('00000000-0000-0000-0000-000000000202', 'Vanguard Haulers Ltd', true),
  ('00000000-0000-0000-0000-000000000203', 'Speedways Transport', true)
ON CONFLICT (id) DO NOTHING;

-- Add vehicles
INSERT INTO public.vehicles (id, plate_number, vehicle_type, ownership, default_contractor_id, active)
VALUES 
  ('00000000-0000-0000-0000-000000000301', 'KA01MH1234', '12WH', 'rented', '00000000-0000-0000-0000-000000000201', true),
  ('00000000-0000-0000-0000-000000000302', 'KA01MH5678', '10WH', 'rented', '00000000-0000-0000-0000-000000000202', true),
  ('00000000-0000-0000-0000-000000000303', 'KA01MH9999', '6WH', 'owned', null, true),
  ('00000000-0000-0000-0000-000000000304', 'MH02XY1111', '12WH', 'rented', '00000000-0000-0000-0000-000000000203', true),
  ('00000000-0000-0000-0000-000000000305', 'MH02XY2222', '10WH', 'rented', '00000000-0000-0000-0000-000000000201', true),
  ('00000000-0000-0000-0000-000000000306', 'MH02XY3333', 'Other', 'owned', null, true)
ON CONFLICT (id) DO NOTHING;

-- Add default drivers
INSERT INTO public.drivers (id, name, license_number, active)
VALUES 
  ('00000000-0000-0000-0000-000000000401', 'Rajesh Kumar', 'DL-12345', true),
  ('00000000-0000-0000-0000-000000000402', 'Suresh Singh', 'DL-67890', true),
  ('00000000-0000-0000-0000-000000000403', 'Amit Patel', 'DL-11223', true)
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
INSERT INTO public.cash_books (id, site_id, book_date, opening_balance, closing_balance, status)
VALUES 
  ('00000000-0000-0000-0000-000000000601', '00000000-0000-0000-0000-000000000001', CURRENT_DATE, 50000.0, 50000.0, 'draft')
ON CONFLICT (id) DO NOTHING;
