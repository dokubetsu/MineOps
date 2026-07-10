from pydantic import BaseModel
from typing import Optional
from datetime import date, datetime
from uuid import UUID


# =====================================================
# SITES
# =====================================================
class SiteBase(BaseModel):
    name: str
    location: Optional[str] = None
    active: bool = True


class SiteCreate(SiteBase):
    pass


class SiteUpdate(BaseModel):
    name: Optional[str] = None
    location: Optional[str] = None
    active: Optional[bool] = None


class Site(SiteBase):
    id: UUID
    created_at: datetime

    class Config:
        from_attributes = True


# =====================================================
# TRANSPORT CONTRACTORS
# =====================================================
class ContractorBase(BaseModel):
    name: str
    active: bool = True


class ContractorCreate(ContractorBase):
    pass


class ContractorUpdate(BaseModel):
    name: Optional[str] = None
    active: Optional[bool] = None


class Contractor(ContractorBase):
    id: UUID
    created_at: datetime

    class Config:
        from_attributes = True


# =====================================================
# VEHICLES
# =====================================================
class VehicleBase(BaseModel):
    plate_number: str
    vehicle_type: str = "12WH"  # 12WH, 10WH, 6WH, Other
    ownership: str = "rented"  # owned, rented
    default_contractor_id: Optional[UUID] = None
    active: bool = True


class VehicleCreate(VehicleBase):
    pass


class VehicleUpdate(BaseModel):
    plate_number: Optional[str] = None
    vehicle_type: Optional[str] = None
    ownership: Optional[str] = None
    default_contractor_id: Optional[UUID] = None
    active: Optional[bool] = None


class Vehicle(VehicleBase):
    id: UUID
    created_at: datetime

    class Config:
        from_attributes = True


# =====================================================
# DRIVERS
# =====================================================
class DriverBase(BaseModel):
    name: str
    phone: Optional[str] = None
    license_number: Optional[str] = None
    active: bool = True


class DriverCreate(DriverBase):
    pass


class DriverUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    license_number: Optional[str] = None
    active: Optional[bool] = None


class Driver(DriverBase):
    id: UUID
    created_at: datetime

    class Config:
        from_attributes = True


# =====================================================
# TRIPS
# =====================================================
class TripBase(BaseModel):
    site_id: UUID
    vehicle_id: Optional[UUID] = None
    driver_id: Optional[UUID] = None
    contractor_id: Optional[UUID] = None
    trip_date: date
    entry_time: Optional[datetime] = None
    exit_time: Optional[datetime] = None
    load_info: Optional[str] = None
    dd_number: Optional[str] = None
    permit_number: Optional[str] = None
    photo_url: Optional[str] = None
    ownership_snapshot: Optional[str] = None
    notes: Optional[str] = None


class TripCreate(TripBase):
    id: Optional[UUID] = None  # Client-generated UUID for idempotency


class TripUpdate(BaseModel):
    vehicle_id: Optional[UUID] = None
    driver_id: Optional[UUID] = None
    contractor_id: Optional[UUID] = None
    trip_date: Optional[date] = None
    entry_time: Optional[datetime] = None
    exit_time: Optional[datetime] = None
    load_info: Optional[str] = None
    dd_number: Optional[str] = None
    permit_number: Optional[str] = None
    photo_url: Optional[str] = None
    notes: Optional[str] = None


class Trip(TripBase):
    id: UUID
    created_by: Optional[UUID] = None
    created_at: datetime

    class Config:
        from_attributes = True


# =====================================================
# CASH BOOKS
# =====================================================
class CashBookBase(BaseModel):
    site_id: UUID
    book_date: date
    opening_balance: float = 0.0


class CashBookCreate(CashBookBase):
    pass


class CashBook(CashBookBase):
    id: UUID
    closing_balance: float = 0.0
    status: str = "draft"
    created_at: datetime

    class Config:
        from_attributes = True


# =====================================================
# CASH ENTRIES
# =====================================================
class CashEntryBase(BaseModel):
    cash_book_id: UUID
    entry_type: str  # 'in' or 'out'
    category: str
    amount: float
    note: Optional[str] = None


class CashEntryCreate(CashEntryBase):
    id: Optional[UUID] = None  # Client-generated UUID for idempotency


class CashEntryUpdate(BaseModel):
    entry_type: Optional[str] = None
    category: Optional[str] = None
    amount: Optional[float] = None
    note: Optional[str] = None


class CashEntry(CashEntryBase):
    id: UUID
    created_by: Optional[UUID] = None
    created_at: datetime

    class Config:
        from_attributes = True


# =====================================================
# EMPLOYEES
# =====================================================
class EmployeeBase(BaseModel):
    name: str
    phone: Optional[str] = None
    role: str = "worker"
    site_id: Optional[UUID] = None
    wage_type: str = "daily"  # daily, monthly
    wage_rate: float = 0.0
    join_date: Optional[date] = None
    active: bool = True


class EmployeeCreate(EmployeeBase):
    pass


class EmployeeUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    role: Optional[str] = None
    site_id: Optional[UUID] = None
    wage_type: Optional[str] = None
    wage_rate: Optional[float] = None
    active: Optional[bool] = None


class Employee(EmployeeBase):
    id: UUID
    created_at: datetime

    class Config:
        from_attributes = True


# =====================================================
# ATTENDANCE
# =====================================================
class AttendanceBase(BaseModel):
    employee_id: UUID
    att_date: date
    status: str = "present"  # present, absent, half-day, leave


class AttendanceCreate(AttendanceBase):
    pass


class AttendanceBulkMark(BaseModel):
    date: date
    records: list[dict]  # [{employee_id, status}]


class Attendance(AttendanceBase):
    id: UUID
    marked_by: Optional[UUID] = None
    created_at: datetime

    class Config:
        from_attributes = True


# =====================================================
# LEAVE APPLICATIONS
# =====================================================
class LeaveApplicationBase(BaseModel):
    employee_id: UUID
    from_date: date
    to_date: date
    reason: Optional[str] = None


class LeaveApplicationCreate(LeaveApplicationBase):
    pass


class LeaveApplicationUpdate(BaseModel):
    status: str  # pending, approved, rejected


class LeaveApplication(LeaveApplicationBase):
    id: UUID
    status: str = "pending"
    approved_by: Optional[UUID] = None
    created_at: datetime

    class Config:
        from_attributes = True


# =====================================================
# PAYROLL
# =====================================================
class PayrollRunCreate(BaseModel):
    site_id: UUID
    period_month: date  # First day of month


class PayrollLineAdjustment(BaseModel):
    payroll_line_id: UUID
    adjustment: float
    notes: Optional[str] = None


class PayrollRun(BaseModel):
    id: UUID
    site_id: UUID
    period_month: date
    status: str
    generated_at: datetime

    class Config:
        from_attributes = True


class PayrollLine(BaseModel):
    id: UUID
    payroll_run_id: UUID
    employee_id: UUID
    days_present: int
    days_leave: int
    days_absent: int
    base_rate: float
    computed_amount: float
    adjustment: float
    final_amount: float
    notes: Optional[str] = None

    class Config:
        from_attributes = True
