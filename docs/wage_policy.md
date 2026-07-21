# MineOps wage & attendance policy

Canonical product rules for payroll generation, attendance marking, and leave.
Implemented in `frontend/src/lib/calculations.ts`, `payrollRepository.generate`, and DB leave/attendance triggers (Phase C / **044**, Phase 1 / **048**).

## Attendance marks

| Status | Meaning |
|--------|---------|
| **Present (P)** | Full day worked |
| **Absent (A)** | Not worked — reduces monthly salary; no daily wage |
| **Half-day (H)** | Counts as 0.5 day for daily pay and monthly deduction |
| **Leave (L)** | Paid leave for daily workers; does **not** reduce monthly salary |
| **Unmarked** | No attendance row — **not** treated as present or absent |

### Defaults

- The muster roll starts **unmarked** (no invent-present).
- Save only persists employees who have an explicit mark.
- “Mark all present” is an explicit bulk action, not the default load state.

### Muster Leave and leave_balance (Phase C)

| Path | Effect on `leave_balance` |
|------|---------------------------|
| **Leave application approved** | Deducts only days **not already** status=`leave` on the muster (Phase 1 / **048** — no double-charge); writes attendance `leave` for the full range (skips per-day balance trigger) |
| **Leave unapprove** | Restores only days that were charged by that approval (prior snapshot ≠ leave); restores prior attendance from snapshot |
| **Muster mark Leave** (no covering approved application) | Deducts **1** day; **rejected** if balance &lt; 1 |
| **Muster change away from Leave** (no covering approved application) | Restores **1** day |
| **Muster Leave when approved application covers that date** | No extra deduct (already handled by application) |

So managers cannot mark free paid Leave without consuming balance (unless an approved application already covers the day). Approving an application after partial muster Leave only charges the **net new** days.

## Daily wages

```
wage = (present + half_day * 0.5 + leave) × daily_rate
```

- Only **marked** days contribute.
- Leave is **paid** at the daily rate.
- Unmarked days pay nothing.

## Monthly wages

```
wage = monthly_rate × max(0, 1 − (absent + half_day × 0.5) / period_calendar_days)
```

- `period_calendar_days` = inclusive days in the payroll month (28–31), computed with **local calendar** bounds (`payrollPeriodBounds`), never UTC-shifted `Date` parse.
- **Leave does not reduce** monthly salary (paid leave).
- **Unmarked days do not reduce** monthly salary — managers must mark **Absent** for unpaid days.
- Half-days deduct half a day from the proration factor.

## Leave applications

- Inclusive calendar days: `(to_date − from_date) + 1`.
- Approval deducts `leave_balance` for **charge_days** = range days minus days already status=`leave`, then writes attendance `leave` for each day in range.
- Approval is **rejected** if balance is insufficient for charge_days (no silent clamp).
- Approval is **blocked** if any overlapping calendar month already has a **finalized** payroll run for that site.
- If existing **non-leave** attendance would be overwritten, approval requires **force** confirmation.
- **Undo approval** (`unapprove_leave_application`): restore **charge_days** only, restore attendance from snapshot, status → pending (blocked if payroll finalized).
- Only admin / site_manager (scoped) may approve / unapprove.
- New employees (UI + `provision_user_access` create) default **`leave_balance = 15`**.

## Payroll runs

- One draft/finalized run per `(site_id, period_month)`.
- Lines store `days_present`, `days_half_day`, `days_leave`, `days_absent`.
- Unique `(payroll_run_id, employee_id)` prevents duplicate liability lines.
- Finalize is atomic (`finalize_payroll_run`); **requires ≥1 payroll line** (Phase 1 / **048**); lines cannot be edited after finalize.
- After finalize, **attendance INSERT/UPDATE/DELETE** for dates in that month at the same site is blocked (muster freeze, **048**).

## Trip worth / trip cost (field reference model)

Source: paper ops in local `reference/` (untracked scans: daily trip sheets, weekly/monthly counts, May–June business report).

| Rule | Detail |
|------|--------|
| **Price unit** | **Flat ₹ per trip** — primarily **rate discussed with customer** |
| **Resolution order** | 1) Customer type rate 2) Customer default rate 3) Org type rate 4) App default |
| **Not used in price** | Distance (km), cubic capacity (m³), drop location |
| **Defaults** (if no rates set) | 12WH ₹1000, 10WH ₹800, 6WH ₹600, Other ₹500 |
| **Master Data** | Settings → **Customers** (buyer rates) + **Org rates** fallback (`negotiated_rates`) |
| **Advance** | Separate field; **not** added into trip cost |
| **Reporting** | Count trips by type × rate (e.g. 1572 × 1000 + 29 × 800); stakeholder share often 50/50 of total |

### Settlement (Phase 1)

- Client and server normalize via `computeTripWorth` / DB trigger `normalize_trip_worth` (2 decimal places).
- Preferred create path: `tripsRepository.create` (admin + my-work).
- **Settled** trips require `settlement_amount > 0` (DB trigger + `tripsRepository.settle`).

## Stakeholder shares

- Per-person share is 0–100%.
- **Sum of `share_percent` per site cannot exceed 100%** (`check_stakeholder_share_limit` trigger).
- Reports **Business pack** can export an optional % split of trip value (paper 50/50 style).

## Month-end (replace Excel close)

1. Enter trips / cash / attendance all month in the app (not Excel).
2. **Reports** → choose month (or day/week) + site → **Paper view** + **Download full pack**.
3. **Payroll** → generate + finalize (freezes muster for that month).
4. Optional **admin**: Mark period closed (audit log).
5. Optional **admin**: **Remove period data** (type `DELETE`) — soft-deletes trips & cash lines, deletes attendance/leave in range for that site. Blocked if finalized payroll exists. Prefer download first. Logged in `period_ops_log` (migration **055**).

## Site employees (expenses / trips)

- May insert trips and cash entries for assigned sites.
- May update **only rows they created** (`created_by = auth.uid()`).
- Cannot delete other users’ cash entries or rewrite site-wide trip settlements.
