# Schema source of truth (Phase D / Phase 3)

## Canonical order

| Priority | Artifact | Role |
|----------|----------|------|
| **1** | `supabase/migrations/*.sql` | **Source of truth** for production schema. Apply with `supabase db push` / CI. Currently through **`066_unload_site_scope_no_restamp.sql`**. |
| **2** | Live Supabase project after push | Runtime truth |
| **3** | `frontend/src/lib/supabase/database.types.ts` | TypeScript client types — **must track migrations** |
| **4** | `supabase/schema.sql` | **Reference dump only — intentionally lagging.** Do **not** apply as a full replace on prod. Prefer regenerating after a full local `db reset` if you want a snapshot. |

## Regenerating TypeScript types

Requires Supabase CLI and a running local stack (or linked project) with migrations applied:

```bash
# From repo root (preferred — config.toml lives here)
supabase start   # if not already running
supabase gen types typescript --local --schema public > frontend/src/lib/supabase/database.types.ts

# Or from frontend/ (script uses CLI; config resolved from parent when present)
cd frontend
npm run gen:types
```

Against a linked remote:

```bash
supabase gen types typescript --linked --schema public > frontend/src/lib/supabase/database.types.ts
```

Then:

```bash
cd frontend && npm run typecheck   # or npm run test
```

If CLI is unavailable, hand-patch `database.types.ts` when adding columns (e.g. Phase 3 `trip_photos.organization_id`).

## Refreshing schema.sql (optional)

```bash
# From repo root after migrations applied
supabase db dump --schema public -f supabase/schema.sql
```

Update the header warning in `schema.sql` to note the latest migration number. Or leave the dump as-is and **always** treat migrations as SSOT.

## Checklist after schema change

1. Add numbered migration under `supabase/migrations/`
2. `supabase db push` (local + remote)
3. Regenerate or update `database.types.ts` (`npm run gen:types` when CLI available)
4. `npm run typecheck` / `npm run test` in `frontend`
5. Update `docs/DEPLOYMENT_CHECKLIST.md` “latest migration” line if needed
