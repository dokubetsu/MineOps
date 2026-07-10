from fastapi import APIRouter, HTTPException
from typing import List, Optional
from uuid import UUID
from datetime import date, datetime, timedelta
from app.database import get_supabase

router = APIRouter()


@router.get("/", response_model=List[dict])
async def get_attendance_roster(
    site_id: UUID,
    att_date: Optional[date] = None,
):
    """Get full attendance roster for a site on a given date"""
    db = get_supabase()
    if att_date is None:
        att_date = date.today()

    # Get all employees for the site
    emp_result = db.table("employees").select("id, name, role, wage_type, wage_rate").eq(
        "site_id", str(site_id)
    ).eq("active", True).order("name").execute()
    employees = emp_result.data or []

    # Get existing attendance records
    att_result = db.table("attendance").select("*").in_(
        "employee_id", [e["id"] for e in employees]
    ).eq("att_date", str(att_date)).execute()
    att_map = {a["employee_id"]: a for a in (att_result.data or [])}

    # Merge
    roster = []
    for emp in employees:
        att = att_map.get(emp["id"])
        roster.append({
            **emp,
            "attendance_id": att["id"] if att else None,
            "status": att["status"] if att else "present",  # default present
            "att_date": str(att_date),
        })
    return roster


@router.post("/bulk", response_model=List[dict])
async def bulk_mark_attendance(
    site_id: UUID,
    att_date: date,
    records: List[dict],  # [{employee_id, status}]
):
    """Bulk mark attendance for a site on a date - upsert for idempotency"""
    db = get_supabase()
    upsert_data = [
        {
            "employee_id": r["employee_id"],
            "att_date": str(att_date),
            "status": r.get("status", "present"),
        }
        for r in records
    ]
    result = db.table("attendance").upsert(
        upsert_data, on_conflict="employee_id,att_date"
    ).execute()
    return result.data or []


@router.get("/summary", response_model=dict)
async def get_attendance_summary(
    site_id: UUID,
    from_date: date,
    to_date: date,
):
    """Summary of attendance for payroll period"""
    db = get_supabase()
    emp_result = db.table("employees").select("id, name, wage_rate, wage_type").eq(
        "site_id", str(site_id)
    ).eq("active", True).execute()
    employees = emp_result.data or []
    emp_ids = [e["id"] for e in employees]

    att_result = db.table("attendance").select("employee_id, status").in_(
        "employee_id", emp_ids
    ).gte("att_date", str(from_date)).lte("att_date", str(to_date)).execute()
    records = att_result.data or []

    summary = {}
    for emp in employees:
        summary[emp["id"]] = {
            "employee_id": emp["id"],
            "name": emp["name"],
            "wage_rate": emp["wage_rate"],
            "wage_type": emp["wage_type"],
            "present": 0,
            "absent": 0,
            "half_day": 0,
            "leave": 0,
        }
    for r in records:
        emp_id = r["employee_id"]
        if emp_id in summary:
            status = r["status"]
            if status == "present":
                summary[emp_id]["present"] += 1
            elif status == "absent":
                summary[emp_id]["absent"] += 1
            elif status == "half-day":
                summary[emp_id]["half_day"] += 1
            elif status == "leave":
                summary[emp_id]["leave"] += 1

    return {"from_date": str(from_date), "to_date": str(to_date), "employees": list(summary.values())}
