# MineOps deployment checklist (Phase A)

Use this before every production deploy. Order matters.

## 1. Database migrations (required)

Remote Supabase must include **all** migrations through the latest file in `supabase/migrations/`.

As of this document that is **`056_customer_trip_rates.sql`** (and everything before it, including **036–055**).  
After schema changes, regenerate or hand-update `frontend/src/lib/supabase/database.types.ts` — see `docs/SCHEMA_SSOT.md` (`npm run gen:types` when CLI is available).

```bash
# From repo root, linked project
supabase db push
# or review status
supabase migration list
```

**Do not** run `supabase/seed.sql` against production. Seed is for local/CI only.

If `platform_roles` or `is_platform_owner()` is missing, `/platform` and bootstrap will fail until migrations are applied.

## 2. Environment variables (Vercel / host)

| Variable | Required | Notes |
|----------|----------|--------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | **Server only** — never `NEXT_PUBLIC_` |
| `PLATFORM_BOOTSTRAP_SECRET` | **Yes in production** until first owner exists | Long random string (32+ chars). Required for `/platform/setup` in prod. |
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | **Strongly recommended in production** | Durable API rate limits across isolates. Without them, limits are per-process only. |

### After first platform owner is created

1. Confirm you can sign in and open `/platform`.
2. **Rotate or delete** `PLATFORM_BOOTSTRAP_SECRET` from the production environment (or set a new value you do not reuse).
3. Bootstrap returns **409** once any `platform_roles` row exists — the secret is no longer useful for attack *after* that, but removing it reduces residual risk if someone finds an old setup flow.

## 3. First platform owner

1. Set `PLATFORM_BOOTSTRAP_SECRET` on Vercel → Redeploy.
2. Open `https://<your-app>/platform/setup`.
3. Enter operator email, strong password (min 10, letter + number), and the bootstrap secret.
4. Sign in at `/` → should land on `/platform`.
5. Rotate/remove the secret (step 2 above).

Alternative: Supabase Auth create user + SQL  
`INSERT INTO platform_roles (user_id, role) VALUES ('…', 'platform_owner');`

## 4. Credentials policy

| Context | Allowed |
|---------|---------|
| Local `supabase db reset` seed | `admin@mineops.com` / `password123`, `platform@mineops.com` / `password123` — **dev only** |
| Production | Never use seed passwords. Never apply seed.sql. Use strong platform + tenant admin passwords (API policy: 10+ chars, letter + number). |
| E2E / CI | Defaults only against ephemeral local Supabase |

## 5. Frontend deploy

- Root directory: `frontend`
- `npm ci` / `npm run build` on Vercel
- CI: lint, audit:prod, typecheck, unit, build, e2e chromium + mobile smoke (see `.github/workflows/ci.yml`, `docs/TESTING.md`)

## 6. Smoke test after deploy

- [ ] Migrations list complete through **056** (and types/docs per `SCHEMA_SSOT.md`)  
- [ ] Reports: paper pack CSV + admin period close/purge (confirm DELETE; no purge over finalized payroll)  
- [ ] Last admin per org: cannot delete/demote sole admin of org A while org B still has admins (**047**)  
- [ ] Attendance frozen after payroll finalize for that month; empty finalize blocked; leave net-charge; settled amount &gt; 0 (**048**)  
- [ ] Tenant admin cannot set `organizations.active`; only platform can (**049**)  
- [ ] Remove user from Users page deletes Auth account via `/api/admin/delete-user` (**049** + API)  
- [ ] **Upstash** `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` set in production (recommended; memory backend logs a warning)  
- [ ] Storage buckets accept images only (MIME allowlist **049**)  
- [ ] `trip_photos.organization_id` present; manager policies include org match (**050**)
- [ ] Optional: `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` for durable API rate limits  
- [ ] Login as platform owner → `/platform`  
- [ ] Create org + admin (temp password)  
- [ ] Tenant admin login → `/dashboard`  
- [ ] `/api/platform/bootstrap` POST returns 409 if owner exists  
- [ ] Production without secret: GET bootstrap reports `blocked_by_missing_secret` when no owners yet  
- [ ] Disable a module on `/platform` org detail → tenant nav hides it; deep link redirects; writes raise feature error (**043/046**)  
- [ ] Disable **master_data** / **manage_employees** → creates fail at DB (Phase F **046**)  
- [ ] Leave force-approve then Undo restores prior attendance statuses (**046**)  
- [ ] Employee my-work trip photo upload works (storage policies **045**)  

## Related docs

- `docs/ENV.md` — variable reference  
- `docs/platform_owner_bootstrap.md` — owner login paths  
- `SECURITY.md` — architecture notes  
- `docs/CSP_NONCE.md` — CSP nonce long-term plan (E4)  

