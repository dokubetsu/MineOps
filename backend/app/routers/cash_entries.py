from fastapi import APIRouter, HTTPException
from typing import List, Optional
from uuid import UUID
from app.models import CashEntryCreate, CashEntryUpdate
from app.database import get_supabase

router = APIRouter()


@router.get("/", response_model=List[dict])
async def list_cash_entries(cash_book_id: UUID):
    db = get_supabase()
    result = db.table("cash_entries").select("*").eq(
        "cash_book_id", str(cash_book_id)
    ).order("created_at").execute()
    return result.data


@router.post("/", response_model=dict, status_code=201)
async def create_cash_entry(entry: CashEntryCreate):
    db = get_supabase()
    data = entry.model_dump()
    for key in ["id", "cash_book_id"]:
        if data.get(key):
            data[key] = str(data[key])
    if data.get("id") is None:
        data.pop("id", None)
    result = db.table("cash_entries").upsert(data).execute()
    if not result.data:
        raise HTTPException(status_code=400, detail="Failed to create cash entry")
    return result.data[0]


@router.patch("/{entry_id}", response_model=dict)
async def update_cash_entry(entry_id: UUID, entry: CashEntryUpdate):
    db = get_supabase()
    update_data = {k: v for k, v in entry.model_dump().items() if v is not None}
    result = db.table("cash_entries").update(update_data).eq("id", str(entry_id)).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Entry not found")
    return result.data[0]


@router.delete("/{entry_id}", status_code=204)
async def delete_cash_entry(entry_id: UUID):
    db = get_supabase()
    db.table("cash_entries").delete().eq("id", str(entry_id)).execute()
