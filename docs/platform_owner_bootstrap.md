# Platform owner — bootstrap and login

The console at `/platform` only works after someone is in `public.platform_roles` with role `platform_owner`.

## Path A — Production first-time UI (required secret)

1. **Apply migrations** through the latest file (at least **042**):
   ```bash
   supabase db push
   ```
   See `docs/DEPLOYMENT_CHECKLIST.md`.

2. Set **`PLATFORM_BOOTSTRAP_SECRET`** in Vercel Production to a long random string (32+ characters). Redeploy.

3. Open **`/platform/setup`**.

4. Enter:
   - Operator email  
   - Strong password (min 10 chars, letter + number)  
   - The same bootstrap secret  

5. Sign in on **`/`** → you should land on **`/platform`**.

6. **Immediately rotate or delete `PLATFORM_BOOTSTRAP_SECRET`** from the production environment.  
   After any owner exists, bootstrap returns **409** forever (for that project). Keeping a leftover secret is unnecessary risk.

### Production rules (Phase A)

| Condition | Behavior |
|-----------|----------|
| `NODE_ENV=production` or `VERCEL_ENV=production` and secret **missing** | Bootstrap **blocked** (503 / setup UI explains) |
| Secret set, wrong `secret` in form | **403** |
| Any row in `platform_roles` | **409** — bootstrap closed |

## Path B — Local seed only (never production)

After `supabase db reset` (local Docker Supabase):

| Email | Password | Role |
|-------|----------|------|
| `platform@mineops.com` | `password123` | platform_owner |
| `admin@mineops.com` | `password123` | tenant admin (demo org) |

These passwords are **dev/E2E only**. Do **not** apply `seed.sql` to production. Do **not** reuse them live.

Local bootstrap without a secret is allowed when `PLATFORM_BOOTSTRAP_SECRET` is unset and not production.

## Path C — Manual SQL (any environment)

1. Supabase Dashboard → Authentication → Add user (email confirmed).  
2. SQL:

```sql
INSERT INTO public.platform_roles (user_id, role)
VALUES ('AUTH-USER-UUID-HERE', 'platform_owner')
ON CONFLICT (user_id) DO NOTHING;
```

3. Sign in with that email/password.

Use Path C if bootstrap is already closed and you need a second operator.

## After you can open `/platform`

1. **New organization** → company name + admin email + temp password + modules  
2. Share admin credentials **out of band** (not in git/Slack public channels)  
3. Tenant admin signs in → `/dashboard` → sites, managers, employees  

## APIs

| Endpoint | Purpose |
|----------|---------|
| `GET/POST /api/platform/bootstrap` | First owner only; prod requires secret |
| `GET/POST /api/platform/orgs` | List / create orgs (platform owner JWT) |
| `PUT /api/platform/orgs/:id/features` | Feature flags |
| `POST /api/platform/orgs/:id/admins` | Extra tenant admins |
