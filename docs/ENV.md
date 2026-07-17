# MineOps environment variables

Single source of truth for configuration. Copy `frontend/.env.example` → `frontend/.env.local` for local dev.

## Required (app)

| Variable | Where | Purpose |
|----------|--------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Client + server | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client + server | Anon key (RLS enforced) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server only** | Admin/platform APIs, E2E seed — never `NEXT_PUBLIC_` |

## Platform bootstrap (Phase A)

| Variable | Purpose |
|----------|---------|
| `PLATFORM_BOOTSTRAP_SECRET` | **Required in production** when no platform owner exists yet. Body field `secret` on `POST /api/platform/bootstrap` must match. After the first owner is created, **rotate or remove** this value. |

Local development (`NODE_ENV !== production` and not `VERCEL_ENV=production`) may bootstrap without a secret if the env var is unset. If you set the secret in `.env.local`, the setup form still requires it.

## Optional

| Variable | Purpose |
|----------|---------|
| `E2E_ADMIN_EMAIL` | Playwright admin email (default `admin@mineops.com`) — **local/CI only** |
| `E2E_ADMIN_PASSWORD` | Playwright admin password — **local/CI only; never production** |
| `NODE_ENV` / `VERCEL_ENV` | Controls CSP, PWA, and bootstrap secret enforcement |
| `UPSTASH_REDIS_REST_URL` | Phase E5 durable rate limit (Upstash REST). With token, proxy uses Redis counters. |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash REST token — **server only**, never `NEXT_PUBLIC_` |

### Rate limiting (Phase 2)

| Environment | Recommendation |
|-------------|----------------|
| **Production / multi-instance (Vercel)** | **Strongly recommended:** set both Upstash vars. Without them, limits are **per isolate** (easy to bypass under load). App logs a one-time warning when memory backend is used in production. |
| **Local / single process** | In-memory is fine. |

Still set edge/WAF limits in production (Vercel / Cloudflare) as defense-in-depth.

CSP nonce pipeline (not enabled yet): `docs/CSP_NONCE.md`.

## Intentionally unused / removed

| Variable | Status |
|----------|--------|
| `REGISTRATION_INVITE_CODE` | Removed — public tenant registration is disabled |
| `REGISTRATION_DISABLED` | Removed — always platform-provisioned |
| `NEXT_PUBLIC_API_URL` | Not used (no separate API server) |

## Vercel

- Project **Root Directory**: `frontend`
- Set the three Supabase vars + `PLATFORM_BOOTSTRAP_SECRET` (for first boot) in Project Settings → Environment Variables
- Auth redirect URLs: site origin + `/` (see `docs/vercel_deployment_guide.md`)
- Full sequence: `docs/DEPLOYMENT_CHECKLIST.md`

## Password policy (API-created users)

See `frontend/src/lib/password-policy.ts`: min 10 characters, at least one letter and one number.

Local seed passwords (`password123`) are **weaker by design for E2E** and must never be used in production.
