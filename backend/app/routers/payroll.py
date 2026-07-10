from fastapi import APIRouter, HTTPException
from typing import List
from uuid import UUID
from app.models import PayrollRunCreate, PayrollLineAdjustment
from app.database import get_supabase
from datetime import date, timedelta
import calendar

router = APIRouter()


@router.post("/runs", response_model=dict, status_code=201)
async def generate_payroll(run: PayrollRunCreate):
    """Generate payroll for a site for a given month"""
    db = get_supabase()

    period = run.period_month
    # Get first and last day of the month
    first_day = period.replace(day=1)
    last_day = period.replace(day=calendar.monthrange(period.year, period.month)[1])

    # Create payroll run
    run_result = db.table("payroll_runs").insert({
        "site_id": str(run.site_id),
        "period_month": str(first_day),
        "status": "draft",
    }).execute()
    payroll_run = run_result.data[0]

    # Get employees for the site
    emp_result = db.table("employees").select("id, name, wage_rate, wage_type").eq(
        "site_id", str(run.site_id)
    ).eq("active", True).execute()
    employees = emp_result.data or []

    # Get attendance for the period
    emp_ids = [e["id"] for e in employees]
    att_result = db.table("attendance").select("employee_id, status").in_(
        "employee_id", emp_ids
    ).gte("att_date", str(first_day)).lte("att_date", str(last_day)).execute()

    # Count by employee
    att_counts = {}
    for emp in employees:
        att_counts[emp["id"]] = {"present": 0, "absent": 0, "half_day": 0, "leave": 0}
    for a in (att_result.data or []):
        eid = a["employee_id"]
        if eid in att_counts:
            s = a["status"]
            if s == "present":
                att_counts[eid]["present"] += 1
            elif s == "absent":
                att_counts[eid]["absent"] += 1
            elif s == "half-day":
                att_counts[eid]["half_day"] += 1
            elif s == "leave":
                att_counts[eid]["leave"] += 1

    # Create payroll lines
    lines = []
    for emp in employees:
        counts = att_counts[emp["id"]]
        base_rate = emp["wage_rate"]
        days_present = counts["present"]
        days_half = counts["half_day"]
        # half-day counts as 0.5
        computed = (days_present + days_half * 0.5) * base_rate
        lines.append({
            "payroll_run_id": payroll_run["id"],
            "employee_id": emp["id"],
            "days_present": days_present,
            "days_leave": counts["leave"],
            "days_absent": counts["absent"],
            "base_rate": base_rate,
            "computed_amount": round(computed, 2),
            "adjustment": 0,
        })

    if lines:
        db.table("payroll_lines").insert(lines).execute()

    return payroll_run


@router.get("/runs", response_model=List[dict])
async def list_payroll_runs(site_id: UUID = None):
    db = get_supabase()
    query = db.table("payroll_runs").select("*, sites(name)")
    if site_id:
        query = query.eq("site_id", str(site_id))
    result = query.order("period_month", desc=True).execute()
    return result.data


@router.get("/runs/{run_id}/lines", response_model=List[dict])
async def get_payroll_lines(run_id: UUID):
    db = get_supabase()
    result = db.table("payroll_lines").select("*, employees(name, phone)").eq(
        "payroll_run_id", str(run_id)
    ).execute()
    return result.data


@router.patch("/lines/{line_id}/adjust", response_model=dict)
async def adjust_payroll_line(line_id: UUID, adj: PayrollLineAdjustment):
    db = get_supabase()
    result = db.table("payroll_lines").update({
        "adjustment": adj.adjustment,
        "notes": adj.notes,
    }).eq("id", str(line_id)).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Payroll line not found")
    return result.data[0]


@router.patch("/runs/{run_id}/finalize", response_model=dict)
async def finalize_payroll(run_id: UUID):
    db = get_supabase()
    result = db.table("payroll_runs").update({"status": "finalized"}).eq(
        "id", str(run_id)
    ).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Payroll run not found")
    return result.data[0]
