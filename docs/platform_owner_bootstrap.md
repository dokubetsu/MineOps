# Platform owner — how to log in

**We did not previously create a platform owner account automatically.** The console at `/platform` only works after someone is in `platform_roles`. Use one of the paths below.

## Path A — First-time UI (recommended for production)

1. Apply migrations (must include **036**):
   ```bash
   supabase db push
   ```
2. Open **`/platform/setup`** (also linked from the sign-in page).
3. Enter **your email + password** → creates the first `platform_owner`.
4. Optional: set env `PLATFORM_BOOTSTRAP_SECRET` so bootstrap requires that secret.
5. Sign in on **`/`** with that email/password → you land on **`/platform`**.

Bootstrap only works when **zero** platform owners exist. After that it returns 409.

## Path B — Local seed (Supabase local / db reset)

After `supabase db reset`, seed includes:

| Email | Password | Role |
|-------|----------|------|
| `platform@mineops.com` | `password123` | platform_owner |
| `admin@mineops.com` | `password123` | tenant admin (demo org) |

Sign in as `platform@mineops.com` → `/platform`.

## Path C — Manual SQL (any environment)

1. Supabase Dashboard → Authentication → Add user (email confirmed).
2. SQL:

```sql
INSERT INTO public.platform_roles (user_id, role)
VALUES ('AUTH-USER-UUID-HERE', 'platform_owner')
ON CONFLICT (user_id) DO NOTHING;
```

3. Sign in with that email/password.

## Why `/platform` looked broken

If you were logged in as a **tenant admin** (e.g. `admin@mineops.com`) or the **036 migration was not applied**:

- `isPlatformOwner` was false  
- You only saw a spinner / redirect  
- No platform owner login existed  

Now the UI shows **“No platform access”** with a link to **setup**.

## After you can open `/platform`

1. **New organization** → company name + admin email + temp password + modules  
2. Share admin credentials with the customer  
3. They sign in as tenant admin and configure sites / managers / employees  

## APIs

| Endpoint | Purpose |
|----------|---------|
| `GET/POST /api/platform/bootstrap` | First owner only |
| `GET/POST /api/platform/orgs` | List / create orgs (platform owner JWT) |
| `PUT /api/platform/orgs/:id/features` | Feature flags |
| `POST /api/platform/orgs/:id/admins` | Extra tenant admins |
