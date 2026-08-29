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
from app.routers import auth as auth_router, patients as patients_router, node as node_router
from app.routers.auth import profile_router
from app.routers.staff import router as staff_router, seed_mock_staff
from app.simulator import MOCK_BEDS, run_simulator

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s: %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger(__name__)

_db_available = False


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _db_available
    logger.info("Starting Smart IV Monitor backend…")

    try:
        await create_tables()
        _db_available = True
        logger.info("Database tables ready.")
    except Exception as exc:
        logger.warning("Database unavailable (%s). Running in-memory mode.", exc)

    if settings.SIMULATOR_MODE:
        if _db_available:
            try:
                await _seed_simulator_beds()
                await _seed_default_admin()
                await _reload_cache_from_db()
                # Seed mock HR staff records
                from app.database import AsyncSessionLocal
                async with AsyncSessionLocal() as db:
                    await seed_mock_staff(db)
            except Exception as exc:
                logger.warning("DB seed failed (%s) — using in-memory seed.", exc)
                _seed_in_memory()
        else:
            _seed_in_memory()

        asyncio.create_task(run_simulator(_simulator_ingest))
        logger.info(
            "Hardware simulator running (interval: %.1fs) for %d mock beds.",
            settings.SIMULATOR_INTERVAL_SECONDS,
            len(MOCK_BEDS),
        )

    yield

    logger.info("Smart IV Monitor backend shutting down.")


def create_app() -> FastAPI:
    app = FastAPI(
        title="Smart IV Fluid Monitoring System",
        version="1.0.0",
        docs_url="/docs",
        redoc_url="/redoc",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_origin_regex=r"http://.*",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(telemetry.router)
    app.include_router(iv_management.router)
    app.include_router(ws_router.router)
    app.include_router(auth_router.router)
    app.include_router(profile_router)
    app.include_router(patients_router.router)
    app.include_router(node_router.router)
    app.include_router(staff_router)

    @app.get("/health", tags=["Health"])
    async def health_check():
        return {"status": "healthy", "simulator_mode": settings.SIMULATOR_MODE, "db_available": _db_available}

    return app


app = create_app()

# ── In-memory metadata store ──────────────────────────────────────────────────

_inmemory_metadata: dict[str, dict] = {}


def _seed_in_memory() -> None:
    for bed in MOCK_BEDS:
        _inmemory_metadata[bed["sensor_id"]] = bed
    logger.info("In-memory metadata store seeded with %d mock beds.", len(MOCK_BEDS))


def get_inmemory_metadata(sensor_id: str) -> dict | None:
    return _inmemory_metadata.get(sensor_id)


# ── DB helpers ────────────────────────────────────────────────────────────────

async def _seed_default_admin() -> None:
    """Create the single Superadmin account on first run if none exists."""
    from app.database import AsyncSessionLocal
    from app.models import User
    from app.auth import hash_password
    from sqlalchemy import select

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.role == "Superadmin"))
        if result.scalars().first() is None:
            db.add(User(
                username="admin",
                password_hash=hash_password(settings.SUPERADMIN_PASSWORD),
                role="Superadmin",
                full_name="System Superadmin",
                staff_id="SYS-ROOT-001",
                license_id=None,
                assigned_ward=None,
                assigned_beds=[],
                active=True,
            ))
            await db.commit()
            logger.info("Superadmin account created — username: admin")
            logger.warning("CHANGE THE DEFAULT SUPERADMIN PASSWORD IN PRODUCTION!")


async def _seed_simulator_beds() -> None:
    """Insert mock IV metadata rows into PostgreSQL if they don't exist."""
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


async def _reload_cache_from_db() -> None:
    """
    On startup, reload the latest telemetry for every registered sensor
    into the in-memory cache. Ensures manually registered sensors
    (e.g. Sara Alemu) survive backend restarts.
    """
    from app.database import AsyncSessionLocal
    from app.models import IVMetadata, TelemetryLog
    from app.routers.telemetry import get_latest_state_cache
    from app.schemas import TelemetryState
    from sqlalchemy import select, desc

    cache = get_latest_state_cache()
    simulator_sensor_ids = {b["sensor_id"] for b in MOCK_BEDS}

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(IVMetadata).where(IVMetadata.active == True))
        all_meta = result.scalars().all()

        reloaded = 0
        for meta in all_meta:
            if meta.sensor_id in simulator_sensor_ids:
                continue  # simulator will populate these shortly

            log_result = await db.execute(
                select(TelemetryLog)
                .where(TelemetryLog.sensor_id == meta.sensor_id)
                .order_by(desc(TelemetryLog.timestamp))
                .limit(1)
            )
            log = log_result.scalars().first()
            if log is None:
                continue

            state = TelemetryState(
                sensor_id=meta.sensor_id,
                iv_id=meta.iv_id,
                patient_name=meta.patient_name,
                room_bed=meta.room_bed,
                fluid_name=meta.fluid_name,
                bag_size_ml=meta.bag_size_ml,
                volume_ml=log.volume_ml,
                percentage=log.percentage,
                drip_rate_gtt_min=log.drip_rate_gtt_min,
                raw_weight_grams=log.raw_weight_grams,
                flow_status=log.flow_status,
                alarm_priority=log.alarm_priority,
                eta_string=log.eta_string or "ETA Unavailable",
                alarm_acknowledged=log.alarm_acknowledged,
                last_update=log.timestamp.isoformat(),
                prescribed_rate_gtt_min=meta.prescribed_rate_gtt_min,
            )
            cache[meta.sensor_id] = state.model_dump()
            reloaded += 1

        if reloaded:
            logger.info("Reloaded %d non-simulator sensor(s) from DB into cache.", reloaded)


# ── Simulator ingest bridge ────────────────────────────────────────────────────

async def _simulator_ingest(payload: dict) -> None:
    from app.schemas import SensorPayload, TelemetryState
    from app.fusion_engine import process_payload
    from app.websocket_manager import manager
    from app.models import IVMetadata, TelemetryLog
    from app.routers.telemetry import get_latest_state_cache
    from datetime import datetime, timezone
    from sqlalchemy import select

    sensor_payload = SensorPayload(**payload)
    ts = datetime.fromtimestamp(float(sensor_payload.timestamp), tz=timezone.utc).replace(tzinfo=None)

    meta_dict = None

    if _db_available:
        from app.database import AsyncSessionLocal
        try:
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    select(IVMetadata).where(
                        IVMetadata.sensor_id == sensor_payload.sensorId,
                        IVMetadata.active == True,
                    )
                )
                meta_obj = result.scalars().first()
                if meta_obj:
                    meta_dict = {
                        "iv_id": meta_obj.iv_id,
                        "patient_name": meta_obj.patient_name,
                        "room_bed": meta_obj.room_bed,
                        "fluid_name": meta_obj.fluid_name,
                        "bag_size_ml": meta_obj.bag_size_ml,
                        "prescribed_rate_gtt_min": meta_obj.prescribed_rate_gtt_min,
                    }
        except Exception as exc:
            logger.debug("DB metadata lookup failed: %s", exc)

    if meta_dict is None:
        mem = get_inmemory_metadata(sensor_payload.sensorId)
        if mem is None:
            return
        meta_dict = {
            "iv_id": mem["iv_id"],
            "patient_name": mem["patient_name"],
            "room_bed": mem["room_bed"],
            "fluid_name": mem["fluid_name"],
            "bag_size_ml": mem["bag_size_ml"],
            "prescribed_rate_gtt_min": mem["prescribed_rate_gtt_min"],
        }

    fused = process_payload(
        sensor_id=sensor_payload.sensorId,
        weight_grams=sensor_payload.weightGrams,
        raw_drip_count=sensor_payload.rawDripCount,
        timestamp=float(sensor_payload.timestamp),
        bag_size_ml=meta_dict["bag_size_ml"],
        prescribed_rate_gtt_min=meta_dict["prescribed_rate_gtt_min"],
    )

    state = TelemetryState(
        sensor_id=sensor_payload.sensorId,
        iv_id=meta_dict["iv_id"],
        patient_name=meta_dict["patient_name"],
        room_bed=meta_dict["room_bed"],
        fluid_name=meta_dict["fluid_name"],
        bag_size_ml=meta_dict["bag_size_ml"],
        volume_ml=fused["volume_ml"],
        percentage=fused["percentage"],
        drip_rate_gtt_min=fused["drip_rate_gtt_min"],
        raw_weight_grams=sensor_payload.weightGrams,
        flow_status=fused["flow_status"],
        alarm_priority=fused["alarm_priority"],
        eta_string=fused["eta_string"],
        alarm_acknowledged=fused["alarm_acknowledged"],
        last_update=ts.isoformat(),
        prescribed_rate_gtt_min=meta_dict["prescribed_rate_gtt_min"],
    )

    state_dict = state.model_dump()

    cache = get_latest_state_cache()
    cache[sensor_payload.sensorId] = state_dict

    if _db_available:
        from app.database import AsyncSessionLocal
        try:
            async with AsyncSessionLocal() as db:
                db.add(TelemetryLog(
                    timestamp=ts,
                    sensor_id=sensor_payload.sensorId,
                    raw_weight_grams=sensor_payload.weightGrams,
                    raw_drip_count=sensor_payload.rawDripCount,
                    volume_ml=fused["volume_ml"],
                    percentage=fused["percentage"],
                    drip_rate_gtt_min=fused["drip_rate_gtt_min"],
                    flow_status=fused["flow_status"],
                    alarm_priority=fused["alarm_priority"],
                    eta_string=fused["eta_string"],
                    alarm_acknowledged=fused["alarm_acknowledged"],
                ))
                await db.commit()
        except Exception as exc:
            logger.debug("Telemetry DB persist failed: %s", exc)

    await manager.broadcast({"type": "TELEMETRY_UPDATE", "data": state_dict})
