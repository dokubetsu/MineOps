from fastapi import APIRouter, HTTPException, Depends
from typing import List, Optional
from uuid import UUID
from app.models import EmployeeCreate, EmployeeUpdate
from app.database import get_supabase
from app.auth import get_current_user

router = APIRouter()


@router.get("/", response_model=List[dict])
async def list_employees(
    site_id: Optional[UUID] = None,
    active: Optional[bool] = None,
    current_user=Depends(get_current_user),
):
    db = get_supabase()
    query = db.table("employees").select("*, sites(name)")
    if site_id:
        query = query.eq("site_id", str(site_id))
    if active is not None:
        query = query.eq("active", active)
    result = query.order("name").execute()
    return result.data


@router.post("/", response_model=dict, status_code=201)
async def create_employee(employee: EmployeeCreate, current_user=Depends(get_current_user)):
    db = get_supabase()
    data = employee.model_dump()
    for key in ["site_id"]:
        if data.get(key):
            data[key] = str(data[key])
    if data.get("join_date"):
        data["join_date"] = str(data["join_date"])
    result = db.table("employees").insert(data).execute()
    if not result.data:
        raise HTTPException(status_code=400, detail="Failed to create employee")
    return result.data[0]


@router.get("/{employee_id}", response_model=dict)
async def get_employee(employee_id: UUID, current_user=Depends(get_current_user)):
    db = get_supabase()
    result = db.table("employees").select("*, sites(name)").eq("id", str(employee_id)).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Employee not found")
    return result.data


@router.patch("/{employee_id}", response_model=dict)
async def update_employee(employee_id: UUID, employee: EmployeeUpdate, current_user=Depends(get_current_user)):
    db = get_supabase()
    update_data = {k: str(v) if isinstance(v, UUID) else v for k, v in employee.model_dump().items() if v is not None}
    result = db.table("employees").update(update_data).eq("id", str(employee_id)).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Employee not found")
    return result.data[0]


@router.delete("/{employee_id}", status_code=204)
async def deactivate_employee(employee_id: UUID, current_user=Depends(get_current_user)):
    """Soft delete - sets active=False"""
    db = get_supabase()
    db.table("employees").update({"active": False}).eq("id", str(employee_id)).execute()
