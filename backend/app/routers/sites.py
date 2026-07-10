from fastapi import APIRouter, HTTPException, Depends
from typing import List, Optional
from uuid import UUID
from app.models import Site, SiteCreate, SiteUpdate
from app.database import get_supabase
from app.auth import get_current_user

router = APIRouter()


@router.get("/", response_model=List[dict])
async def list_sites(active: Optional[bool] = None, current_user=Depends(get_current_user)):
    db = get_supabase()
    query = db.table("sites").select("*")
    if active is not None:
        query = query.eq("active", active)
    result = query.order("name").execute()
    return result.data


@router.post("/", response_model=dict, status_code=201)
async def create_site(site: SiteCreate, current_user=Depends(get_current_user)):
    db = get_supabase()
    result = db.table("sites").insert(site.model_dump()).execute()
    if not result.data:
        raise HTTPException(status_code=400, detail="Failed to create site")
    return result.data[0]


@router.get("/{site_id}", response_model=dict)
async def get_site(site_id: UUID, current_user=Depends(get_current_user)):
    db = get_supabase()
    result = db.table("sites").select("*").eq("id", str(site_id)).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Site not found")
    return result.data


@router.patch("/{site_id}", response_model=dict)
async def update_site(site_id: UUID, site: SiteUpdate, current_user=Depends(get_current_user)):
    db = get_supabase()
    update_data = {k: v for k, v in site.model_dump().items() if v is not None}
    result = db.table("sites").update(update_data).eq("id", str(site_id)).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Site not found")
    return result.data[0]


@router.delete("/{site_id}", status_code=204)
async def deactivate_site(site_id: UUID, current_user=Depends(get_current_user)):
    """Soft delete - sets active=False"""
    db = get_supabase()
    db.table("sites").update({"active": False}).eq("id", str(site_id)).execute()
