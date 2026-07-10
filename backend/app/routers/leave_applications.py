from fastapi import APIRouter, HTTPException
from typing import List
from uuid import UUID
from app.models import LeaveApplicationCreate, LeaveApplicationUpdate
from app.database import get_supabase

router = APIRouter()


@router.get("/", response_model=List[dict])
async def list_leave_applications(
    site_id: UUID = None,
    status: str = None,
):
    db = get_supabase()
    query = db.table("leave_applications").select("*, employees(name, site_id)")
    if status:
        query = query.eq("status", status)
    result = query.order("created_at", desc=True).execute()
    data = result.data or []
    if site_id:
        data = [d for d in data if d.get("employees", {}).get("site_id") == str(site_id)]
    return data


@router.post("/", response_model=dict, status_code=201)
async def create_leave_application(leave: LeaveApplicationCreate):
    db = get_supabase()
    data = leave.model_dump()
    data["employee_id"] = str(data["employee_id"])
    data["from_date"] = str(data["from_date"])
    data["to_date"] = str(data["to_date"])
    result = db.table("leave_applications").insert(data).execute()
    return result.data[0]


@router.patch("/{leave_id}", response_model=dict)
async def update_leave_status(leave_id: UUID, update: LeaveApplicationUpdate):
    db = get_supabase()
    result = db.table("leave_applications").update({"status": update.status}).eq(
        "id", str(leave_id)
    ).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Leave application not found")
    # If approved, auto-mark attendance as leave for those dates
    if update.status == "approved":
        leave = result.data[0]
        from datetime import date, timedelta
        from_d = date.fromisoformat(leave["from_date"])
        to_d = date.fromisoformat(leave["to_date"])
        current = from_d
        records = []
        while current <= to_d:
            records.append({
                "employee_id": leave["employee_id"],
                "att_date": str(current),
                "status": "leave",
            })
            current += timedelta(days=1)
        if records:
            db.table("attendance").upsert(records, on_conflict="employee_id,att_date").execute()
    return result.data[0]
