# MineOps environment variables

Single source of truth for configuration. Copy `frontend/.env.example` → `frontend/.env.local` for local dev.

## Required (app)

| Variable | Where | Purpose |
|----------|--------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Client + server | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client + server | Anon key (RLS enforced) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server only** | Admin/platform APIs, E2E seed — never `NEXT_PUBLIC_` |

## Optional

| Variable | Purpose |
|----------|---------|
| `PLATFORM_BOOTSTRAP_SECRET` | If set, first-time `/api/platform/bootstrap` requires matching `secret` in body |
| `E2E_ADMIN_EMAIL` | Playwright admin email (default `admin@mineops.com`) |
| `E2E_ADMIN_PASSWORD` | Playwright admin password (default `password123`) |
| `NODE_ENV` | `development` / `production` (CSP and PWA behavior) |

## Intentionally unused / removed

| Variable | Status |
|----------|--------|
| `REGISTRATION_INVITE_CODE` | Removed — public tenant registration is disabled |
| `REGISTRATION_DISABLED` | Removed — always platform-provisioned |
| `NEXT_PUBLIC_API_URL` | Not used (no separate API server) |

## Vercel

- Project **Root Directory**: `frontend`
- Set the three Supabase vars in Project Settings → Environment Variables
- Auth redirect URLs: site origin + `/` (see `docs/vercel_deployment_guide.md`)

## Password policy (API-created users)

See `frontend/src/lib/password-policy.ts`: min 10 characters, at least one letter and one number.  
Local seed passwords may be weaker for E2E convenience.
