# Khani Security Blueprint & Compliance Document

This document outlines the security architecture, threat models, and explicit design decisions made for Khani.

## 🛡️ Database-Level Security (Row-Level Security)

Khani relies on Supabase (PostgreSQL) Row-Level Security (RLS) to enforce data boundaries. Since the Next.js client interacts directly with the database using the authenticated client, every operation is validated using security context:

- **Admin Role**: Full access to all sites, data configurations, and user assignments.
- **Site Manager Role**: Restricted access. Managers can only perform CRUD operations on resources associated with sites they are actively assigned to in the `user_roles` mapping.
- **Stakeholder Role**: Read-only access to daily and monthly transaction summaries, scoped to their specific `stakeholder_site_access` share percentages.

### Security Definer Context
Security Definer functions (`get_user_role` and `get_user_site_ids`) are explicitly protected against injection by defining a clean search path:
```sql
ALTER FUNCTION public.get_user_role() SET search_path = public, pg_temp;
```

---

## 📷 Photo Storage & Access Control

### Trips and Attendance Photo Buckets
Trips and attendance images are stored in **private** storage buckets (`public = false`) to guarantee data confidentiality:
1. **Access Control**: Short-lived signed URLs (valid for 3600 seconds) are generated programmatically on the client and server to render images securely.
2. **Exposure Risk**: Because the buckets are private, unauthenticated users cannot access images directly, even if they obtain the raw object paths. Access is restricted to authenticated users via bucket policies and short-lived signed URLs.

---

## 🔐 Administrative Account Creation

User provisioning is decoupled from client auth to prevent unauthorized account creation. Bypassing email confirmation and assigning roles is executed via a server-side route handler:
- **Location**: `/api/admin/create-user/route.ts`
- **Security Check**: This route validates the caller's JWT bearer token, checks the caller's `user_roles` entry to ensure they are an active **admin**, and only executes the user creation if authorized.
- **Key Protection**: `SUPABASE_SERVICE_ROLE_KEY` is kept strictly server-side and is never exposed in browser headers.

## 📋 Audit logging

`public.audit_logs` records sensitive operational events (admins can SELECT within their org):

| Action | Source |
|--------|--------|
| `settle_trip`, `lock_cash_book`, `unlock_cash_book`, `finalize_payroll` | Table triggers (`audit_table_action`) |
| `approve_leave` / `reject_leave` | Leave application status updates |
| `approve_leave_rpc` | Leave approve RPC (extra detail: days, site) |
| `assign_role` / `update_role` / `revoke_role` | `user_roles` INSERT/UPDATE/DELETE |
| `create_user`, `platform_create_org`, … | Explicit inserts from API routes |

Helper: `write_audit_event(...)` for SECURITY DEFINER RPCs. See migrations `041` + **`045` (Phase E)**.

### Phase 0 (migration 047)

Last-admin DELETE/demotion checks are **scoped per `organization_id`** (global count from 011 was incorrect after multi-tenant). Bootstrap refuses existing Auth emails by default; password for `force_existing` is set only after `claim_first_platform_owner` succeeds.

### Phase 1 (migration 048)

Attendance INSERT/UPDATE/DELETE blocked when the employee’s site has a **finalized** payroll for that calendar month. Leave approve charges only days not already muster Leave; unapprove restores that net charge. Finalize requires ≥1 line. Settled trips require `settlement_amount > 0`. Stakeholder share sum ≤ 100% reaffirmed.

### Phase 2 (migration 049 + APIs)

- **Org active lock:** tenant admins cannot change `organizations.active` (platform/service only); rename still allowed.
- **user_roles INSERT:** authenticated clients cannot INSERT roles (orphan UUID claim closed); provision via service-role `provision_user_access` / create-user API only. Admins retain SELECT/UPDATE/DELETE in-org.
- **Delete user:** `POST /api/admin/delete-user` revokes roles + deletes Auth user (audit logged); UI wired.
- **Proxy roles:** dashboard role redirects always load `user_roles` from DB (not JWT `app_metadata`).
- **Rate limit:** production logs if Upstash is not configured (in-memory fallback).
- **Storage MIME:** trip/attendance/cash-receipt buckets limited to image types + 5MB.

### Phase 3 (migration 050)

- **`trip_photos.organization_id`** denormalized from parent trip; stamp trigger; indexes on `trip_id` / org.
- **Tighter trip_photos RLS** (select/insert/update/delete by role; org required; employees delete only own trips’ photos).
- **Manager/employee policies** add `organization_id = get_user_organization_id()` defense-in-depth on operational tables.
- **Indexes:** customers(org), leave (org,status) / (employee,status), attendance (employee,date), trips (site,date) partial active.
- **Types:** hand-patched + `npm run gen:types` documented in `docs/SCHEMA_SSOT.md`.
- **051–052:** feature write gate never uses static `NEW.site_id` on multi-table triggers (use `to_jsonb`); skip gate when `auth.uid()` is null so seed/CI works.
- **053:** explicit `GRANT` of public tables to `service_role` / `authenticated` (Supabase no longer auto-exposes new tables).

### Phase 4 (frontend quality)

- Shared `toErrorMessage` for catch paths; reduced page-level `catch (err: any)`.
- BottomSheet / ConfirmDialog: `role="dialog"`, `aria-modal`, Escape, focus trap.
- Dashboard + platform `loading.tsx` / `error.tsx`.
- Shared `trip-constants` for vehicle types / capacity / expense categories.
- ESLint warning budget ratcheted **180 → 145** (~140 warnings remaining; mostly react-hooks set-state-in-effect).

### Phase 5 (testing)

- Scripts: `typecheck`, `test` (= typecheck + unit), `test:unit`, `test:e2e`, `test:e2e:mobile`, `test:all`.
- Specs split: `tests/unit/**` vs `tests/e2e/**`; mobile Pixel 5 smoke on `phase5-critical`.
- Multi-tenant last-admin probe + attendance unmark / cash lock e2e helpers.
- Docs: `docs/TESTING.md`.

### Phase E–F audit binding

`write_audit_event` stamps `organization_id` from the **actor’s org** for tenant callers (foreign `p_organization_id` is ignored and recorded in metadata). Platform owners and `service_role` may pass an explicit org. Direct `EXECUTE` is revoked from `authenticated` so clients cannot insert arbitrary audit rows. `actor_user_id` may be null for pure service events (migration **046**).

### Feature write gates (046)

DB triggers enforce features on INSERT/UPDATE/**DELETE** for operational tables **and** `employees`, `sites`, `vehicles`, `drivers`, `contractors`, `customers`, `negotiated_rates`, `user_roles`, `stakeholder_site_access`. Bootstrap uses `claim_first_platform_owner` (advisory lock). Leave unapprove restores prior attendance from `attendance_snapshot`.

### Storage (Phase E)

- Bucket `file_size_limit` = **5MB** on `trip-photos`, `attendance-photos`, `cash-receipts` (re-asserted in `045`).
- Employees/site_employees may **read/write** trip photos under their site path (my-work parity with cash-receipts).

### Rate limiting (Phase E)

Proxy limits `/api/admin/*`, `/api/platform/*`, and bootstrap. Optional durable backend: `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (see `docs/ENV.md`). Falls back to in-memory per isolate.

## 🛡 CSP notes

Production CSP drops `unsafe-eval` and localhost Supabase. Inline scripts remain required by Next.js bootstrapping until a nonce pipeline is adopted (`docs/CSP_NONCE.md` — Phase E4 long-term). PWA workers are allowed via `worker-src 'self' blob:`.
