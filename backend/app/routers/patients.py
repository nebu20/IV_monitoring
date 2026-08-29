"""
Card Room Patient Router
========================
GET  /api/patients/:cardId  — lookup patient by Card ID / MRN
POST /api/patients           — register a new card room patient (Admin)
GET  /api/patients           — list all card room patients (Admin)
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional

from app.database import get_db
from app.models import CardRoomPatient, User
from app.auth import get_current_user, require_admin

router = APIRouter(prefix="/api/patients", tags=["Card Room"])


class PatientCreate(BaseModel):
    """
    Payload schema for external system / Postman registration.
    Accepts both camelCase (from Postman) and snake_case.
    """
    card_id: Optional[str] = None
    cardId: Optional[str] = None                      # camelCase alias
    patient_name: Optional[str] = None
    patientName: Optional[str] = None                 # camelCase alias
    age: Optional[int] = None
    gender: Optional[str] = None
    prescribed_fluid: Optional[str] = None
    fluidType: Optional[str] = None                   # camelCase alias
    target_volume_ml: Optional[float] = None
    targetVolume: Optional[float] = None              # camelCase alias
    target_drop_rate: Optional[float] = None
    prescribedDropRate: Optional[float] = None        # camelCase alias
    ward: Optional[str] = None
    attending_doctor: Optional[str] = None


@router.get("/{card_id}")
async def get_patient_by_card(
    card_id: str,
    db: AsyncSession = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """
    Fetch pre-registered patient info from Card Room database.
    Used by the bedside IV registration form to auto-populate fields.
    """
    result = await db.execute(
        select(CardRoomPatient).where(CardRoomPatient.card_id == card_id)
    )
    patient = result.scalars().first()
    if not patient:
        raise HTTPException(
            status_code=404,
            detail=f"No patient found with Card ID '{card_id}'. Please register them in the Card Room first.",
        )

    return {
        "card_id": patient.card_id,
        "patient_name": patient.patient_name,
        "age": patient.age,
        "prescribed_fluid": patient.prescribed_fluid,
        "target_volume_ml": patient.target_volume_ml,
        "target_drop_rate": patient.target_drop_rate,
        "ward": patient.ward,
        "attending_doctor": patient.attending_doctor,
        "notes": patient.notes,
    }


@router.post("", status_code=201)
async def create_patient(
    body: PatientCreate,
    db: AsyncSession = Depends(get_db),
):
    """
    Register a patient from an external system (Postman / hospital HIS).
    Accepts both camelCase and snake_case field names.
    No authentication required — this is called by external systems.

    Example Postman payload:
    {
        "cardId": "MRN-10042",
        "patientName": "Abebe Girma",
        "age": 34,
        "gender": "Male",
        "fluidType": "NS 0.9%",
        "targetVolume": 500,
        "prescribedDropRate": 30,
        "ward": "2A",
        "attending_doctor": "Dr. Tadesse"
    }
    """
    # Resolve camelCase → snake_case
    resolved_card_id    = body.card_id or body.cardId
    resolved_name       = body.patient_name or body.patientName
    resolved_fluid      = body.prescribed_fluid or body.fluidType
    resolved_volume     = body.target_volume_ml or body.targetVolume
    resolved_rate       = body.target_drop_rate or body.prescribedDropRate

    if not resolved_card_id:
        raise HTTPException(status_code=422, detail="card_id or cardId is required")
    if not resolved_name:
        raise HTTPException(status_code=422, detail="patient_name or patientName is required")

    existing = await db.execute(
        select(CardRoomPatient).where(CardRoomPatient.card_id == resolved_card_id)
    )
    if existing.scalars().first():
        raise HTTPException(status_code=409, detail=f"Card ID '{resolved_card_id}' already exists")

    patient = CardRoomPatient(
        card_id=resolved_card_id,
        patient_name=resolved_name,
        age=body.age,
        prescribed_fluid=resolved_fluid,
        target_volume_ml=resolved_volume,
        target_drop_rate=resolved_rate,
        ward=body.ward,
        attending_doctor=body.attending_doctor,
    )
    db.add(patient)
    await db.commit()
    return {
        "success": True,
        "card_id": resolved_card_id,
        "message": f"Patient '{resolved_name}' registered successfully.",
    }


@router.get("")
async def list_patients(db: AsyncSession = Depends(get_db)):
    """List all card room patients — open endpoint for system integration."""
    result = await db.execute(select(CardRoomPatient))
    patients = result.scalars().all()
    return [
        {
            "card_id": p.card_id,
            "patient_name": p.patient_name,
            "age": p.age,
            "prescribed_fluid": p.prescribed_fluid,
            "target_volume_ml": p.target_volume_ml,
            "target_drop_rate": p.target_drop_rate,
            "ward": p.ward,
        }
        for p in patients
    ]
