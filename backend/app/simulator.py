"""
Hardware Simulator
==================
Generates realistic IV drip telemetry for 4 mock rooms when no physical
ESP32 hardware is connected. Runs as a FastAPI background task.

Simulation model:
  - Each bag starts at a random fill level and drains at the prescribed rate.
  - One room randomly enters a "no-flow" fault state every ~5 minutes.
  - Weight is modelled as: weight(t) = initial_weight - drain_rate * elapsed_minutes
"""

from __future__ import annotations

import asyncio
import logging
import random
import time
from typing import Dict, Any

from app.config import settings

logger = logging.getLogger(__name__)

# ── Mock IV beds ───────────────────────────────────────────────────────────────

MOCK_BEDS: list[Dict[str, Any]] = [
    {
        "sensor_id": "SENS-101",
        "iv_id": "IV-SIM-001",
        "patient_id": "PAT-SIM-001",
        "patient_name": "Abebe Girma",
        "room_bed": "2A-01",
        "fluid_name": "NS 0.9%",
        "bag_size_ml": 1000.0,
        "prescribed_rate_gtt_min": 30.0,
        "initial_weight": 920.0,
        "drip_factor": 20.0,
    },
    {
        "sensor_id": "SENS-102",
        "iv_id": "IV-SIM-002",
        "patient_id": "PAT-SIM-002",
        "patient_name": "Tigist Bekele",
        "room_bed": "2A-02",
        "fluid_name": "D5W",
        "bag_size_ml": 500.0,
        "prescribed_rate_gtt_min": 20.0,
        "initial_weight": 120.0,   # nearly empty — triggers low-volume alert
        "drip_factor": 20.0,
    },
    {
        "sensor_id": "SENS-103",
        "iv_id": "IV-SIM-003",
        "patient_id": "PAT-SIM-003",
        "patient_name": "Dawit Haile",
        "room_bed": "2B-01",
        "fluid_name": "Lactated Ringer",
        "bag_size_ml": 1000.0,
        "prescribed_rate_gtt_min": 40.0,
        "initial_weight": 550.0,
        "drip_factor": 20.0,
    },
    {
        "sensor_id": "SENS-104",
        "iv_id": "IV-SIM-004",
        "patient_id": "PAT-SIM-004",
        "patient_name": "Meron Tadesse",
        "room_bed": "2B-02",
        "fluid_name": "NS 0.9%",
        "bag_size_ml": 500.0,
        "prescribed_rate_gtt_min": 25.0,
        "initial_weight": 380.0,
        "drip_factor": 20.0,
    },
]

# Per-sensor mutable sim state
_sim_state: Dict[str, Dict[str, Any]] = {}


def _init_sim_state() -> None:
    for bed in MOCK_BEDS:
        sid = bed["sensor_id"]
        _sim_state[sid] = {
            "weight": bed["initial_weight"],
            "cumulative_drips": 0,
            "fault_mode": None,          # None | "no_flow" | "discrepancy"
            "fault_until": 0.0,
            "next_fault_at": time.time() + random.uniform(60, 180),
            "bed": bed,
        }


async def run_simulator(ingest_callback) -> None:
    """
    Background coroutine that periodically calls `ingest_callback` with
    simulated sensor payloads. `ingest_callback` is the same function used
    by the real POST /api/telemetry endpoint.
    """
    _init_sim_state()
    logger.info("Hardware simulator started for %d mock beds.", len(MOCK_BEDS))

    while True:
        await asyncio.sleep(settings.SIMULATOR_INTERVAL_SECONDS)
        now = time.time()

        for sid, s in _sim_state.items():
            bed = s["bed"]
            rate_gtt_min: float = bed["prescribed_rate_gtt_min"]
            drain_ml_per_sec = (rate_gtt_min / bed["drip_factor"]) / 60.0

            # ── Fault injection ──────────────────────────────────────────────
            if now >= s["next_fault_at"] and s["fault_mode"] is None:
                fault = random.choice(["no_flow", None, None])  # 1/3 chance
                if fault:
                    duration = random.uniform(20, 45)
                    s["fault_mode"] = fault
                    s["fault_until"] = now + duration
                    logger.debug("Fault '%s' injected for %s for %.0fs", fault, sid, duration)
                s["next_fault_at"] = now + random.uniform(90, 300)

            if s["fault_mode"] and now > s["fault_until"]:
                s["fault_mode"] = None
                logger.debug("Fault cleared for %s", sid)

            # ── Weight decay ─────────────────────────────────────────────────
            if s["fault_mode"] != "no_flow":
                s["weight"] = max(
                    20.0,  # empty-bag tare
                    s["weight"] - drain_ml_per_sec * settings.SIMULATOR_INTERVAL_SECONDS
                    + random.gauss(0, 0.5),  # sensor noise
                )

            # ── Drip count accumulation ───────────────────────────────────────
            if s["fault_mode"] is None:
                drops_this_tick = (
                    rate_gtt_min / 60.0
                ) * settings.SIMULATOR_INTERVAL_SECONDS + random.gauss(0, 0.3)
                s["cumulative_drips"] += max(0, int(drops_this_tick))

            # ── Discrepancy: weight drops but 0 drips ─────────────────────────
            if s["fault_mode"] == "discrepancy":
                # weight draining already happened above; just skip drip increment
                pass  # cumulative_drips stays static

            payload = {
                "sensorId": sid,
                "weightGrams": round(s["weight"], 2),
                "rawDripCount": s["cumulative_drips"],
                "timestamp": int(now),
            }

            try:
                await ingest_callback(payload)
            except Exception as exc:
                logger.error("Simulator ingest error for %s: %s", sid, exc)
