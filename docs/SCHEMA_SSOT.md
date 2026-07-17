# Schema source of truth (Phase D)

## Canonical order

| Priority | Artifact | Role |
|----------|----------|------|
| **1** | `supabase/migrations/*.sql` | **Source of truth** for production schema. Apply with `supabase db push` / CI. |
| **2** | Live Supabase project after push | Runtime truth |
| **3** | `frontend/src/lib/supabase/database.types.ts` | TypeScript client types — **must track migrations** |
| **4** | `supabase/schema.sql` | **Reference dump only** — may lag; do not apply as a full replace on prod |

## Regenerating TypeScript types

When you have the Supabase CLI linked to a project with migrations applied:

```bash
# From repo root
supabase gen types typescript --local > frontend/src/lib/supabase/database.types.ts
# or against linked remote:
# supabase gen types typescript --linked > frontend/src/lib/supabase/database.types.ts
```

Then run `cd frontend && npm run test` (tsc).

If CLI is unavailable, hand-patch `database.types.ts` when adding columns (as done in Phase D for `organization_id` on cash/leave/payroll/trips + `audit_logs`).

## Refreshing schema.sql (optional)

```bash
supabase db dump --schema public -f supabase/schema.sql
```

Or leave `schema.sql` as a historical snapshot and always prefer migrations.

## Checklist after schema change

1. Add numbered migration under `supabase/migrations/`
2. `supabase db push` (local + remote)
3. Regenerate or update `database.types.ts`
4. `npm run test` in `frontend`
5. Update `docs/DEPLOYMENT_CHECKLIST.md` “latest migration” line if needed
