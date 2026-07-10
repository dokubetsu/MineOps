from fastapi import APIRouter, HTTPException
from typing import List, Optional
from uuid import UUID
from app.models import CashBookCreate, CashEntryCreate, CashEntryUpdate
from app.database import get_supabase
from datetime import date

router = APIRouter()


@router.get("/", response_model=List[dict])
async def list_cash_books(
    site_id: Optional[UUID] = None,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
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
async def get_or_create_cash_book(book_date: date, site_id: UUID):
    """Get cash book for a site/date, auto-creating if missing with previous day's closing as opening balance"""
    db = get_supabase()
    # Try to get existing
    result = db.table("cash_books").select("*").eq("site_id", str(site_id)).eq("book_date", str(book_date)).execute()
    if result.data:
        return result.data[0]

    # Get previous day's closing balance
    prev_result = db.table("cash_books").select("closing_balance").eq("site_id", str(site_id)).lt(
        "book_date", str(book_date)
    ).order("book_date", desc=True).limit(1).execute()

    opening_balance = 0.0
    if prev_result.data:
        opening_balance = prev_result.data[0].get("closing_balance", 0.0) or 0.0

    # Create new cash book
    new_book = {
        "site_id": str(site_id),
        "book_date": str(book_date),
        "opening_balance": opening_balance,
        "closing_balance": opening_balance,
        "status": "draft",
    }
    create_result = db.table("cash_books").insert(new_book).execute()
    if not create_result.data:
        raise HTTPException(status_code=400, detail="Failed to create cash book")
    return create_result.data[0]


@router.patch("/{cash_book_id}/lock", response_model=dict)
async def lock_cash_book(cash_book_id: UUID):
    db = get_supabase()
    result = db.table("cash_books").update({"status": "locked"}).eq("id", str(cash_book_id)).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Cash book not found")
    return result.data[0]


@router.patch("/{cash_book_id}/unlock", response_model=dict)
async def unlock_cash_book(cash_book_id: UUID):
    db = get_supabase()
    result = db.table("cash_books").update({"status": "draft"}).eq("id", str(cash_book_id)).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Cash book not found")
    return result.data[0]
