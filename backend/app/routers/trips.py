from fastapi import APIRouter, HTTPException, Depends
from typing import List, Optional
from uuid import UUID
from app.models import TripCreate, TripUpdate
from app.database import get_supabase
from app.auth import get_current_user
from datetime import date

router = APIRouter()


@router.get("/", response_model=List[dict])
async def list_trips(
    site_id: Optional[UUID] = None,
    trip_date: Optional[date] = None,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    contractor_id: Optional[UUID] = None,
    vehicle_id: Optional[UUID] = None,
    current_user=Depends(get_current_user),
):
    db = get_supabase()
    query = db.table("trips").select(
        "*, vehicles(plate_number, vehicle_type), drivers(name), transport_contractors(name), sites(name)"
    )
    if site_id:
        query = query.eq("site_id", str(site_id))
    if trip_date:
        query = query.eq("trip_date", str(trip_date))
    if from_date:
        query = query.gte("trip_date", str(from_date))
    if to_date:
        query = query.lte("trip_date", str(to_date))
    if contractor_id:
        query = query.eq("contractor_id", str(contractor_id))
    if vehicle_id:
        query = query.eq("vehicle_id", str(vehicle_id))
    result = query.order("created_at", desc=True).execute()
    return result.data


@router.post("/", response_model=dict, status_code=201)
async def create_trip(trip: TripCreate, current_user=Depends(get_current_user)):
    db = get_supabase()
    data = trip.model_dump()
    # Convert UUID fields to strings
    for key in ["id", "site_id", "vehicle_id", "driver_id", "contractor_id"]:
        if data.get(key):
            data[key] = str(data[key])
    # Convert dates
    if data.get("trip_date"):
        data["trip_date"] = str(data["trip_date"])
    # Remove None id (let DB generate)
    if data.get("id") is None:
        data.pop("id", None)
    result = db.table("trips").upsert(data).execute()
    if not result.data:
        raise HTTPException(status_code=400, detail="Failed to create trip")
    return result.data[0]


@router.get("/{trip_id}", response_model=dict)
async def get_trip(trip_id: UUID, current_user=Depends(get_current_user)):
    db = get_supabase()
    result = db.table("trips").select(
        "*, vehicles(plate_number, vehicle_type), drivers(name), transport_contractors(name)"
    ).eq("id", str(trip_id)).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Trip not found")
    return result.data


@router.patch("/{trip_id}", response_model=dict)
async def update_trip(trip_id: UUID, trip: TripUpdate, current_user=Depends(get_current_user)):
    db = get_supabase()
    update_data = {k: str(v) if isinstance(v, UUID) else v for k, v in trip.model_dump().items() if v is not None}
    result = db.table("trips").update(update_data).eq("id", str(trip_id)).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Trip not found")
    return result.data[0]


@router.delete("/{trip_id}", status_code=204)
async def delete_trip(trip_id: UUID, current_user=Depends(get_current_user)):
    """Soft-delete: preserve financial audit trail"""
    db = get_supabase()
    db.table("trips").update({"active": False}).eq("id", str(trip_id)).execute()


@router.get("/summary/daily")
async def get_daily_summary(site_id: UUID, trip_date: Optional[date] = None, current_user=Depends(get_current_user)):
    """Get trip count summary for a site on a given date"""
    db = get_supabase()
    if trip_date is None:
        trip_date = date.today()
    result = db.table("trips").select(
        "id, contractor_id, transport_contractors(name), vehicles(plate_number, vehicle_type)"
    ).eq("site_id", str(site_id)).eq("trip_date", str(trip_date)).execute()
    trips_data = result.data or []
    # Group by contractor
    by_contractor = {}
    for t in trips_data:
        c_name = t.get("transport_contractors", {}).get("name", "Unknown") if t.get("transport_contractors") else "Unknown"
        by_contractor[c_name] = by_contractor.get(c_name, 0) + 1
    return {
        "date": str(trip_date),
        "total_trips": len(trips_data),
        "by_contractor": by_contractor,
        "trips": trips_data,
    }
