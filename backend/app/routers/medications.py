"""
Medication Reminder Router
==========================
POST   /api/medications/schedules                  — create a schedule (Admin+)
GET    /api/medications/schedules                  — list schedules (Nurse+, ward-filtered)
GET    /api/medications/schedules/{id}             — get a specific schedule
PUT    /api/medications/schedules/{id}             — update a schedule (Admin+)
PUT    /api/medications/schedules/{id}/discontinue — discontinue (Admin+)
GET    /api/medications/due                        — doses due/overdue/upcoming (Nurse+)
POST   /api/medications/doses/ensure               — create dose records for due slots
POST   /api/medications/doses/{id}/administer      — record administration (Nurse+)
POST   /api/medications/doses/{id}/acknowledge     — acknowledge reminder (Nurse+)
GET    /api/medications/history/{card_id}          — administration history for a patient

Timezone strategy
-----------------
All timestamps are stored as UTC-naive datetimes in the database (matching the
existing project convention).  When computing "today" for the due-dose window,
Africa/Addis_Ababa (UTC+3) is used — the system is deployed in Ethiopia.
The constant LOCAL_TZ can be changed via the MEDICATION_TZ env-var without a
code change.

The due endpoint looks back LOOKBACK_DAYS (default 3) to surface PENDING doses
from past days that were never acted on.  These are shown with status OVERDUE
and are never automatically resolved, recorded, or replaced.

Authorization
--------------
- Admin / Superadmin: create, edit, discontinue schedules (any patient).
  Admin is system-wide (ward-level admin) — no additional ward restriction
  on write operations, matching the existing Admin role semantics in this
  project.
- Nurse: view schedules, record administration, acknowledge — subject to
  patient ward scope (see _patient_in_nurse_scope).
- Patient ward scope for Nurses is based on CardRoomPatient.ward matched
  against User.assigned_ward.  This persists after an IV session ends.
  As a secondary check, IVMetadata (both active and historical) is also
  consulted so a nurse who has treated the patient via IV also retains access.
"""

from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import select, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import (
    MedicationSchedule, DoseRecord, CardRoomPatient, IVMetadata, User,
)
from app.auth import get_current_user, require_admin, require_nurse_or_admin

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/medications", tags=["Medication Reminders"])

# ── Timezone configuration ─────────────────────────────────────────────────────

_tz_name = os.environ.get("MEDICATION_TZ", "Africa/Addis_Ababa")
LOCAL_TZ: ZoneInfo = ZoneInfo(_tz_name)

# How many past days to include PENDING/OVERDUE doses from
LOOKBACK_DAYS: int = int(os.environ.get("MEDICATION_LOOKBACK_DAYS", "3"))


def _utcnow() -> datetime:
    """Return the current UTC time as a naive datetime (consistent with DB storage)."""
    return datetime.utcnow()


def _local_now() -> datetime:
    """Return the current local (Africa/Addis_Ababa) time as a tz-aware datetime."""
    from datetime import timezone
    return datetime.now(tz=LOCAL_TZ)


# ── Input validation helpers ───────────────────────────────────────────────────

_HHMM_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


def _validate_time_str(t: str) -> str:
    """Raise ValueError if t is not a valid HH:MM string."""
    if not _HHMM_RE.match(t):
        raise ValueError(
            f"'{t}' is not a valid time. Use HH:MM (00:00–23:59), e.g. '08:00'."
        )
    return t


def _validate_times(times: List[str]) -> List[str]:
    if not times:
        raise ValueError("At least one scheduled time is required.")
    return [_validate_time_str(t) for t in times]


# ── Schemas ───────────────────────────────────────────────────────────────────

VALID_ADMIN_STATUSES = {"GIVEN", "DELAYED", "REFUSED", "NOT_GIVEN"}
VALID_ROUTES = {"PO", "IV", "IM", "SC", "TOP", "INH", "PR", "SL", "OPHTH", "OTIC"}


class ScheduleCreate(BaseModel):
    card_id: str = Field(..., example="MRN-10042")
    medication_name: str = Field(..., example="Amoxicillin")
    dose: str = Field(..., example="500 mg")
    route: str = Field("PO", example="PO")
    frequency: str = Field(..., example="BID")
    scheduled_times: List[str] = Field(..., example=["08:00", "20:00"])
    start_date: str = Field(..., example="2026-01-01T00:00:00")
    end_date: Optional[str] = Field(None, example="2026-01-14T00:00:00")
    instructions: Optional[str] = None

    @field_validator("scheduled_times")
    @classmethod
    def validate_times(cls, v: List[str]) -> List[str]:
        return _validate_times(v)

    @field_validator("route")
    @classmethod
    def validate_route(cls, v: str) -> str:
        if v not in VALID_ROUTES:
            raise ValueError(
                f"Invalid route '{v}'. Valid routes: {', '.join(sorted(VALID_ROUTES))}"
            )
        return v


class ScheduleUpdate(BaseModel):
    medication_name: Optional[str] = None
    dose: Optional[str] = None
    route: Optional[str] = None
    frequency: Optional[str] = None
    scheduled_times: Optional[List[str]] = None
    end_date: Optional[str] = None
    instructions: Optional[str] = None

    @field_validator("scheduled_times")
    @classmethod
    def validate_times(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        if v is not None:
            return _validate_times(v)
        return v

    @field_validator("route")
    @classmethod
    def validate_route(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in VALID_ROUTES:
            raise ValueError(
                f"Invalid route '{v}'. Valid routes: {', '.join(sorted(VALID_ROUTES))}"
            )
        return v


class ScheduleResponse(BaseModel):
    id: int
    card_id: str
    medication_name: str
    dose: str
    route: str
    frequency: str
    scheduled_times: List[str]
    start_date: str
    end_date: Optional[str]
    instructions: Optional[str]
    active: bool
    created_by: str
    created_at: str


class AdministerRequest(BaseModel):
    status: str = Field(..., description="GIVEN | DELAYED | REFUSED | NOT_GIVEN")
    reason: Optional[str] = None
    notes: Optional[str] = None
    administered_at: Optional[str] = None  # ISO datetime, defaults to now


class AcknowledgeRequest(BaseModel):
    notes: Optional[str] = None


# ── Helpers ────────────────────────────────────────────────────────────────────

async def _patient_in_nurse_scope(
    db: AsyncSession, card_id: str, user: User
) -> bool:
    """
    Check whether a patient is within a nurse's scope.

    Admin and Superadmin always have full access.

    For Nurses, scope is determined by:
      1. PRIMARY:   CardRoomPatient.ward == User.assigned_ward
         The patient's registered ward (from the Card Room) matches the
         nurse's assigned ward.  This persists even after an IV session ends.
      2. SECONDARY: The nurse has (or had) an active IV session for this patient
         on one of their assigned beds.  This covers patients registered to a
         different ward who were physically moved.

    A nurse with no assigned_ward and no assigned_beds has no scope.
    """
    if user.role in ("Superadmin", "Admin"):
        return True

    assigned_ward = user.assigned_ward
    assigned_beds = set(user.assigned_beds or [])

    if not assigned_ward and not assigned_beds:
        return False

    # Check 1: patient's Card Room ward matches nurse's assigned ward
    if assigned_ward:
        patient_result = await db.execute(
            select(CardRoomPatient).where(
                CardRoomPatient.card_id == card_id,
                CardRoomPatient.ward == assigned_ward,
            )
        )
        if patient_result.scalars().first() is not None:
            return True

    # Check 2: nurse has (or had) an IV session for this patient on their beds
    if assigned_beds:
        iv_result = await db.execute(
            select(IVMetadata).where(
                IVMetadata.card_id == card_id,
                IVMetadata.room_bed.in_(assigned_beds),
            )
        )
        if iv_result.scalars().first() is not None:
            return True

    return False


async def _get_patient_info(
    db: AsyncSession, card_id: str
) -> tuple[Optional[str], Optional[str]]:
    """Return (patient_name, room_bed) for display. room_bed from active IV if available."""
    patient_result = await db.execute(
        select(CardRoomPatient).where(CardRoomPatient.card_id == card_id)
    )
    patient = patient_result.scalars().first()
    if not patient:
        return None, None

    iv_result = await db.execute(
        select(IVMetadata).where(
            IVMetadata.card_id == card_id, IVMetadata.active == True
        )
    )
    iv = iv_result.scalars().first()
    return patient.patient_name, (iv.room_bed if iv else None)


def _parse_dt(s: str) -> datetime:
    """Parse an ISO-8601 datetime string into a UTC-naive datetime."""
    try:
        # Strip timezone designator if present before parsing
        cleaned = s.replace("Z", "").split("+")[0]
        return datetime.fromisoformat(cleaned)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"Invalid datetime: '{s}'")


# ── Schedule Endpoints ─────────────────────────────────────────────────────────

@router.post("/schedules", response_model=ScheduleResponse, status_code=201)
async def create_schedule(
    body: ScheduleCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Create a new medication schedule (Admin+ only)."""
    patient_result = await db.execute(
        select(CardRoomPatient).where(CardRoomPatient.card_id == body.card_id)
    )
    if not patient_result.scalars().first():
        raise HTTPException(
            status_code=404,
            detail=f"Patient '{body.card_id}' not found in Card Room.",
        )

    start_dt = _parse_dt(body.start_date)
    end_dt = _parse_dt(body.end_date) if body.end_date else None
    if end_dt and end_dt < start_dt:
        raise HTTPException(
            status_code=422, detail="end_date cannot be before start_date."
        )

    schedule = MedicationSchedule(
        card_id=body.card_id,
        medication_name=body.medication_name,
        dose=body.dose,
        route=body.route,
        frequency=body.frequency,
        scheduled_times=body.scheduled_times,
        start_date=start_dt,
        end_date=end_dt,
        instructions=body.instructions,
        active=True,
        created_by=current_user.username,
    )
    db.add(schedule)
    await db.commit()
    await db.refresh(schedule)

    return ScheduleResponse(
        id=schedule.id,
        card_id=schedule.card_id,
        medication_name=schedule.medication_name,
        dose=schedule.dose,
        route=schedule.route,
        frequency=schedule.frequency,
        scheduled_times=schedule.scheduled_times or [],
        start_date=schedule.start_date.isoformat(),
        end_date=schedule.end_date.isoformat() if schedule.end_date else None,
        instructions=schedule.instructions,
        active=schedule.active,
        created_by=schedule.created_by,
        created_at=(
            schedule.created_at.isoformat()
            if schedule.created_at
            else _utcnow().isoformat()
        ),
    )


@router.get("/schedules")
async def list_schedules(
    active_only: bool = True,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_nurse_or_admin),
):
    """List medication schedules. Nurses see only patients in their ward."""
    query = select(MedicationSchedule)
    if active_only:
        query = query.where(MedicationSchedule.active == True)

    result = await db.execute(query.order_by(MedicationSchedule.start_date.desc()))
    schedules = result.scalars().all()

    filtered = []
    for s in schedules:
        if not await _patient_in_nurse_scope(db, s.card_id, current_user):
            continue
        patient_name, room_bed = await _get_patient_info(db, s.card_id)
        filtered.append(
            {
                "id": s.id,
                "card_id": s.card_id,
                "patient_name": patient_name,
                "room_bed": room_bed,
                "medication_name": s.medication_name,
                "dose": s.dose,
                "route": s.route,
                "frequency": s.frequency,
                "scheduled_times": s.scheduled_times or [],
                "start_date": s.start_date.isoformat() if s.start_date else None,
                "end_date": s.end_date.isoformat() if s.end_date else None,
                "instructions": s.instructions,
                "active": s.active,
                "created_by": s.created_by,
            }
        )
    return filtered


@router.get("/schedules/{schedule_id}")
async def get_schedule(
    schedule_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_nurse_or_admin),
):
    result = await db.execute(
        select(MedicationSchedule).where(MedicationSchedule.id == schedule_id)
    )
    schedule = result.scalars().first()
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found.")

    if not await _patient_in_nurse_scope(db, schedule.card_id, current_user):
        raise HTTPException(
            status_code=403, detail="Access denied: patient is not in your scope."
        )

    patient_name, room_bed = await _get_patient_info(db, schedule.card_id)
    return {
        "id": schedule.id,
        "card_id": schedule.card_id,
        "patient_name": patient_name,
        "room_bed": room_bed,
        "medication_name": schedule.medication_name,
        "dose": schedule.dose,
        "route": schedule.route,
        "frequency": schedule.frequency,
        "scheduled_times": schedule.scheduled_times or [],
        "start_date": schedule.start_date.isoformat() if schedule.start_date else None,
        "end_date": schedule.end_date.isoformat() if schedule.end_date else None,
        "instructions": schedule.instructions,
        "active": schedule.active,
        "created_by": schedule.created_by,
        "created_at": schedule.created_at.isoformat() if schedule.created_at else None,
    }


@router.put("/schedules/{schedule_id}")
async def update_schedule(
    schedule_id: int,
    body: ScheduleUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Update a medication schedule.
    Admins and Superadmins may update any schedule (Admin role is system-wide
    in this project — no per-ward restriction on writes).
    Nurses cannot reach this endpoint (require_admin blocks them).
    """
    result = await db.execute(
        select(MedicationSchedule).where(MedicationSchedule.id == schedule_id)
    )
    schedule = result.scalars().first()
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found.")
    if not schedule.active:
        raise HTTPException(
            status_code=409, detail="Cannot edit a discontinued schedule."
        )

    if body.medication_name is not None:
        schedule.medication_name = body.medication_name
    if body.dose is not None:
        schedule.dose = body.dose
    if body.route is not None:
        schedule.route = body.route
    if body.frequency is not None:
        schedule.frequency = body.frequency
    if body.scheduled_times is not None:
        schedule.scheduled_times = body.scheduled_times
    if body.end_date is not None:
        new_end = _parse_dt(body.end_date)
        if schedule.start_date and new_end < schedule.start_date:
            raise HTTPException(
                status_code=422, detail="end_date cannot be before start_date."
            )
        schedule.end_date = new_end
    if body.instructions is not None:
        schedule.instructions = body.instructions

    await db.commit()
    return {"success": True, "message": "Schedule updated."}


@router.put("/schedules/{schedule_id}/discontinue")
async def discontinue_schedule(
    schedule_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Discontinue a schedule.  Admin and Superadmin only; Nurses are blocked
    by require_admin.  Admin access is intentionally system-wide.
    """
    result = await db.execute(
        select(MedicationSchedule).where(MedicationSchedule.id == schedule_id)
    )
    schedule = result.scalars().first()
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found.")
    if not schedule.active:
        raise HTTPException(
            status_code=409, detail="Schedule is already discontinued."
        )

    schedule.active = False
    schedule.end_date = _utcnow()
    await db.commit()
    return {"success": True, "message": "Schedule discontinued."}


# ── Dose Tracking Endpoints ────────────────────────────────────────────────────

@router.get("/due")
async def get_due_doses(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_nurse_or_admin),
):
    """
    Return doses that are UPCOMING, DUE, or OVERDUE within the caller's scope.

    "Today" is computed in Africa/Addis_Ababa local time so that the
    08:00 dose appears at 08:00 Ethiopian Standard Time regardless of the
    UTC clock.

    Past days (up to LOOKBACK_DAYS) are also scanned so that PENDING doses
    from previous days are not silently lost at midnight.  These are returned
    with status OVERDUE.  They are never automatically resolved.

    Status rules (all times in local timezone for display):
      UPCOMING  — scheduled time is within the next 1 hour and has not passed
      DUE       — current local time >= scheduled time, within 4 hours
      OVERDUE   — more than 4 hours have elapsed with no DoseRecord, OR the
                  slot was from a previous day with no terminal DoseRecord
      GIVEN / DELAYED / REFUSED / NOT_GIVEN — terminal states from DoseRecord

    Doses that fall in the future beyond the next 1 hour are omitted.
    Doses from days beyond LOOKBACK_DAYS are omitted.
    """
    now_utc = _utcnow()
    now_local = _local_now()
    local_today = now_local.date()

    query = select(MedicationSchedule).where(MedicationSchedule.active == True)
    result = await db.execute(query)
    schedules = result.scalars().all()

    due_items = []
    for schedule in schedules:
        if not await _patient_in_nurse_scope(db, schedule.card_id, current_user):
            continue

        # Check schedule date range (compare in UTC storage convention)
        start_dt = schedule.start_date
        end_dt = schedule.end_date
        if start_dt and now_utc < start_dt:
            continue
        if end_dt and now_utc > end_dt:
            continue

        patient_name, room_bed = await _get_patient_info(db, schedule.card_id)

        # Scan today and the previous LOOKBACK_DAYS days
        for day_offset in range(0, LOOKBACK_DAYS + 1):
            check_date = local_today - timedelta(days=day_offset)
            is_past_day = day_offset > 0

            for time_str in schedule.scheduled_times or []:
                try:
                    hour, minute = map(int, time_str.split(":"))
                    # Build a naive UTC datetime corresponding to this
                    # local scheduled time on check_date.
                    # Strategy: build local-tz-aware datetime → convert to UTC → strip tz
                    from datetime import timezone as _tz
                    import datetime as _dt_mod

                    local_dt_aware = _dt_mod.datetime(
                        check_date.year, check_date.month, check_date.day,
                        hour, minute, tzinfo=LOCAL_TZ,
                    )
                    # Convert to UTC-naive for DB comparison
                    utc_offset = local_dt_aware.utcoffset()
                    scheduled_dt_utc = (local_dt_aware - utc_offset).replace(tzinfo=None)
                except (ValueError, AttributeError):
                    continue

                # For today, skip times more than 1 hour in the future
                if not is_past_day:
                    seconds_until = (scheduled_dt_utc - now_utc).total_seconds()
                    if seconds_until > 3600:
                        continue

                # Look for existing DoseRecord
                dose_result = await db.execute(
                    select(DoseRecord).where(
                        DoseRecord.schedule_id == schedule.id,
                        DoseRecord.scheduled_datetime == scheduled_dt_utc,
                    )
                )
                dose = dose_result.scalars().first()

                if dose and dose.status != "PENDING":
                    # Terminal status — include in output for context
                    computed_status = dose.status
                elif dose and dose.status == "PENDING":
                    # Pending record exists — compute time-based status
                    elapsed = (now_utc - scheduled_dt_utc).total_seconds()
                    if is_past_day or elapsed > 4 * 3600:
                        computed_status = "OVERDUE"
                    elif elapsed >= 0:
                        computed_status = "DUE"
                    else:
                        computed_status = "UPCOMING"
                else:
                    # No record — compute from elapsed time
                    elapsed = (now_utc - scheduled_dt_utc).total_seconds()
                    if is_past_day or elapsed > 4 * 3600:
                        computed_status = "OVERDUE"
                    elif elapsed >= 0:
                        computed_status = "DUE"
                    else:
                        computed_status = "UPCOMING"

                # Convert scheduled UTC back to local ISO for display
                local_display = local_dt_aware.isoformat()

                due_items.append(
                    {
                        "schedule_id": schedule.id,
                        "dose_id": dose.id if dose else None,
                        # scheduled_datetime in LOCAL time for display
                        "scheduled_datetime": local_display,
                        # scheduled_datetime_utc for round-tripping to ensure_dose
                        "scheduled_datetime_utc": scheduled_dt_utc.isoformat(),
                        "status": computed_status,
                        "medication_name": schedule.medication_name,
                        "dose": schedule.dose,
                        "route": schedule.route,
                        "card_id": schedule.card_id,
                        "patient_name": patient_name,
                        "room_bed": room_bed,
                        "acknowledged": (
                            dose.acknowledged_by is not None if dose else False
                        ),
                        "administered_by": dose.administered_by if dose else None,
                        "administered_at": (
                            dose.administered_at.isoformat()
                            if dose and dose.administered_at
                            else None
                        ),
                        "reason": dose.reason if dose else None,
                        "notes": dose.notes if dose else None,
                    }
                )

    # Sort: OVERDUE first, DUE, UPCOMING, terminal last — then by scheduled time
    status_order = {"OVERDUE": 0, "DUE": 1, "UPCOMING": 2}
    due_items.sort(
        key=lambda x: (
            status_order.get(x["status"], 9),
            x["scheduled_datetime_utc"],
        )
    )
    return due_items


@router.post("/doses/ensure")
async def ensure_dose_record(
    schedule_id: int,
    scheduled_datetime: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_nurse_or_admin),
):
    """
    Create a PENDING DoseRecord for a (schedule, scheduled_datetime_utc) slot
    if one does not yet exist.  Returns the existing or newly created record.

    scheduled_datetime must be a UTC-naive ISO datetime (the
    scheduled_datetime_utc field from the /due response).

    Concurrent requests for the same slot are handled by the database
    UniqueConstraint on (schedule_id, scheduled_datetime).  An IntegrityError
    from a race condition is caught and the existing row is returned (409 is
    NOT raised — the existing record is what the caller wants).
    """
    result = await db.execute(
        select(MedicationSchedule).where(MedicationSchedule.id == schedule_id)
    )
    schedule = result.scalars().first()
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found.")

    if not await _patient_in_nurse_scope(db, schedule.card_id, current_user):
        raise HTTPException(
            status_code=403, detail="Access denied: patient is not in your scope."
        )

    scheduled_dt = _parse_dt(scheduled_datetime)

    # Try to find an existing record first
    dose_result = await db.execute(
        select(DoseRecord).where(
            DoseRecord.schedule_id == schedule_id,
            DoseRecord.scheduled_datetime == scheduled_dt,
        )
    )
    dose = dose_result.scalars().first()
    if dose:
        return {
            "id": dose.id,
            "schedule_id": dose.schedule_id,
            "scheduled_datetime": dose.scheduled_datetime.isoformat(),
            "status": dose.status,
            "acknowledged_by": dose.acknowledged_by,
            "administered_by": dose.administered_by,
        }

    # Attempt INSERT — the UniqueConstraint handles concurrent races
    new_dose = DoseRecord(
        schedule_id=schedule_id,
        scheduled_datetime=scheduled_dt,
        status="PENDING",
    )
    db.add(new_dose)
    try:
        await db.commit()
        await db.refresh(new_dose)
    except IntegrityError:
        # Another request beat us to it — roll back and return the existing row
        await db.rollback()
        dose_result = await db.execute(
            select(DoseRecord).where(
                DoseRecord.schedule_id == schedule_id,
                DoseRecord.scheduled_datetime == scheduled_dt,
            )
        )
        new_dose = dose_result.scalars().first()

    return {
        "id": new_dose.id,
        "schedule_id": new_dose.schedule_id,
        "scheduled_datetime": new_dose.scheduled_datetime.isoformat(),
        "status": new_dose.status,
        "acknowledged_by": new_dose.acknowledged_by,
        "administered_by": new_dose.administered_by,
    }


@router.post("/doses/{dose_id}/administer")
async def administer_dose(
    dose_id: int,
    body: AdministerRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_nurse_or_admin),
):
    """
    Record an administration event.  Status must be GIVEN, DELAYED, REFUSED,
    or NOT_GIVEN.  A dose that already has a terminal status cannot be
    re-administered (409).
    """
    result = await db.execute(
        select(DoseRecord).where(DoseRecord.id == dose_id)
    )
    dose = result.scalars().first()
    if not dose:
        raise HTTPException(status_code=404, detail="Dose record not found.")

    sched_result = await db.execute(
        select(MedicationSchedule).where(
            MedicationSchedule.id == dose.schedule_id
        )
    )
    schedule = sched_result.scalars().first()
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found.")

    if not await _patient_in_nurse_scope(db, schedule.card_id, current_user):
        raise HTTPException(
            status_code=403, detail="Access denied: patient is not in your scope."
        )

    if body.status not in VALID_ADMIN_STATUSES:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Invalid status '{body.status}'. "
                f"Valid: {', '.join(sorted(VALID_ADMIN_STATUSES))}"
            ),
        )

    if dose.status != "PENDING":
        raise HTTPException(
            status_code=409,
            detail=f"Dose already has status '{dose.status}'. Cannot re-administer.",
        )

    if body.status in ("DELAYED", "REFUSED", "NOT_GIVEN") and not body.reason:
        raise HTTPException(
            status_code=422,
            detail=f"A reason is required for status '{body.status}'.",
        )

    dose.status = body.status
    dose.administered_by = current_user.username
    dose.administered_at = (
        _parse_dt(body.administered_at) if body.administered_at else _utcnow()
    )
    dose.reason = body.reason
    dose.notes = body.notes
    await db.commit()

    return {
        "success": True,
        "message": f"Dose recorded as {body.status}.",
        "dose_id": dose.id,
        "status": dose.status,
        "administered_by": dose.administered_by,
    }


@router.post("/doses/{dose_id}/acknowledge")
async def acknowledge_dose(
    dose_id: int,
    body: AcknowledgeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_nurse_or_admin),
):
    """
    Acknowledge a reminder (silence the alert) WITHOUT recording that the
    medicine was taken.  Acknowledgement and administration are fully
    independent — a dose can be acknowledged before, during, or after
    administration.
    """
    result = await db.execute(
        select(DoseRecord).where(DoseRecord.id == dose_id)
    )
    dose = result.scalars().first()
    if not dose:
        raise HTTPException(status_code=404, detail="Dose record not found.")

    sched_result = await db.execute(
        select(MedicationSchedule).where(
            MedicationSchedule.id == dose.schedule_id
        )
    )
    schedule = sched_result.scalars().first()
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found.")

    if not await _patient_in_nurse_scope(db, schedule.card_id, current_user):
        raise HTTPException(
            status_code=403, detail="Access denied: patient is not in your scope."
        )

    if dose.acknowledged_by is not None:
        raise HTTPException(status_code=409, detail="Reminder already acknowledged.")

    dose.acknowledged_by = current_user.username
    dose.acknowledged_at = _utcnow()
    if body.notes:
        dose.notes = body.notes
    await db.commit()

    return {
        "success": True,
        "message": "Reminder acknowledged. This does not record administration.",
        "acknowledged_by": dose.acknowledged_by,
    }


@router.get("/history/{card_id}")
async def get_medication_history(
    card_id: str,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_nurse_or_admin),
):
    """Administration history for a patient."""
    if not await _patient_in_nurse_scope(db, card_id, current_user):
        raise HTTPException(
            status_code=403, detail="Access denied: patient is not in your scope."
        )

    sched_result = await db.execute(
        select(MedicationSchedule)
        .where(MedicationSchedule.card_id == card_id)
        .order_by(MedicationSchedule.created_at.desc())
    )
    schedules = sched_result.scalars().all()

    history = []
    for schedule in schedules:
        dose_result = await db.execute(
            select(DoseRecord)
            .where(DoseRecord.schedule_id == schedule.id)
            .order_by(DoseRecord.scheduled_datetime.desc())
            .limit(limit)
        )
        for dose in dose_result.scalars().all():
            history.append(
                {
                    "schedule_id": schedule.id,
                    "dose_id": dose.id,
                    "medication_name": schedule.medication_name,
                    "dose": schedule.dose,
                    "route": schedule.route,
                    "scheduled_datetime": dose.scheduled_datetime.isoformat(),
                    "status": dose.status,
                    "administered_by": dose.administered_by,
                    "administered_at": (
                        dose.administered_at.isoformat()
                        if dose.administered_at
                        else None
                    ),
                    "reason": dose.reason,
                    "acknowledged_by": dose.acknowledged_by,
                    "acknowledged_at": (
                        dose.acknowledged_at.isoformat()
                        if dose.acknowledged_at
                        else None
                    ),
                }
            )

    history.sort(key=lambda x: x["scheduled_datetime"], reverse=True)
    return history[:limit]
