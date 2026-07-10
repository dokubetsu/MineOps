from fastapi import APIRouter, HTTPException, Depends
from typing import Optional, List
from uuid import UUID
from datetime import date, timedelta
from app.database import get_supabase
from app.auth import get_current_user, require_admin

router = APIRouter()


@router.get("/site/{site_id}")
async def site_dashboard(site_id: UUID, for_date: Optional[date] = None, current_user=Depends(get_current_user)):
    """Site Manager dashboard - today's summary"""
    db = get_supabase()
    if for_date is None:
        for_date = date.today()

    trips_result = db.table("trips").select("id, contractor_id, transport_contractors(name)").eq(
        "site_id", str(site_id)
    ).eq("trip_date", str(for_date)).execute()
    trips = trips_result.data or []

    cb_result = db.table("cash_books").select(
        "id, opening_balance, closing_balance, status"
    ).eq("site_id", str(site_id)).eq("book_date", str(for_date)).execute()
    cash_book = cb_result.data[0] if cb_result.data else None

    emp_result = db.table("employees").select("id").eq("site_id", str(site_id)).eq("active", True).execute()
    emp_ids = [e["id"] for e in (emp_result.data or [])]
    total_employees = len(emp_ids)

    att_summary = {"present": 0, "absent": 0, "half_day": 0, "leave": 0}
    if emp_ids:
        att_result = db.table("attendance").select("status").in_(
            "employee_id", emp_ids
        ).eq("att_date", str(for_date)).execute()
        for a in (att_result.data or []):
            s = a["status"]
            if s == "present":
                att_summary["present"] += 1
            elif s == "absent":
                att_summary["absent"] += 1
            elif s == "half-day":
                att_summary["half_day"] += 1
            elif s == "leave":
                att_summary["leave"] += 1

    by_contractor = {}
    for t in trips:
        c_name = t.get("transport_contractors", {}).get("name", "Unknown") if t.get("transport_contractors") else "Unknown"
        by_contractor[c_name] = by_contractor.get(c_name, 0) + 1

    return {
        "date": str(for_date),
        "total_trips": len(trips),
        "trips_by_contractor": by_contractor,
        "cash_book": cash_book,
        "attendance": {**att_summary, "total": total_employees},
    }


@router.get("/owner")
async def owner_dashboard(
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    current_user=Depends(require_admin),  # Admin only
):
    """Owner/Admin cross-site dashboard"""
    db = get_supabase()
    if to_date is None:
        to_date = date.today()
    if from_date is None:
        from_date = to_date - timedelta(days=29)

    sites_result = db.table("sites").select("id, name").eq("active", True).execute()
    sites = sites_result.data or []

    trips_result = db.table("trips").select("site_id, trip_date").gte(
        "trip_date", str(from_date)
    ).lte("trip_date", str(to_date)).execute()
    trips = trips_result.data or []

    trips_by_site = {}
    for t in trips:
        sid = t["site_id"]
        trips_by_site[sid] = trips_by_site.get(sid, 0) + 1

    cb_result = db.table("cash_books").select("site_id, closing_balance, book_date").gte(
        "book_date", str(from_date)
    ).lte("book_date", str(to_date)).order("book_date", desc=True).execute()
    cash_data = cb_result.data or []

    latest_cash = {}
    for cb in cash_data:
        sid = cb["site_id"]
        if sid not in latest_cash:
            latest_cash[sid] = cb["closing_balance"]

    site_summaries = []
    for site in sites:
        sid = site["id"]
        site_summaries.append({
            "site_id": sid,
            "site_name": site["name"],
            "total_trips": trips_by_site.get(sid, 0),
            "latest_balance": latest_cash.get(sid, 0),
        })

    trip_trend = {}
    for t in trips:
        d = t["trip_date"]
        trip_trend[d] = trip_trend.get(d, 0) + 1

    return {
        "period": {"from": str(from_date), "to": str(to_date)},
        "total_trips": len(trips),
        "sites": site_summaries,
        "trip_trend": [{"date": d, "count": c} for d, c in sorted(trip_trend.items())],
    }


@router.get("/stakeholder/{user_id}")
async def stakeholder_dashboard(user_id: UUID, current_user=Depends(get_current_user)):
    """
    Stakeholder read-only dashboard.
    Fix 3: user_id is scoped to the authenticated user — no IDOR possible.
    """
    # Enforce: caller can only see their own dashboard (or admin can see any)
    db = get_supabase()
    admin_check = db.table("user_roles").select("role").eq(
        "user_id", str(current_user.id)
    ).eq("role", "admin").execute()
    is_admin = bool(admin_check.data)

    if not is_admin and str(current_user.id) != str(user_id):
        raise HTTPException(status_code=403, detail="You can only access your own dashboard")

    access_result = db.table("stakeholder_site_access").select(
        "site_id, share_percent, sites(name)"
    ).eq("stakeholder_user_id", str(user_id)).execute()
    accesses = access_result.data or []

    dashboards = []
    for access in accesses:
        site_id = access["site_id"]
        share = access["share_percent"]
        site_name = access.get("sites", {}).get("name", "Unknown")

        to_date = date.today()
        from_date = to_date - timedelta(days=29)

        trips_result = db.table("trips").select("id").eq("site_id", site_id).gte(
            "trip_date", str(from_date)
        ).lte("trip_date", str(to_date)).execute()
        total_trips = len(trips_result.data or [])

        summary_result = db.table("stakeholder_daily_summary").select(
            "total_in, total_out"
        ).eq("site_id", site_id).gte("book_date", str(from_date)).lte("book_date", str(to_date)).execute()
        sdata = summary_result.data or []
        total_in = sum(s.get("total_in", 0) for s in sdata)
        total_out = sum(s.get("total_out", 0) for s in sdata)
        net = total_in - total_out
        my_share = round(net * share / 100, 2)

        dashboards.append({
            "site_id": site_id,
            "site_name": site_name,
            "share_percent": share,
            "total_trips_30d": total_trips,
            "total_in_30d": total_in,
            "total_out_30d": total_out,
            "net_30d": net,
            "my_share_30d": my_share,
        })

    return {"sites": dashboards}
