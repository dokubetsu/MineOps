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
Trips and attendance images are stored in public storage buckets under the following design tradeoffs:
1. **Performance**: Site Managers in remote mining regions frequently experience high latency and network drops. Direct public URL loading provides rapid thumbnail loading without the overhead of signed URL handshakes.
2. **Exposure Risk**: URLs contain complex UUID structures which cannot be brute-forced (cryptographically secure identifier generation). However, anyone with the direct URL can view the image.

> [!NOTE]
> If higher compliance standards are required in the future, these buckets should be set to private, and the client application updated to fetch short-lived signed URLs via `supabase.storage.from(bucket).createSignedUrl(path, expiresSeconds)`.

---

## 🔐 Administrative Account Creation

User provisioning is decoupled from client auth to prevent unauthorized account creation. Bypassing email confirmation and assigning roles is executed via a server-side route handler:
- **Location**: `/api/admin/create-user/route.ts`
- **Security Check**: This route validates the caller's JWT bearer token, checks the caller's `user_roles` entry to ensure they are an active **admin**, and only executes the user creation if authorized.
- **Key Protection**: `SUPABASE_SERVICE_ROLE_KEY` is kept strictly server-side and is never exposed in browser headers.
