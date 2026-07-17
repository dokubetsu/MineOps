# MineOps — Mine Logistics & Workforce Management

A mobile-first full-stack PWA web application designed to digitize manual mine registers, trip sheets, cash books, attendance rosters, payroll, and stakeholder revenue sharing calculations.

---

## Architecture & Technology Stack

MineOps uses a streamlined architecture (Option A: client-to-database backend-less model) to reduce duplicate logic and technical debt:

| Component | Technology | Purpose / Role |
|---|---|---|
| **Frontend & Server Routes** | Next.js 16 (App Router) + TypeScript + CSS Modules | Mobile-first responsive UI, PWA features, offline readiness, and server routes for secure admin actions |
| **Database & Calculations** | PostgreSQL (via Supabase) | Persistent storage, relational constraints, triggers, views, and SECURITY DEFINER RPCs |
| **Auth** | Supabase Auth | Session tracking and secure JWT-based verification |
| **Storage** | Supabase Storage | Private image buckets for trip slips, cash receipts, and attendance evidence |
| **Styling** | Vanilla CSS (Dark & Light modes supported) | Theme with native UI elements |

---

## Project Structure

```
├── frontend/              # Next.js 16 React application
│   ├── src/
│   │   ├── app/           # App router pages and API route handlers
│   │   └── lib/
│   │       ├── calculations.ts   # Pure business math (payroll, cash, shares)
│   │       ├── offline-cache.ts  # TTL + org/user-scoped offline cache
│   │       └── supabase/
│   │           └── database.types.ts
│   ├── tests/e2e/         # Playwright unit + integration flows
│   ├── playwright.config.ts
│   └── package.json
│
├── supabase/
│   ├── migrations/        # Ordered SQL migrations (000–033+)
│   ├── seed.sql           # Local demo org, sites, employees, admin user
│   └── config.toml
│
└── .github/workflows/ci.yml
```

---

## Application Authentication & Users

For security, production credentials are not stored in source control. Access is managed via Supabase Auth + `user_roles`:

- **Admin**: `role = 'admin'` in `user_roles` (full tenant control)
- **Site Manager**: `role = 'site_manager'` with `site_id` scope
- **Stakeholder**: read-only revenue views via `stakeholder_site_access`
- **Employee / Site Employee**: workforce self-service surfaces

**Local / E2E demo admin** (seeded + Playwright global-setup):

- Email: `admin@mineops.com`
- Password: `password123`

**Multi-tenant model**

- Each mining company is an `organizations` row with its own tenant `admin`.
- **Platform owner** (`platform_roles.platform_owner`) is a separate control-plane role: create orgs, set first admin passwords, enable/disable modules per org via `/platform`.
- Public self-registration is **disabled**. Bootstrap the first platform owner (see `docs/platform_owner_bootstrap.md`), then provision customers from the platform console.
- Tenant `admin` creates site managers / employees inside their org only.

---

## Getting Started

### 1. Database Setup

Apply all Supabase migrations (currently through **`034_atomic_finalize_and_leave_balance.sql`**, covering master tables, multi-tenant RLS, storage, payroll locks, JWT claim sync, register/provision lockdown, atomic payroll finalize, leave balance deduction, and more):

```bash
# From repo root — requires Docker + Supabase CLI
supabase start
# or against a linked project:
supabase db push
```

Local seed (`supabase/seed.sql`) creates a demo organization, sites, employees, vehicles, and the E2E admin user.

### 2. Run the Frontend (Next.js)

```bash
cd frontend
cp .env.example .env.local   # set Supabase URL, anon key, service role key
npm install
npm run dev
# → http://localhost:3000
```

Recommended env for local:

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase API URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser client key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only admin routes / E2E setup |
| `REGISTRATION_INVITE_CODE` | Required to enable tenant registration |
| `REGISTRATION_DISABLED` | Set `true` to force-disable registration |

---

## Running Tests

```bash
cd frontend
npm run lint          # ESLint (generated PWA assets excluded)
npm run test          # TypeScript --noEmit
npm run audit:prod    # npm audit --omit=dev
npm run build
npm run test:e2e      # Playwright (global-setup seeds admin via service role)
```

Calculation unit cases import `src/lib/calculations.ts` so tests track production payroll proration and cash-balance math.

---

## CI/CD & Deployments

- **CI**: GitHub Actions on push/PR to `main` — lint, production audit, typecheck, build, Playwright e2e against local Supabase.
- **Frontend Hosting**: Vercel (root directory `frontend`). See `docs/vercel_deployment_guide.md`.

---

## Security notes

- Admin user creation is atomic: Auth user + `provision_user_access` RPC; Auth is rolled back on any failure (no partial 207 users).
- Offline cache is user/org namespaced with TTL; signed URLs are never stored; cache is purged on logout.
- Production CSP drops `unsafe-eval` and localhost Supabase endpoints; development keeps them for local stacks.
