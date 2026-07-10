from fastapi import APIRouter, HTTPException
from typing import List, Optional
from uuid import UUID
from app.models import ContractorCreate, ContractorUpdate
from app.database import get_supabase

router = APIRouter()


@router.get("/", response_model=List[dict])
async def list_contractors(active: Optional[bool] = None):
    db = get_supabase()
    query = db.table("transport_contractors").select("*")
    if active is not None:
        query = query.eq("active", active)
    result = query.order("name").execute()
    return result.data


@router.post("/", response_model=dict, status_code=201)
async def create_contractor(contractor: ContractorCreate):
    db = get_supabase()
    result = db.table("transport_contractors").insert(contractor.model_dump()).execute()
    return result.data[0]


@router.patch("/{contractor_id}", response_model=dict)
async def update_contractor(contractor_id: UUID, contractor: ContractorUpdate):
    db = get_supabase()
    update_data = {k: v for k, v in contractor.model_dump().items() if v is not None}
    result = db.table("transport_contractors").update(update_data).eq("id", str(contractor_id)).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Contractor not found")
    return result.data[0]
