from fastapi import APIRouter, HTTPException
from typing import List, Optional
from uuid import UUID
from app.models import DriverCreate, DriverUpdate
from app.database import get_supabase

router = APIRouter()


@router.get("/", response_model=List[dict])
async def list_drivers(active: Optional[bool] = None):
    db = get_supabase()
    query = db.table("drivers").select("*")
    if active is not None:
        query = query.eq("active", active)
    result = query.order("name").execute()
    return result.data


@router.post("/", response_model=dict, status_code=201)
async def create_driver(driver: DriverCreate):
    db = get_supabase()
    result = db.table("drivers").insert(driver.model_dump()).execute()
    return result.data[0]


@router.patch("/{driver_id}", response_model=dict)
async def update_driver(driver_id: UUID, driver: DriverUpdate):
    db = get_supabase()
    update_data = {k: v for k, v in driver.model_dump().items() if v is not None}
    result = db.table("drivers").update(update_data).eq("id", str(driver_id)).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Driver not found")
    return result.data[0]


@router.delete("/{driver_id}", status_code=204)
async def deactivate_driver(driver_id: UUID):
    db = get_supabase()
    db.table("drivers").update({"active": False}).eq("id", str(driver_id)).execute()
