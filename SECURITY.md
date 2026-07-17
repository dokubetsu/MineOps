# MineOps Security Blueprint & Compliance Document

This document outlines the security architecture, threat models, and explicit design decisions made for MineOps.

## 🛡️ Database-Level Security (Row-Level Security)

MineOps relies on Supabase (PostgreSQL) Row-Level Security (RLS) to enforce data boundaries. Since the Next.js client interacts directly with the database using the authenticated client, every operation is validated using security context:

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

Helper: `write_audit_event(...)` for SECURITY DEFINER RPCs. See migration `041_phase3_audit_and_polish.sql`.

## 🛡 CSP notes

Production CSP drops `unsafe-eval` and localhost Supabase. Inline scripts remain required by Next.js bootstrapping until a nonce pipeline is adopted. PWA workers are allowed via `worker-src 'self' blob:`.
