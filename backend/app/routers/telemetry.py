"""
Telemetry Router
================
POST /api/telemetry  – ingest raw sensor payload from ESP32 (or simulator).
GET  /api/telemetry  – fetch latest state snapshot for all registered IVs.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import IVMetadata, TelemetryLog
from app.schemas import SensorPayload, TelemetryState
from app.fusion_engine import process_payload
from app.websocket_manager import manager

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/telemetry", tags=["Telemetry"])

# In-memory latest-state cache keyed by sensor_id (for low-latency GET)
_latest_state: dict[str, dict] = {}


@router.post("", status_code=status.HTTP_200_OK)
async def ingest_telemetry(
    payload: SensorPayload,
    db: AsyncSession = Depends(get_db),
):
    """
    Accept raw sensor payload, run fusion engine, persist log, broadcast WS event.
    """
    # 1. Metadata lookup
    result = await db.execute(
        select(IVMetadata).where(IVMetadata.sensor_id == payload.sensorId, IVMetadata.active == True)
    )
    meta = result.scalars().first()

    if meta is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No active IV registered for sensor {payload.sensorId}",
        )

    # 2. Run sensor fusion
    fused = process_payload(
        sensor_id=payload.sensorId,
        weight_grams=payload.weightGrams,
        raw_drip_count=payload.rawDripCount,
        timestamp=float(payload.timestamp),
        bag_size_ml=meta.bag_size_ml,
        prescribed_rate_gtt_min=meta.prescribed_rate_gtt_min,
    )

    ts = datetime.fromtimestamp(payload.timestamp, tz=timezone.utc)

    # 3. Persist to telemetry_logs
    log = TelemetryLog(
        timestamp=ts,
        sensor_id=payload.sensorId,
        raw_weight_grams=payload.weightGrams,
        raw_drip_count=payload.rawDripCount,
        volume_ml=fused["volume_ml"],
        percentage=fused["percentage"],
        drip_rate_gtt_min=fused["drip_rate_gtt_min"],
        flow_status=fused["flow_status"],
        alarm_priority=fused["alarm_priority"],
        eta_string=fused["eta_string"],
        alarm_acknowledged=fused["alarm_acknowledged"],
    )
    db.add(log)
    await db.commit()

    # 4. Build full state object
    state = TelemetryState(
        sensor_id=payload.sensorId,
        iv_id=meta.iv_id,
        patient_name=meta.patient_name,
        room_bed=meta.room_bed,
        fluid_name=meta.fluid_name,
        bag_size_ml=meta.bag_size_ml,
        volume_ml=fused["volume_ml"],
        percentage=fused["percentage"],
        drip_rate_gtt_min=fused["drip_rate_gtt_min"],
        raw_weight_grams=payload.weightGrams,
        flow_status=fused["flow_status"],
        alarm_priority=fused["alarm_priority"],
        eta_string=fused["eta_string"],
        alarm_acknowledged=fused["alarm_acknowledged"],
        last_update=ts.isoformat(),
        prescribed_rate_gtt_min=meta.prescribed_rate_gtt_min,
    )

    # 5. Cache latest state
    _latest_state[payload.sensorId] = state.model_dump()

    # 6. Broadcast over WebSocket
    ws_payload = {"type": "TELEMETRY_UPDATE", "data": state.model_dump()}
    await manager.broadcast(ws_payload)

    logger.debug("Telemetry processed: %s | %s | %s", payload.sensorId, fused["flow_status"], fused["eta_string"])
    return {"status": "ok", "flow_status": fused["flow_status"]}


@router.get("", response_model=List[TelemetryState])
async def get_all_telemetry():
    """Return the latest cached state for every registered sensor."""
    return list(_latest_state.values())


def get_latest_state_cache() -> dict[str, dict]:
    """Expose the cache for the simulator ingest path."""
    return _latest_state
