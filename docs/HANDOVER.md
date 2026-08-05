# Khani ERP — Platform Handover & Onboarding Brief

> **Purpose of this document:** You are inheriting a working, deployed production platform called **Khani**. This document tells you what the platform does, how it is structured, and where to find everything — so you can understand the system yourself, make changes, fix bugs, and extend features without prior context.

---

## What Khani Is

Khani is a **mine logistics, workforce, and operations management platform**. It replaces paper registers and Excel sheets used by mining/quarrying businesses in India to track daily operations.

The platform handles:

| Domain | What it manages |
|--------|----------------|
| **Trips** | Vehicle movement logs — plate number, vehicle type, cubic capacity, customer, drop location, distance, cost, advance payments, settlement, and trip photos |
| **Cash Book** | Daily site-level cash inflows (IN) and outflows (OUT) — categorized expenses like fuel/diesel, fastag, meals, advances, with optional transport contractor association |
| **Attendance** | Daily muster roll — mark employees Present / Absent / Half-day / Leave per site per day |
| **Leave Management** | Leave applications, approval workflows, leave balance tracking with payroll integration |
| **Payroll** | Monthly payroll generation from attendance data — supports daily-rate and monthly-rate employees, auto-calculates wages, generates payroll runs that can be finalized (which freezes the muster) |
| **Reports** | Downloadable CSV/Excel report packs — trips, cash flow, attendance, payroll summaries by day/week/month and site |
| **Employee Management** | Employee records with wage type, rate, bank details, site assignment, leave balance |
| **Stakeholders** | Site profit-sharing stakeholders with percentage allocation |
| **Settings** | Organization-level config — vehicle types, negotiated rates (per-vehicle-type trip rates and distance rates), customer management with per-customer pricing |
| **User Management** | Invite-based user provisioning with role-based access (admin, site_manager, site_employee) |

### Multi-Tenancy

Khani is a **multi-tenant SaaS platform**:

- A **platform owner** (super-admin) provisions **organizations** (tenants)
- Each organization has its own **admin** who manages sites, employees, and users
- **Site managers** and **site employees** are scoped to their assigned sites
- Row-Level Security (RLS) in the database enforces tenant isolation — every query is automatically filtered by `organization_id`

### Target Users

- **Mining/quarrying company owners** (admin role) — manage all operations from dashboard
- **Site managers** — mark attendance, log trips and expenses at their assigned site
- **Site employees / field workers** — log trips, expenses, and view their own work via the "My Work" mobile-first page

---

## Architecture Overview

### Technology Stack

| Component | Technology | Notes |
|-----------|-----------|-------|
| **Frontend** | Next.js 16 (App Router) | TypeScript, React 19, deployed on Vercel |
| **Styling** | Vanilla CSS | Design system in `globals.css` with CSS custom properties (dark teal + copper theme) |
| **Backend / API** | Next.js API Routes | Server-side routes under `src/app/api/` — no separate backend server |
| **Database** | Supabase (PostgreSQL) | Hosted Supabase project with RLS, triggers, and stored functions |
| **Auth** | Supabase Auth | Email/password, JWT-based sessions |
| **Storage** | Supabase Storage | Trip photo uploads in `trip-photos` bucket |
| **PWA** | next-pwa / Workbox | Installable mobile app with offline support |
| **Offline** | IndexedDB outbox | Trips and expenses queued offline, synced when connectivity returns |
| **Fonts** | Inter + Space Grotesk | Self-hosted via `next/font` (no external font requests for PWA/CSP compliance) |

### Repository Structure

```
d:\idea2\
├── frontend/                    # Next.js application (Vercel root directory)
│   ├── public/                  # Static assets (logo, manifest, icons, SW)
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx                    # Login page
│   │   │   ├── register/page.tsx           # (disabled — platform-provisioned only)
│   │   │   ├── layout.tsx                  # Root layout (fonts, metadata, PWA)
│   │   │   ├── globals.css                 # Complete design system
│   │   │   ├── dashboard/                  # Main tenant app
│   │   │   │   ├── layout.tsx              # Sidebar + mobile nav + role-based routing
│   │   │   │   ├── page.tsx                # Dashboard home (stats & overview)
│   │   │   │   ├── trips/page.tsx          # Trip log management
│   │   │   │   ├── cash-book/page.tsx      # Cash book (IN/OUT ledger)
│   │   │   │   ├── attendance/page.tsx     # Daily muster roll
│   │   │   │   ├── leave/page.tsx          # Leave applications
│   │   │   │   ├── payroll/page.tsx        # Payroll generation & finalization
│   │   │   │   ├── reports/page.tsx        # Downloadable report packs
│   │   │   │   ├── manage-employees/page.tsx   # Employee CRUD
│   │   │   │   ├── stakeholder/page.tsx    # Site stakeholder shares
│   │   │   │   ├── settings/page.tsx       # Org rates, customers, vehicle config
│   │   │   │   ├── users/page.tsx          # User management & role assignment
│   │   │   │   └── my-work/page.tsx        # Mobile-first field worker page
│   │   │   ├── platform/                   # Platform owner console
│   │   │   │   ├── layout.tsx              # Platform sidebar
│   │   │   │   ├── page.tsx                # Organization management
│   │   │   │   └── setup/page.tsx          # First-time bootstrap
│   │   │   └── api/                        # Server-side API routes
│   │   │       ├── platform/bootstrap/     # First owner creation
│   │   │       ├── platform/orgs/          # Org CRUD
│   │   │       ├── admin/create-user/      # User provisioning
│   │   │       ├── admin/delete-user/      # User removal
│   │   │       ├── admin/list-users/       # User listing
│   │   │       └── admin/period-ops/       # Month-end data operations
│   │   ├── components/                     # Shared UI components
│   │   │   ├── BottomSheet.tsx             # Mobile bottom sheet modal
│   │   │   ├── ConfirmDialog.tsx           # Confirmation dialog
│   │   │   ├── ContractorInput.tsx         # Contractor combobox (dropdown + free text)
│   │   │   ├── OfflineBanner.tsx           # Offline status indicator + sync
│   │   │   ├── PageHeader.tsx              # Standard page header
│   │   │   └── PageSpinner.tsx             # Loading spinner
│   │   ├── lib/                            # Business logic & utilities
│   │   │   ├── auth-context.tsx            # Auth provider (session, role, org)
│   │   │   ├── calculations.ts             # Wage & payroll math
│   │   │   ├── trip-constants.ts           # Vehicle types, capacity, expense categories
│   │   │   ├── features.ts                 # Feature flags per org
│   │   │   ├── offline-outbox.ts           # IndexedDB offline queue
│   │   │   ├── offline-cache.ts            # Offline data caching
│   │   │   ├── offline-photo-store.ts      # Offline photo storage
│   │   │   ├── resolve-contractor.ts       # Contractor name resolution
│   │   │   ├── rate-limit.ts               # API rate limiting (memory / Upstash)
│   │   │   ├── report-stats.ts             # Report generation logic
│   │   │   ├── password-policy.ts          # Password strength rules
│   │   │   ├── platform-auth.ts            # Platform owner auth checks
│   │   │   ├── repositories/              # Data access layer
│   │   │   │   ├── trips.ts               # Trip CRUD + settlement
│   │   │   │   ├── cash-book.ts           # Cash entry CRUD
│   │   │   │   ├── attendance.ts          # Muster roll operations
│   │   │   │   ├── leave.ts              # Leave application CRUD
│   │   │   │   ├── payroll.ts            # Payroll generation & finalization
│   │   │   │   └── sites.ts             # Site queries
│   │   │   └── supabase/                 # Supabase client setup + types
│   │   └── proxy.ts                       # Auth redirect middleware (Next.js 16)
│   ├── tests/                             # Playwright E2E + unit tests
│   ├── package.json
│   └── next.config.ts
├── supabase/
│   ├── migrations/                        # Numbered SQL migrations (source of truth)
│   │   ├── 000_initial_schema.sql … 069_delete_organization_helper.sql
│   ├── schema.sql                         # Reference dump (not applied directly)
│   ├── seed.sql                           # Local/CI seed data only (NEVER production)
│   └── config.toml
└── docs/                                  # Operational documentation
    ├── CLIENT_ONBOARDING.md               # First-client brief (settle → cash IN; share models)
    ├── CLIENT_DEPLOY.md                   # Client go-live (Supabase + Vercel)
    ├── ENV.md                             # Environment variables reference
    ├── SCHEMA_SSOT.md                     # Schema source-of-truth process
    ├── DEPLOYMENT_CHECKLIST.md            # Step-by-step deploy guide
    ├── platform_owner_bootstrap.md        # First platform owner setup
    ├── wage_policy.md                     # Payroll & attendance business rules
    ├── TESTING.md                         # Test strategy & commands
    └── vercel_deployment_guide.md         # Vercel-specific deployment
```

---

## Key Business Rules to Know

These rules are **hardcoded into the platform logic** — changing them requires understanding the full chain (DB triggers → repository layer → UI):

### Attendance & Payroll
- **Daily wage** = (present + half_day × 0.5 + leave) × daily_rate
- **Monthly wage** = monthly_rate × max(0, eligible_days − absent − half_day×0.5) / calendar_days
- `eligible_days` respects `join_date` (mid-month joiners are prorated)
- Leave does **not** reduce monthly salary
- Unmarked days do **not** reduce monthly salary — managers must explicitly mark "Absent"
- Finalizing payroll **recomputes wages from attendance** then **freezes the muster** for that month

### Stakeholder vs reports pack
- Stakeholder portal: % of **cash net** (registered `share_percent`)
- Reports business pack: manual % of **trip value** (Excel-style split; independent of stakeholder rows)
- See `docs/CLIENT_ONBOARDING.md` for the client talking points

### Trip Pricing
- **Total trip cost** = customer rate (₹/m³) × cubic capacity — resolved in order: Customer type rate → Customer default rate → Org type rate → manual entry
- Site employees **cannot override** the rate when one exists (field is locked)
- **Settling** a trip posts cash book **IN** (Trip settlement collection) by default
- **Reporting-only fields** (not added to total cost): distance (km), distance cost, drop location, permit, load info
- Distance cost = distance_km × rate_per_km is tracked for reports only

### Leave Balance
- New employees start with 15 days leave balance
- Approving leave deducts from balance (only net-new days not already marked as leave)
- Balance is enforced — approval fails if insufficient

### Cash Book
- Transport contractor field is **optional** for fuel/diesel and fastag expenses
- Contractor dropdown supports both selection from existing contractors and free-text entry of new ones

---

## How to Work With This Codebase

### Local Development
```bash
cd frontend
npm install
npm run dev          # Start dev server on localhost:3000
```

Requires `.env.local` with Supabase credentials (see `docs/ENV.md`).

### Database Changes
1. Create a new numbered migration file in `supabase/migrations/`
2. Apply with `supabase db push` (or use the Supabase MCP tool)
3. Regenerate types: `npm run gen:types`
4. Run `npm run typecheck` to verify

The **source of truth** for the database schema is always the migration files, never the schema dump.

### Deploying
- Frontend deploys to **Vercel** (auto-deploy on push to `main`)
- Vercel root directory is set to `frontend`
- Database migrations must be applied separately via `supabase db push` or MCP

### Testing
```bash
cd frontend
npx playwright test tests/unit/     # Unit tests
npx playwright test tests/e2e/      # E2E tests (needs local Supabase)
npm run typecheck                    # TypeScript check
```

### Making UI Changes
- All styling goes through CSS custom properties in `globals.css`
- Brand colors: `--accent` (teal `#2a7d87`), `--gem` (copper `#c87941`)
- Pages are large single-file components with inline state management (no Redux/Zustand)
- Mobile-first: the `my-work` page is the primary field-worker interface

---

## Important Files to Read First

If you're starting fresh, read these files in order:

1. **`docs/ENV.md`** — understand what environment variables exist
2. **`docs/DEPLOYMENT_CHECKLIST.md`** — understand the deploy process
3. **`docs/wage_policy.md`** — understand the core business rules
4. **`docs/SCHEMA_SSOT.md`** — understand the schema management process
5. **`frontend/src/lib/trip-constants.ts`** — vehicle types, expense categories, rate resolution
6. **`frontend/src/lib/calculations.ts`** — payroll math
7. **`frontend/src/lib/auth-context.tsx`** — how auth, roles, and org context work
8. **`frontend/src/app/dashboard/layout.tsx`** — how navigation and role-based access works
9. **`frontend/src/app/globals.css`** — the design system

---

## Credentials (Development Only)

| Email | Password | Role | Environment |
|-------|----------|------|-------------|
| `platform@khani.com` | `password123` | Platform owner | Local seed only |
| `admin@khani.com` | `password123` | Tenant admin (demo org) | Local seed only |

**Never use these in production.** Production credentials are created via the bootstrap flow or platform console.

---

## Supabase Project

- **Project ID**: `fnwbdxtspbovcvefemwn`
- Migrations are applied via `supabase db push` or the Supabase MCP `apply_migration` tool
- RLS is enforced on all tables — every query must go through an authenticated Supabase client
- Key tables: `organizations`, `sites`, `employees`, `trips`, `cash_entries`, `attendance`, `payroll_runs`, `payroll_lines`, `leave_applications`, `transport_contractors`, `negotiated_rates`, `customers`, `stakeholders`, `platform_roles`

---

## What "Done" Looks Like

When making changes:
1. `npx tsc --noEmit` passes with zero errors
2. `npx playwright test tests/unit/` passes
3. Changes are committed and pushed to `main`
4. Vercel build succeeds (check the deployment log — no JSX mismatches, no missing properties)
5. If database schema was changed, migration was applied via Supabase

---

> **Final note:** The codebase has extensive inline comments and the `docs/` folder covers operational procedures. When in doubt about a business rule, check `docs/wage_policy.md`. When in doubt about schema, check the latest migration files. When in doubt about deployment, check `docs/DEPLOYMENT_CHECKLIST.md`.
