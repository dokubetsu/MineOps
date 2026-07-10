from fastapi import APIRouter, HTTPException, Depends
from typing import List, Optional
from uuid import UUID
from app.models import CashBookCreate, CashEntryCreate, CashEntryUpdate
from app.database import get_supabase
from app.auth import get_current_user
from datetime import date

router = APIRouter()


@router.get("/", response_model=List[dict])
async def list_cash_books(
    site_id: Optional[UUID] = None,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    current_user=Depends(get_current_user),
):
    db = get_supabase()
    query = db.table("cash_books").select("*, sites(name)")
    if site_id:
        query = query.eq("site_id", str(site_id))
    if from_date:
        query = query.gte("book_date", str(from_date))
    if to_date:
        query = query.lte("book_date", str(to_date))
    result = query.order("book_date", desc=True).execute()
    return result.data


@router.get("/{book_date}", response_model=dict)
async def get_or_create_cash_book(
    book_date: date,
    site_id: UUID,
    current_user=Depends(get_current_user),
):
    """
    Get cash book for a site/date, auto-creating if missing.
    Uses upsert to avoid race-condition duplicate rows.
    The actual closing_balance is maintained by a Postgres trigger on cash_entries.
    """
    db = get_supabase()

    # Try to get existing first (avoids unnecessary upsert on the common path)
    result = db.table("cash_books").select("*").eq(
        "site_id", str(site_id)
    ).eq("book_date", str(book_date)).execute()
    if result.data:
        return result.data[0]

    # Get previous day's closing balance to use as opening balance
    prev_result = db.table("cash_books").select("closing_balance").eq(
        "site_id", str(site_id)
    ).lt("book_date", str(book_date)).order("book_date", desc=True).limit(1).execute()

    opening_balance = 0.0
    if prev_result.data:
        opening_balance = prev_result.data[0].get("closing_balance", 0.0) or 0.0

    # Upsert — safe against concurrent requests (unique constraint on site_id+book_date)
    new_book = {
        "site_id": str(site_id),
        "book_date": str(book_date),
        "opening_balance": opening_balance,
        # closing_balance intentionally NOT set here — trigger computes it on entry changes
        "status": "draft",
    }
    create_result = db.table("cash_books").upsert(
        new_book, on_conflict="site_id,book_date", ignore_duplicates=True
    ).execute()

    # Re-fetch to get the definitive row (upsert with ignore may return nothing)
    fetch = db.table("cash_books").select("*").eq(
        "site_id", str(site_id)
    ).eq("book_date", str(book_date)).execute()
    if not fetch.data:
        raise HTTPException(status_code=400, detail="Failed to create cash book")
    return fetch.data[0]


@router.patch("/{cash_book_id}/lock", response_model=dict)
async def lock_cash_book(cash_book_id: UUID, current_user=Depends(get_current_user)):
    db = get_supabase()
    result = db.table("cash_books").update({"status": "locked"}).eq("id", str(cash_book_id)).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Cash book not found")
    return result.data[0]


@router.patch("/{cash_book_id}/unlock", response_model=dict)
async def unlock_cash_book(cash_book_id: UUID, current_user=Depends(get_current_user)):
    db = get_supabase()
    result = db.table("cash_books").update({"status": "draft"}).eq("id", str(cash_book_id)).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Cash book not found")
    return result.data[0]
