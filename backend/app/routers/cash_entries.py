from fastapi import APIRouter, HTTPException, Depends
from typing import List, Optional
from uuid import UUID
from app.models import CashEntryCreate, CashEntryUpdate
from app.database import get_supabase
from app.auth import get_current_user

router = APIRouter()


def _assert_book_not_locked(db, cash_book_id: str):
    """Raises 409 if the parent cash book is locked."""
    result = db.table("cash_books").select("status").eq("id", cash_book_id).execute()
    if result.data and result.data[0].get("status") == "locked":
        raise HTTPException(
            status_code=409,
            detail="Cannot modify entries on a locked cash book",
        )


@router.get("/", response_model=List[dict])
async def list_cash_entries(cash_book_id: UUID, current_user=Depends(get_current_user)):
    db = get_supabase()
    result = db.table("cash_entries").select("*").eq(
        "cash_book_id", str(cash_book_id)
    ).order("created_at").execute()
    return result.data


@router.post("/", response_model=dict, status_code=201)
async def create_cash_entry(entry: CashEntryCreate, current_user=Depends(get_current_user)):
    db = get_supabase()
    data = entry.model_dump()
    for key in ["id", "cash_book_id"]:
        if data.get(key):
            data[key] = str(data[key])
    if data.get("id") is None:
        data.pop("id", None)

    # Fix 9: Enforce lock status before write
    _assert_book_not_locked(db, data["cash_book_id"])

    result = db.table("cash_entries").upsert(data).execute()
    if not result.data:
        raise HTTPException(status_code=400, detail="Failed to create cash entry")
    return result.data[0]


@router.patch("/{entry_id}", response_model=dict)
async def update_cash_entry(entry_id: UUID, entry: CashEntryUpdate, current_user=Depends(get_current_user)):
    db = get_supabase()
    # Fetch the existing entry to get cash_book_id
    existing = db.table("cash_entries").select("cash_book_id").eq("id", str(entry_id)).execute()
    if existing.data:
        _assert_book_not_locked(db, existing.data[0]["cash_book_id"])

    update_data = {k: v for k, v in entry.model_dump().items() if v is not None}
    result = db.table("cash_entries").update(update_data).eq("id", str(entry_id)).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Entry not found")
    return result.data[0]


@router.delete("/{entry_id}", status_code=204)
async def delete_cash_entry(entry_id: UUID, current_user=Depends(get_current_user)):
    """Soft-delete: preserve financial audit trail"""
    db = get_supabase()
    # Check lock before deleting
    existing = db.table("cash_entries").select("cash_book_id").eq("id", str(entry_id)).execute()
    if existing.data:
        _assert_book_not_locked(db, existing.data[0]["cash_book_id"])
    # Soft delete
    db.table("cash_entries").update({"active": False}).eq("id", str(entry_id)).execute()
