# MineOps testing guide (Phase 5)

## Layout

| Path | Purpose |
|------|---------|
| `frontend/tests/unit/**` | Pure business / security helpers (no browser UI required) |
| `frontend/tests/e2e/**` | Browser flows (login, trips, attendance, payroll, platform) |
| `frontend/tests/e2e/global-setup.ts` | Seeds demo admin + site/vehicle/employee via service role |
| `frontend/tests/e2e/helpers.ts` | Shared login / nav helpers |

## Scripts (`frontend/package.json`)

| Script | What it runs |
|--------|----------------|
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test:unit` | Playwright **unit** project |
| `npm run test` | typecheck + unit |
| `npm run test:e2e` | Playwright **chromium** browser e2e |
| `npm run test:e2e:mobile` | **Pixel 5** smoke (`phase5-critical` only) |
| `npm run test:all` | All Playwright projects |

### Unit without Next server

```bash
# PowerShell
$env:PW_SKIP_WEBSERVER='1'; npm run test:unit

# bash / CI
PW_SKIP_WEBSERVER=1 npm run test:unit
```

Multi-tenant DB cases in `phase5-multi-tenant.spec.ts` **skip** if `SUPABASE_SERVICE_ROLE_KEY` is unset.

## Local full e2e

```bash
# Terminal A — Supabase
supabase start
# export/set NEXT_PUBLIC_SUPABASE_* + SUPABASE_SERVICE_ROLE_KEY from `supabase status`

# Terminal B — frontend
cd frontend
npm run build
npm run test:e2e
# optional:
npm run test:e2e:mobile
```

## Critical coverage map

| Concern | Where |
|---------|--------|
| Wage / cash / leave math | `tests/unit/calculations.spec.ts`, `phase-d-business`, `phase2-quality` |
| Attendance unmark partition | `phase2-quality`, `phase5-multi-tenant` (pure) |
| Feature fail-closed | `phase-d-business`, `phase2-quality`, `phase5-multi-tenant` |
| Last-admin **per org** | `phase5-multi-tenant` (service role; needs migrations **047+**) |
| Attendance mark/unmark UI | `e2e/phase5-critical` |
| Cash book lock control | `e2e/phase5-critical` |
| Trip + payroll happy path | `e2e/payroll-flow` |
| Platform vs tenant | `e2e/platform-flow` |

## CI (`.github/workflows/ci.yml`)

1. Supabase start + keys  
2. Lint + audit  
3. Typecheck  
4. Unit (`PW_SKIP_WEBSERVER=1`)  
5. Build  
6. E2E chromium  
7. E2E mobile smoke  

## Flakes

Prefer `expect(...).toBeVisible({ timeout })` and `waitForURL` over `waitForTimeout`. Shared helpers live in `tests/e2e/helpers.ts`.
