"""
Mine Logistics & Workforce Management - FastAPI Backend
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from app.routers import (
    sites,
    vehicles,
    contractors,
    drivers,
    trips,
    cash_books,
    cash_entries,
    employees,
    attendance,
    leave_applications,
    payroll,
    dashboard,
)
from app.config import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(
    title="Mine Logistics & Workforce Management API",
    description="Backend API for managing mine operations, trips, cash books, attendance and payroll",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS for Next.js frontend and mobile PWA
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include all routers
app.include_router(sites.router, prefix="/api/sites", tags=["Sites"])
app.include_router(vehicles.router, prefix="/api/vehicles", tags=["Vehicles"])
app.include_router(contractors.router, prefix="/api/contractors", tags=["Contractors"])
app.include_router(drivers.router, prefix="/api/drivers", tags=["Drivers"])
app.include_router(trips.router, prefix="/api/trips", tags=["Trips"])
app.include_router(cash_books.router, prefix="/api/cash-books", tags=["Cash Books"])
app.include_router(cash_entries.router, prefix="/api/cash-entries", tags=["Cash Entries"])
app.include_router(employees.router, prefix="/api/employees", tags=["Employees"])
app.include_router(attendance.router, prefix="/api/attendance", tags=["Attendance"])
app.include_router(leave_applications.router, prefix="/api/leave", tags=["Leave Applications"])
app.include_router(payroll.router, prefix="/api/payroll", tags=["Payroll"])
app.include_router(dashboard.router, prefix="/api/dashboard", tags=["Dashboard"])


@app.get("/health")
async def health_check():
    return {"status": "healthy", "app": "Mine Logistics API"}
