"""
IV Management Router
====================
POST /api/iv/register    – pair a sensor with a patient / IV bag.
POST /api/iv/acknowledge – nurse acknowledges an active alarm.
POST /api/iv/new-bag     – confirm bag replacement and reset volume state.
GET  /api/iv/list        – list all registered IV lines.
GET  /api/iv/history/{iv_id} – telemetry logs + event timeline.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import IVMetadata, IVEvent
from app.schemas import (
    IVRegisterRequest,
    IVRegisterResponse,
    AcknowledgeRequest,
    AcknowledgeResponse,
    NewBagRequest,
    NewBagResponse,
)
from app.fusion_engine import acknowledge_alarm, reset_sensor_state
from app.websocket_manager import manager

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/iv", tags=["IV Management"])


@router.post("/register", response_model=IVRegisterResponse, status_code=status.HTTP_201_CREATED)
async def register_iv(
    body: IVRegisterRequest,
    db: AsyncSession = Depends(get_db),
):
    existing = await db.execute(
        select(IVMetadata).where(IVMetadata.sensor_id == body.sensor_id, IVMetadata.active == True)
    )
    old = existing.scalars().first()
    if old:
        old.active = False

    new_meta = IVMetadata(
        patient_id=body.patient_id,
        patient_name=body.patient_name,
        room_bed=body.room_bed,
        iv_id=body.iv_id,
        fluid_name=body.fluid_name,
        bag_size_ml=body.bag_size_ml,
        prescribed_rate_gtt_min=body.prescribed_rate_gtt_min,
        sensor_id=body.sensor_id,
        active=True,
    )
    db.add(new_meta)

    event = IVEvent(
        event_type="REGISTERED",
        iv_id=body.iv_id,
        nurse_notes=f"Sensor {body.sensor_id} assigned to {body.patient_name}",
    )
    db.add(event)
    await db.commit()

    reset_sensor_state(body.sensor_id)

    await manager.broadcast({
        "type": "IV_REGISTERED",
        "data": {"iv_id": body.iv_id, "sensor_id": body.sensor_id, "patient_name": body.patient_name},
    })

    return IVRegisterResponse(
        success=True,
        message=f"IV {body.iv_id} registered and sensor {body.sensor_id} bound.",
        iv_id=body.iv_id,
    )


@router.post("/acknowledge", response_model=AcknowledgeResponse)
async def acknowledge_alarm_endpoint(
    body: AcknowledgeRequest,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(IVMetadata).where(IVMetadata.iv_id == body.iv_id, IVMetadata.active == True)
    )
    meta = result.scalars().first()
    if meta is None:
        raise HTTPException(status_code=404, detail=f"IV {body.iv_id} not found")

    acknowledge_alarm(meta.sensor_id)

    event = IVEvent(event_type="ALERT_ACKNOWLEDGED", iv_id=body.iv_id, nurse_notes=body.nurse_notes)
    db.add(event)
    await db.commit()

    await manager.broadcast({
        "type": "ALARM_ACKNOWLEDGED",
        "data": {"iv_id": body.iv_id, "sensor_id": meta.sensor_id},
    })

    return AcknowledgeResponse(success=True, message="Alarm acknowledged.")


@router.post("/new-bag", response_model=NewBagResponse)
async def confirm_new_bag(
    body: NewBagRequest,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(IVMetadata).where(IVMetadata.iv_id == body.iv_id, IVMetadata.active == True)
    )
    meta = result.scalars().first()
    if meta is None:
        raise HTTPException(status_code=404, detail=f"IV {body.iv_id} not found")

    meta.bag_size_ml = body.new_bag_size_ml
    meta.updated_at = datetime.now(tz=timezone.utc)

    event = IVEvent(
        event_type="BAG_REPLACEMENT",
        iv_id=body.iv_id,
        nurse_notes=body.nurse_notes or f"New {body.new_bag_size_ml}mL bag confirmed.",
    )
    db.add(event)
    await db.commit()

    reset_sensor_state(meta.sensor_id)

    await manager.broadcast({
        "type": "BAG_REPLACED",
        "data": {"iv_id": body.iv_id, "new_bag_size_ml": body.new_bag_size_ml},
    })

    return NewBagResponse(success=True, message=f"New {body.new_bag_size_ml} mL bag confirmed.")


@router.get("/list")
async def list_iv_lines(db: AsyncSession = Depends(get_db)):
    """Return all active IV registrations — falls back to in-memory if DB offline."""
    try:
        result = await db.execute(select(IVMetadata).where(IVMetadata.active == True))
        items = result.scalars().all()
        return [
            {
                "iv_id": m.iv_id,
                "patient_name": m.patient_name,
                "room_bed": m.room_bed,
                "sensor_id": m.sensor_id,
                "fluid_name": m.fluid_name,
                "bag_size_ml": m.bag_size_ml,
                "prescribed_rate_gtt_min": m.prescribed_rate_gtt_min,
            }
            for m in items
        ]
    except Exception:
        # DB offline — return in-memory simulator beds
        from app.main import get_inmemory_metadata
        from app.simulator import MOCK_BEDS
        return [
            {
                "iv_id": b["iv_id"],
                "patient_name": b["patient_name"],
                "room_bed": b["room_bed"],
                "sensor_id": b["sensor_id"],
                "fluid_name": b["fluid_name"],
                "bag_size_ml": b["bag_size_ml"],
                "prescribed_rate_gtt_min": b["prescribed_rate_gtt_min"],
            }
            for b in MOCK_BEDS
        ]


@router.get("/history/{iv_id}")
async def get_iv_history(iv_id: str, limit: int = 50, db: AsyncSession = Depends(get_db)):
    """
    Return recent telemetry logs and events for a specific IV line.
    When PostgreSQL is unavailable, returns live state from the in-memory cache.
    """
    from app.routers.telemetry import get_latest_state_cache
    from app.simulator import MOCK_BEDS

    # ── Try DB path first ──────────────────────────────────────────────────────
    try:
        from app.models import TelemetryLog
        from sqlalchemy import desc

        result_meta = await db.execute(select(IVMetadata).where(IVMetadata.iv_id == iv_id))
        meta = result_meta.scalars().first()

        if meta:
            result_logs = await db.execute(
                select(TelemetryLog)
                .where(TelemetryLog.sensor_id == meta.sensor_id)
                .order_by(desc(TelemetryLog.timestamp))
                .limit(limit)
            )
            logs = result_logs.scalars().all()

            result_events = await db.execute(
                select(IVEvent)
                .where(IVEvent.iv_id == iv_id)
                .order_by(desc(IVEvent.timestamp))
                .limit(20)
            )
            events = result_events.scalars().all()

            return {
                "metadata": {
                    "iv_id": meta.iv_id,
                    "patient_name": meta.patient_name,
                    "room_bed": meta.room_bed,
                    "fluid_name": meta.fluid_name,
                    "bag_size_ml": meta.bag_size_ml,
                    "prescribed_rate_gtt_min": meta.prescribed_rate_gtt_min,
                    "sensor_id": meta.sensor_id,
                },
                "telemetry_logs": [
                    {
                        "timestamp": l.timestamp.isoformat(),
                        "volume_ml": l.volume_ml,
                        "percentage": l.percentage,
                        "drip_rate_gtt_min": l.drip_rate_gtt_min,
                        "flow_status": l.flow_status,
                        "alarm_priority": l.alarm_priority,
                        "eta_string": l.eta_string,
                        "raw_weight_grams": l.raw_weight_grams,
                    }
                    for l in logs
                ],
                "events": [
                    {
                        "event_type": e.event_type,
                        "timestamp": e.timestamp.isoformat(),
                        "nurse_notes": e.nurse_notes,
                    }
                    for e in events
                ],
            }
    except Exception as exc:
        logger.debug("DB history query failed (%s) — falling back to in-memory cache.", exc)

    # ── In-memory fallback (simulator / no DB) ─────────────────────────────────
    cache = get_latest_state_cache()

    # Find the live state entry matching this iv_id
    live = next((s for s in cache.values() if s.get("iv_id") == iv_id), None)

    # Find matching mock bed metadata
    bed = next((b for b in MOCK_BEDS if b["iv_id"] == iv_id), None)

    if live is None and bed is None:
        raise HTTPException(status_code=404, detail=f"IV '{iv_id}' not found.")

    # Use live state for metadata if available, otherwise fall back to bed config
    source = live or {}
    meta_out = {
        "iv_id": iv_id,
        "patient_name": source.get("patient_name") or (bed or {}).get("patient_name", "—"),
        "room_bed": source.get("room_bed") or (bed or {}).get("room_bed", "—"),
        "fluid_name": source.get("fluid_name") or (bed or {}).get("fluid_name", "—"),
        "bag_size_ml": source.get("bag_size_ml") or (bed or {}).get("bag_size_ml", 0),
        "prescribed_rate_gtt_min": source.get("prescribed_rate_gtt_min") or (bed or {}).get("prescribed_rate_gtt_min", 0),
        "sensor_id": source.get("sensor_id") or (bed or {}).get("sensor_id", "—"),
    }

    # Build a synthetic single-entry log from the current live state
    telemetry_logs = []
    if live:
        telemetry_logs = [{
            "timestamp": live.get("last_update", datetime.now(tz=timezone.utc).isoformat()),
            "volume_ml": live.get("volume_ml", 0),
            "percentage": live.get("percentage", 0),
            "drip_rate_gtt_min": live.get("drip_rate_gtt_min", 0),
            "flow_status": live.get("flow_status", "NORMAL"),
            "alarm_priority": live.get("alarm_priority", "NORMAL"),
            "eta_string": live.get("eta_string", "—"),
            "raw_weight_grams": live.get("raw_weight_grams", 0),
        }]

    return {
        "metadata": meta_out,
        "telemetry_logs": telemetry_logs,
        "events": [
            {
                "event_type": "REGISTERED",
                "timestamp": datetime.now(tz=timezone.utc).isoformat(),
                "nurse_notes": "Simulator mode — running without PostgreSQL",
            }
        ],
    }
