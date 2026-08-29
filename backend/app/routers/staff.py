"""
HR Staff Router
===============
GET  /api/staff/:staffId  — lookup staff record (HR auto-fill for admin form)
POST /api/staff           — register a staff record (Postman / HIS integration)
GET  /api/staff           — list all staff records (admin only)
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional

from app.database import get_db
from app.models import HRStaffRecord
from app.auth import get_current_user, require_admin
from app.models import User

router = APIRouter(prefix="/api/staff", tags=["HR Staff"])

# ── Mock seed data (auto-loaded on startup if table is empty) ─────────────────
MOCK_STAFF = [
    {
        "staff_id": "STF-2024-001",
        "full_name": "Almaz Kebede",
        "department": "Ward 2A — General Medicine",
        "ward": "2A",
        "license_id": "RN-88492",
        "license_status": "ACTIVE",
        "role_title": "Registered Nurse",
    },
    {
        "staff_id": "STF-2024-002",
        "full_name": "Biruk Alemu",
        "department": "Ward 2B — Surgery",
        "ward": "2B",
        "license_id": "RN-77341",
        "license_status": "ACTIVE",
        "role_title": "Registered Nurse",
    },
    {
        "staff_id": "STF-2024-003",
        "full_name": "Chaltu Mamo",
        "department": "Ward 3A — Pediatrics",
        "ward": "3A",
        "license_id": "RN-65892",
        "license_status": "ACTIVE",
        "role_title": "Senior Nurse",
    },
    {
        "staff_id": "STF-2024-ADM",
        "full_name": "Dawit Tesfaye",
        "department": "Administration",
        "ward": None,
        "license_id": "ADM-10021",
        "license_status": "ACTIVE",
        "role_title": "Ward Administrator",
    },
]


async def seed_mock_staff(db: AsyncSession) -> None:
    """Seed mock HR records if the table is empty."""
    result = await db.execute(select(HRStaffRecord).limit(1))
    if result.scalars().first() is not None:
        return
    for s in MOCK_STAFF:
        db.add(HRStaffRecord(**s))
    await db.commit()


# ── Schemas ───────────────────────────────────────────────────────────────────

class StaffCreate(BaseModel):
    staff_id: str
    full_name: str
    department: Optional[str] = None
    ward: Optional[str] = None
    license_id: Optional[str] = None
    license_status: str = "ACTIVE"
    role_title: Optional[str] = None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/{staff_id}")
async def lookup_staff(
    staff_id: str,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """
    HR auto-fill lookup — called when Admin enters a Staff ID.
    Returns staff metadata to pre-populate the registration form.
    Blocks account creation if license is REVOKED or EXPIRED.
    """
    result = await db.execute(
        select(HRStaffRecord).where(HRStaffRecord.staff_id == staff_id)
    )
    staff = result.scalars().first()

    if not staff:
        raise HTTPException(
            status_code=404,
            detail=f"Staff ID '{staff_id}' not found in HR database. Ensure the staff member is registered in the HR system first.",
        )

    if staff.license_status in ("REVOKED", "EXPIRED"):
        raise HTTPException(
            status_code=403,
            detail=f"Staff ID '{staff_id}' has a {staff.license_status} license. Account creation is blocked. Contact HR to resolve.",
        )

    return {
        "staff_id": staff.staff_id,
        "full_name": staff.full_name,
        "department": staff.department,
        "ward": staff.ward,
        "license_id": staff.license_id,
        "license_status": staff.license_status,
        "role_title": staff.role_title,
    }


@router.post("", status_code=201)
async def register_staff(
    body: StaffCreate,
    db: AsyncSession = Depends(get_db),
):
    """
    Register a staff member in the HR database.
    Open endpoint — called by Postman or external HIS.
    """
    existing = await db.execute(
        select(HRStaffRecord).where(HRStaffRecord.staff_id == body.staff_id)
    )
    if existing.scalars().first():
        raise HTTPException(status_code=409, detail=f"Staff ID '{body.staff_id}' already exists")

    staff = HRStaffRecord(**body.model_dump())
    db.add(staff)
    await db.commit()
    return {"success": True, "staff_id": body.staff_id, "message": f"Staff '{body.full_name}' registered."}


@router.get("")
async def list_staff(
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Admin only — list all HR staff records."""
    result = await db.execute(select(HRStaffRecord))
    records = result.scalars().all()
    return [
        {
            "staff_id": r.staff_id,
            "full_name": r.full_name,
            "department": r.department,
            "ward": r.ward,
            "license_id": r.license_id,
            "license_status": r.license_status,
            "role_title": r.role_title,
        }
        for r in records
    ]
