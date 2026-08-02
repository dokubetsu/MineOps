# Client Go-Live Guide: Supabase + Vercel Setup

This guide provides the exact step-by-step procedure for deploying a new dedicated **Khani ERP** instance on Supabase and Vercel for a client handover.

---

## Order Cheat-Sheet

```
Supabase project → db push (064) → Upstash → Vercel (frontend + env) → Auth URLs → /platform/setup → remove bootstrap secret → create org/admin → master data → smoke → client brief
```

---

## 0. Preparation

1. **Strategy**: Create a new, empty Supabase project (recommended for new clients) + a new Vercel project pointed at the Khani GitHub repo.
2. **CLI**: Ensure Supabase CLI is authenticated:
   ```bash
   supabase login
   ```
3. **Bootstrap Secret**: Generate a long random secret (32+ characters) for `PLATFORM_BOOTSTRAP_SECRET`.
4. **Upstash Redis**: (Recommended) Create an Upstash Redis REST database for rate limiting across Vercel isolates.
5. **Rule**: **NEVER** run `supabase/seed.sql` on a client production database.

---

## 1. Create Supabase Project

1. Open **Supabase Dashboard** → **New Project** (select a region close to the client).
2. Save the credentials:
   - **Project URL** (`NEXT_PUBLIC_SUPABASE_URL`)
   - **anon key** (`NEXT_PUBLIC_SUPABASE_ANON_KEY`)
   - **service_role key** (`SUPABASE_SERVICE_ROLE_KEY` — *keep secret, server-only*)
3. **Authentication Settings**:
   - Authentication → Providers: Ensure **Email** is enabled.
   - Set "Confirm email" to OFF for field ops users provisioned via platform/admin APIs (or manually confirm users).

---

## 2. Apply Migrations (Through 064)

From the repository root (not `frontend/`):

```bash
supabase link --project-ref <CLIENT_PROJECT_REF>
supabase db push
supabase migration list
```

- Confirm remote includes `064_offline_idempotency_dashboard_rollup.sql`.
- Buckets (`trip-photos`, `attendance-photos`, `cash-receipts`) are automatically created and configured by SQL migrations.

---

## 3. Create Upstash Redis (Recommended)

1. Create a Redis database in Upstash → copy **REST URL** + **REST TOKEN**.
2. Save these for Vercel environment variables (`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`).
3. *(Optional Hardening)* Set `RATE_LIMIT_REQUIRE_UPSTASH=1` so production fails closed if Redis is unreachable.

---

## 4. Deploy Frontend on Vercel

1. Vercel Dashboard → **Add New** → **Project** → Import the Khani GitHub repo.
2. **Root Directory**: `frontend` *(CRITICAL)*.
3. Framework: **Next.js** (default), Build Command: `npm run build` (default).
4. Environment Variables (Production):

| Variable | Required | Value / Notes |
|----------|----------|---------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase Anon Key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase Service Role Key (*Server-only*) |
| `PLATFORM_BOOTSTRAP_SECRET` | Yes | 32+ char secret (*until first owner exists*) |
| `UPSTASH_REDIS_REST_URL` | Recommended | Upstash REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Recommended | Upstash REST Token |
| `RATE_LIMIT_REQUIRE_UPSTASH` | Optional | Set to `1` to fail closed without Redis |

5. Deploy. Copy the production URL (e.g. `https://client-khani.vercel.app`).

---

## 5. Wire Supabase Auth to Live Domain

In **Supabase Dashboard** → **Authentication** → **URL Configuration**:

- **Site URL**: `https://<your-vercel-domain>/`
- **Redirect URLs**:
  - `https://<your-vercel-domain>/**`
  - `https://<your-vercel-domain>/dashboard`

*(If adding a custom domain later, remember to update Site URL and Redirect URLs in Supabase).*

---

## 6. Bootstrap Platform Owner

1. Open `https://<your-vercel-domain>/platform/setup`.
2. Create first platform owner:
   - Operator Email
   - Strong Password (12+ chars, letter, number, special char)
   - Bootstrap Secret (matching `PLATFORM_BOOTSTRAP_SECRET`)
3. Sign in at `/` → verify landing on `/platform`.
4. **Immediately remove or rotate `PLATFORM_BOOTSTRAP_SECRET`** in Vercel.
   *(Bootstrap automatically locks permanently (returns 409) once any `platform_roles` record exists).*

*Fallback if UI setup is blocked:*
Create user in Supabase Auth Dashboard (mark email confirmed), then run SQL:
```sql
INSERT INTO public.platform_roles (user_id, role)
VALUES ('<AUTH-USER-UUID-HERE>', 'platform_owner');
```

---

## 7. Provision Client Tenant

From `/platform` console:

1. **Create Organization**: Enter company name.
2. **Create Tenant Admin**: Email + temporary password + enable required modules.
3. Share admin credentials out-of-band with client lead.
4. Tenant admin signs in at `/` → lands on `/dashboard`.

As Tenant Admin / Site Manager:
- Setup **Sites**, **Customers**, **Vehicles**, **Org Rates (₹/m³)**.
- Provision **Users**, **Site Managers**, **Field Workers** + assign sites.
- Setup **Stakeholders** if profit-share portal is required.

---

## 8. Smoke Testing Before Handover

Verify minimum go-live criteria:

- [ ] All migrations through `064` applied to remote Supabase.
- [ ] Platform owner logs into `/platform`.
- [ ] Organization + tenant admin created and logs into `/dashboard`.
- [ ] Log one test trip: Rate × CC auto-calculates; settlement posts cash IN collection.
- [ ] Photo upload on *My Work* / cash receipt.
- [ ] Upstash rate limiting active (or accepted per-isolate memory limits).
- [ ] `/platform/setup` returns 409 Conflict when attempted again.
- [ ] Brief client team with `docs/CLIENT_ONBOARDING.md`.

---

## 9. Handover Hygiene & Operations

1. **Credentials**: Never share `SUPABASE_SERVICE_ROLE_KEY` or `PLATFORM_BOOTSTRAP_SECRET` with clients.
2. **Platform Access**: Keep primary platform owner account under your team's control.
3. **Documentation**: Record Vercel URL, Supabase Project Ref, and subscription/billing ownership.
4. **Ongoing Deploys**:
   - Pushing code to `main` branch auto-deploys to Vercel.
   - For database schema changes: run `supabase db push` against client project **before** deploying dependent frontend code.
