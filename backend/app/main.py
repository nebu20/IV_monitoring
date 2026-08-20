"""
Smart IV Fluid Monitoring System — FastAPI Application
=======================================================
Entry point: uvicorn app.main:app --reload
"""

from __future__ import annotations

import asyncio
import logging
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import create_tables
from app.routers import telemetry, iv_management, websocket as ws_router
from app.simulator import MOCK_BEDS, run_simulator

# ── Logging ────────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s: %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger(__name__)

# Flag: True when PostgreSQL is reachable
_db_available = False


# ── Lifespan ───────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown logic. Never raises — DB absence is non-fatal."""
    global _db_available
    logger.info("Starting Smart IV Monitor backend…")

    # ── Try to connect to the database ────────────────────────────────────────
    try:
        await create_tables()
        _db_available = True
        logger.info("Database tables ready.")
    except Exception as exc:
        logger.warning(
            "Database unavailable (%s). Running in pure in-memory mode — "
            "telemetry will NOT be persisted.", exc
        )

    # ── Simulator startup ─────────────────────────────────────────────────────
    if settings.SIMULATOR_MODE:
        if _db_available:
            try:
                await _seed_simulator_beds()
            except Exception as exc:
                logger.warning("DB seed failed (%s) — using in-memory seed.", exc)
                _seed_in_memory()
        else:
            # No DB: seed the in-memory metadata store directly
            _seed_in_memory()

        asyncio.create_task(run_simulator(_simulator_ingest))
        logger.info(
            "Hardware simulator running (interval: %.1fs) for %d mock beds.",
            settings.SIMULATOR_INTERVAL_SECONDS,
            len(MOCK_BEDS),
        )

    yield  # ← app runs here

    logger.info("Smart IV Monitor backend shutting down.")


# ── App factory ────────────────────────────────────────────────────────────────
def create_app() -> FastAPI:
    app = FastAPI(
        title="Smart IV Fluid Monitoring System",
        description="Real-time IV bag monitoring with sensor fusion, alarms, and nurse workflows.",
        version="1.0.0",
        docs_url="/docs",
        redoc_url="/redoc",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_origin_regex=r"http://.*",   # allow all local origins during dev
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(telemetry.router)
    app.include_router(iv_management.router)
    app.include_router(ws_router.router)

    @app.get("/health", tags=["Health"])
    async def health_check():
        return {
            "status": "healthy",
            "simulator_mode": settings.SIMULATOR_MODE,
            "db_available": _db_available,
        }

    return app


app = create_app()


# ── In-memory metadata store (used when DB is offline) ────────────────────────
# Maps sensor_id → mock bed dict; the telemetry router checks this as a fallback.
_inmemory_metadata: dict[str, dict] = {}


def _seed_in_memory() -> None:
    """Populate the in-memory metadata store from the simulator mock beds."""
    for bed in MOCK_BEDS:
        _inmemory_metadata[bed["sensor_id"]] = bed
    logger.info("In-memory metadata store seeded with %d mock beds.", len(MOCK_BEDS))


def get_inmemory_metadata(sensor_id: str) -> dict | None:
    """Used by the telemetry router when the DB is unavailable."""
    return _inmemory_metadata.get(sensor_id)


# ── DB seed helper ────────────────────────────────────────────────────────────

async def _seed_simulator_beds() -> None:
    """Insert mock IV metadata rows into PostgreSQL."""
    from app.database import AsyncSessionLocal
    from app.models import IVMetadata
    from sqlalchemy import select

    async with AsyncSessionLocal() as db:
        for bed in MOCK_BEDS:
            result = await db.execute(
                select(IVMetadata).where(IVMetadata.sensor_id == bed["sensor_id"])
            )
            if result.scalars().first() is None:
                db.add(IVMetadata(
                    patient_id=bed["patient_id"],
                    patient_name=bed["patient_name"],
                    room_bed=bed["room_bed"],
                    iv_id=bed["iv_id"],
                    fluid_name=bed["fluid_name"],
                    bag_size_ml=bed["bag_size_ml"],
                    prescribed_rate_gtt_min=bed["prescribed_rate_gtt_min"],
                    sensor_id=bed["sensor_id"],
                    active=True,
                ))
        await db.commit()
        logger.info("Mock IV beds seeded into PostgreSQL.")


# ── Simulator ingest bridge ────────────────────────────────────────────────────

async def _simulator_ingest(payload: dict) -> None:
    """
    Routes simulator payloads through the real fusion engine.
    When DB is available: uses the normal DB-backed route.
    When DB is offline: resolves metadata from the in-memory store.
    """
    from app.schemas import SensorPayload
    from app.fusion_engine import process_payload
    from app.websocket_manager import manager
    from app.schemas import TelemetryState
    from datetime import datetime, timezone
    import time

    sensor_payload = SensorPayload(**payload)

    if _db_available:
        # Full DB-backed path
        from app.database import AsyncSessionLocal
        async with AsyncSessionLocal() as db:
            try:
                await telemetry.ingest_telemetry(sensor_payload, db)
            except Exception as exc:
                logger.debug("Simulator DB ingest skipped: %s", exc)
        return

    # ── In-memory path (no DB) ────────────────────────────────────────────────
    meta = get_inmemory_metadata(sensor_payload.sensorId)
    if meta is None:
        return

    fused = process_payload(
        sensor_id=sensor_payload.sensorId,
        weight_grams=sensor_payload.weightGrams,
        raw_drip_count=sensor_payload.rawDripCount,
        timestamp=float(sensor_payload.timestamp),
        bag_size_ml=meta["bag_size_ml"],
        prescribed_rate_gtt_min=meta["prescribed_rate_gtt_min"],
    )

    ts = datetime.fromtimestamp(sensor_payload.timestamp, tz=timezone.utc)

    state = TelemetryState(
        sensor_id=sensor_payload.sensorId,
        iv_id=meta["iv_id"],
        patient_name=meta["patient_name"],
        room_bed=meta["room_bed"],
        fluid_name=meta["fluid_name"],
        bag_size_ml=meta["bag_size_ml"],
        volume_ml=fused["volume_ml"],
        percentage=fused["percentage"],
        drip_rate_gtt_min=fused["drip_rate_gtt_min"],
        raw_weight_grams=sensor_payload.weightGrams,
        flow_status=fused["flow_status"],
        alarm_priority=fused["alarm_priority"],
        eta_string=fused["eta_string"],
        alarm_acknowledged=fused["alarm_acknowledged"],
        last_update=ts.isoformat(),
        prescribed_rate_gtt_min=meta["prescribed_rate_gtt_min"],
    )

    # Update the live state cache
    cache = telemetry.get_latest_state_cache()
    cache[sensor_payload.sensorId] = state.model_dump()

    # Broadcast over WebSocket
    await manager.broadcast({"type": "TELEMETRY_UPDATE", "data": state.model_dump()})
