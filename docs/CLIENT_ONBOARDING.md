# Client onboarding brief (first handover)

Short talking points for the mine admin / ops lead. Full rules: `docs/wage_policy.md`.

## Trip cost

- Trip **billing total** = rate × quantity (org unit: **m³** or **unit**, configured per org on `/platform`).
- Distance / drop / permit are ops notes — they are **not** added into that total.
- Orgs can set **billing admin-only**: site managers / employees log trips **without** seeing ₹ totals or distance cost (admin still sees them).

## Other costs (formerly “advance”)

- Field label **Other costs** posts cash book **OUT** as **Other trip costs** (marker `[trip_advance:…]` unchanged for sync).

## Settle vs cash book

- When **settlement admin-only** is on, only tenant **admins** settle / collect payment.
- Settling posts cash book **IN**: **Trip settlement collection**.
- **Unload clerks** document destination unload only — they do **not** settle and do **not** see billing when admin-only is on.

## Unload clerk

- New role assigned to a site: open **Unload**, record received qty + notes. Admin can do the same.

## Two share models (do not mix)

| Where | What % applies to |
|-------|-------------------|
| **Stakeholder** portal / site stakeholder rows | **Cash book net** (IN − OUT) for the period |
| **Reports → Business pack** slider | Manual % of **trip billing value** (Excel-style paper split) |

## Offline / flaky network

- Queued trip and cash creates carry a stable `client_id`. After migration **064+**, retries do not create duplicate rows.

## Passwords (prod APIs)

- Platform bootstrap, org admin, and tenant create-user require **12+** characters with a letter, a number, and a special character. Seed/demo passwords are local/CI only.

## Scale

- One app + RLS supports many orgs (e.g. hundreds). Prefer org policies over forked codebases.
