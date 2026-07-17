# MineOps wage & attendance policy

Canonical product rules for payroll generation, attendance marking, and leave.
Implemented in `frontend/src/lib/calculations.ts`, `payrollRepository.generate`, and DB leave/attendance triggers (Phase C / migration **044**).

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
| **Leave application approved** | Deducts inclusive days once; writes attendance `leave` for each day (skips per-day balance trigger) |
| **Muster mark Leave** (no covering approved application) | Deducts **1** day; **rejected** if balance &lt; 1 |
| **Muster change away from Leave** (no covering approved application) | Restores **1** day |
| **Muster Leave when approved application covers that date** | No extra deduct (already handled by application) |

So managers cannot mark free paid Leave without consuming balance (unless an approved application already covers the day).

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
- Approval deducts `leave_balance` and writes attendance status `leave` for each day.
- Approval is **rejected** if balance is insufficient (no silent clamp).
- Approval is **blocked** if any overlapping calendar month already has a **finalized** payroll run for that site.
- If existing **non-leave** attendance would be overwritten, approval requires **force** confirmation.
- **Undo approval** (`unapprove_leave_application`): restore balance, remove leave attendance for the range, status → pending (blocked if payroll finalized).
- Only admin / site_manager (scoped) may approve / unapprove.
- New employees (UI + `provision_user_access` create) default **`leave_balance = 15`**.

## Payroll runs

- One draft/finalized run per `(site_id, period_month)`.
- Lines store `days_present`, `days_half_day`, `days_leave`, `days_absent`.
- Unique `(payroll_run_id, employee_id)` prevents duplicate liability lines.
- Finalize is atomic (`finalize_payroll_run`); lines cannot be edited after finalize.

## Trip worth (Phase C)

- Client and server normalize via `computeTripWorth` / DB trigger `normalize_trip_worth` (2 decimal places).
- Preferred create path: `tripsRepository.create` (admin + my-work).

## Site employees (expenses / trips)

- May insert trips and cash entries for assigned sites.
- May update **only rows they created** (`created_by = auth.uid()`).
- Cannot delete other users’ cash entries or rewrite site-wide trip settlements.
