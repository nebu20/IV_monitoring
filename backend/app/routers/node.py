"""
ESP32 Node Router
=================
POST /api/node/telemetry      — receive direct payload from ESP32
GET  /api/node/config/:bedId  — ESP32 fetches active thresholds
GET  /api/beds/live-status    — role-filtered live status (Admin=all, Nurse=assigned)
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import IVMetadata, TelemetryLog, User
from app.auth import get_current_user
from app.fusion_engine import process_payload
from app.websocket_manager import manager
from app.routers.telemetry import get_latest_state_cache
from app.schemas import TelemetryState

logger = logging.getLogger(__name__)
router = APIRouter(tags=["ESP32 Node"])

BATTERY_LOW_THRESHOLD = 15  # % — trigger warning below this


class NodeTelemetryPayload(BaseModel):
    """Direct ESP32 JSON payload schema."""
    bedId: str = Field(..., example="Bed-01")
    cardId: str = Field(..., example="MRN-10042")
    dropRate: float = Field(..., ge=0, example=25.0)       # drops/min
    weight: float = Field(..., ge=0, example=380.0)        # grams
    batteryLevel: int = Field(..., ge=0, le=100, example=87)
    powerSource: str = Field(..., example="AC_GRID")       # "AC_GRID" | "BATTERY"
    status: str = Field(default="OK", example="OK")        # "OK" | "ERROR" | "CALIBRATING"


class NodeConfig(BaseModel):
    bedId: str
    target_drop_rate: float
    min_drop_rate: float
    max_drop_rate: float
    alert_volume_threshold_ml: float


@router.post("/api/node/telemetry", status_code=200)
async def node_telemetry(
    payload: NodeTelemetryPayload,
    db: AsyncSession = Depends(get_db),
):
    """
    Receive telemetry from ESP32. Maps bedId → sensor registration,
    runs fusion engine, and broadcasts alerts for power/battery warnings.
    """
    # Lookup IV registration by room_bed matching bedId
    result = await db.execute(
        select(IVMetadata).where(
            IVMetadata.room_bed == payload.bedId,
            IVMetadata.active == True,
        )
    )
    meta = result.scalars().first()

    if meta is None:
        raise HTTPException(
            status_code=404,
            detail=f"No active IV registered for bed '{payload.bedId}'. Register first.",
        )

    ts = datetime.utcnow()

    # Run fusion engine
    fused = process_payload(
        sensor_id=meta.sensor_id,
        weight_grams=payload.weight,
        raw_drip_count=int(payload.dropRate * 3),  # approximate count from rate
        timestamp=ts.timestamp(),
        bag_size_ml=meta.bag_size_ml,
        prescribed_rate_gtt_min=meta.prescribed_rate_gtt_min,
    )

    # Build power/battery alerts
    alerts = []
    if payload.powerSource == "BATTERY":
        alerts.append({"type": "POWER_SOURCE", "message": "Device running on battery power", "severity": "WARNING"})
    if payload.batteryLevel < BATTERY_LOW_THRESHOLD:
        alerts.append({"type": "LOW_BATTERY", "message": f"Battery critically low: {payload.batteryLevel}%", "severity": "CRITICAL"})
    if payload.status != "OK":
        alerts.append({"type": "NODE_ERROR", "message": f"ESP32 node status: {payload.status}", "severity": "HIGH"})

    # Persist log
    try:
        log = TelemetryLog(
            timestamp=ts,
            sensor_id=meta.sensor_id,
            raw_weight_grams=payload.weight,
            raw_drip_count=int(payload.dropRate * 3),
            volume_ml=fused["volume_ml"],
            percentage=fused["percentage"],
            drip_rate_gtt_min=payload.dropRate,
            flow_status=fused["flow_status"],
            alarm_priority=fused["alarm_priority"],
            eta_string=fused["eta_string"],
            alarm_acknowledged=fused["alarm_acknowledged"],
            battery_level=payload.batteryLevel,
            power_source=payload.powerSource,
            node_status=payload.status,
        )
        db.add(log)
        await db.commit()
    except Exception as exc:
        logger.debug("Node telemetry DB persist failed: %s", exc)

    # Build state and update cache
    state = TelemetryState(
        sensor_id=meta.sensor_id,
        iv_id=meta.iv_id,
        patient_name=meta.patient_name,
        room_bed=meta.room_bed,
        fluid_name=meta.fluid_name,
        bag_size_ml=meta.bag_size_ml,
        volume_ml=fused["volume_ml"],
        percentage=fused["percentage"],
        drip_rate_gtt_min=payload.dropRate,
        raw_weight_grams=payload.weight,
        flow_status=fused["flow_status"],
        alarm_priority=fused["alarm_priority"],
        eta_string=fused["eta_string"],
        alarm_acknowledged=fused["alarm_acknowledged"],
        last_update=ts.isoformat(),
        prescribed_rate_gtt_min=meta.prescribed_rate_gtt_min,
    )

    state_dict = state.model_dump()
    state_dict["battery_level"] = payload.batteryLevel
    state_dict["power_source"] = payload.powerSource
    state_dict["node_status"] = payload.status
    state_dict["alerts"] = alerts

    cache = get_latest_state_cache()
    cache[meta.sensor_id] = state_dict

    await manager.broadcast({"type": "TELEMETRY_UPDATE", "data": state_dict})

    if alerts:
        await manager.broadcast({"type": "NODE_ALERTS", "bedId": payload.bedId, "alerts": alerts})

    return {"status": "ok", "flow_status": fused["flow_status"], "alerts": alerts}


@router.get("/api/node/config/{bed_id}")
async def get_node_config(bed_id: str, db: AsyncSession = Depends(get_db)):
    """
    ESP32 fetches configuration — target drop rate and alert thresholds.
    Called by the hardware on startup and periodically to sync nurse-set parameters.
    """
    result = await db.execute(
        select(IVMetadata).where(IVMetadata.room_bed == bed_id, IVMetadata.active == True)
    )
    meta = result.scalars().first()
    if not meta:
        raise HTTPException(status_code=404, detail=f"No config found for bed '{bed_id}'")

    rate = meta.prescribed_rate_gtt_min
    return NodeConfig(
        bedId=bed_id,
        target_drop_rate=rate,
        min_drop_rate=rate * 0.85,  # ±15% tolerance
        max_drop_rate=rate * 1.15,
        alert_volume_threshold_ml=50.0,  # alert when < 50mL
    )


@router.get("/api/beds/live-status")
async def get_live_status(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Role-filtered live status:
    - Admin: returns ALL beds
    - Nurse: returns only assigned beds
    """
    cache = get_latest_state_cache()
    all_states = list(cache.values())

    if current_user.role == "Admin":
        return all_states

    # Nurse: filter to assigned beds only
    assigned = set(current_user.assigned_beds or [])
    return [s for s in all_states if s.get("room_bed") in assigned]
