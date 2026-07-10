from fastapi import APIRouter, HTTPException, Depends
from typing import List, Optional
from uuid import UUID
from app.models import VehicleCreate, VehicleUpdate
from app.database import get_supabase
from app.auth import get_current_user

router = APIRouter()


@router.get("/", response_model=List[dict])
async def list_vehicles(
    active: Optional[bool] = None,
    search: Optional[str] = None,
    current_user=Depends(get_current_user),
):
    db = get_supabase()
    query = db.table("vehicles").select("*, transport_contractors(name)")
    if active is not None:
        query = query.eq("active", active)
    if search:
        query = query.ilike("plate_number", f"%{search.upper()}%")
    result = query.order("plate_number").execute()
    return result.data


@router.post("/", response_model=dict, status_code=201)
async def create_vehicle(vehicle: VehicleCreate, current_user=Depends(get_current_user)):
    db = get_supabase()
    data = vehicle.model_dump()
    data["plate_number"] = data["plate_number"].upper()
    if data.get("default_contractor_id"):
        data["default_contractor_id"] = str(data["default_contractor_id"])
    result = db.table("vehicles").insert(data).execute()
    if not result.data:
        raise HTTPException(status_code=400, detail="Failed to create vehicle")
    return result.data[0]


@router.get("/{vehicle_id}", response_model=dict)
async def get_vehicle(vehicle_id: UUID, current_user=Depends(get_current_user)):
    db = get_supabase()
    result = db.table("vehicles").select("*, transport_contractors(name)").eq("id", str(vehicle_id)).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    return result.data


@router.patch("/{vehicle_id}", response_model=dict)
async def update_vehicle(vehicle_id: UUID, vehicle: VehicleUpdate, current_user=Depends(get_current_user)):
    db = get_supabase()
    update_data = {}
    for k, v in vehicle.model_dump().items():
        if v is not None:
            if k == "plate_number":
                update_data[k] = str(v).upper()
            elif isinstance(v, UUID):
                update_data[k] = str(v)
            else:
                update_data[k] = v
    result = db.table("vehicles").update(update_data).eq("id", str(vehicle_id)).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    return result.data[0]


@router.delete("/{vehicle_id}", status_code=204)
async def deactivate_vehicle(vehicle_id: UUID, current_user=Depends(get_current_user)):
    db = get_supabase()
    db.table("vehicles").update({"active": False}).eq("id", str(vehicle_id)).execute()
