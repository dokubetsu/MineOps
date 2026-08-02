# Client onboarding brief (first handover)

Short talking points for the mine admin / ops lead. Full rules: `docs/wage_policy.md`.

## Trip cost

- Trip **billing total** = customer/org rate (₹/m³) × vehicle cubic capacity.
- Distance / drop / permit are ops notes — they are **not** added into that total.

## Settle vs cash book

- Marking a trip **Settled** records collection on the trip **and** posts a cash book **IN** line: category **Trip settlement collection**.
- Re-settling / sync updates that same linked line (marker `[trip_settle:…]`) — it does not invent a second collection.
- If the day’s cash book is **locked**, settlement collection cannot post until an admin unlocks (same as advances).
- Advance on create posts cash **OUT** (**Advance for trip**); that is separate from settlement.

## Two share models (do not mix)

| Where | What % applies to |
|-------|-------------------|
| **Stakeholder** portal / site stakeholder rows | **Cash book net** (IN − OUT) for the period |
| **Reports → Business pack** slider | Manual % of **trip billing value** (Excel-style paper split) |

Registered stakeholder `%` does **not** drive the reports pack slider, and vice versa.

## Offline / flaky network

- Queued trip and cash creates carry a stable `client_id`. After migration **064**, retries do not create duplicate rows.

## Passwords (prod APIs)

- Platform bootstrap, org admin, and tenant create-user require **12+** characters with a letter, a number, and a special character. Seed/demo passwords are local/CI only.
