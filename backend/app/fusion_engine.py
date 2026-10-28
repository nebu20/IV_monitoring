"""
Sensor Fusion Engine
====================
Processes raw Load-Cell + IR-Drip sensor readings into a unified clinical
state with alarm classification and ETA calculation.

All per-sensor state is held in the in-process SensorStateStore so the engine
is stateless and purely functional from the caller's perspective.
"""

from __future__ import annotations

import time
from collections import deque
from dataclasses import dataclass, field
from typing import Deque, Dict, Optional

from app.config import settings

# ── Constants ──────────────────────────────────────────────────────────────────

DRIP_MOVING_AVG_WINDOW = 8          # samples for smoothed drip-rate filter
ANOMALY_PERSIST_SECS = 3.0          # abnormal state must persist before alarm escalation
DROP_FACTOR_GTT_PER_ML = 20.0       # standard IV set: 20 gtt / mL
EMPTY_BAG_THRESHOLD_GRAMS = 20.0    # tare weight of empty bag
ZERO_FLOW_TIMEOUT_SECS = 15.0       # seconds of zero drops before "No Flow" alarm
RAPID_DRAIN_RATE = 5.0              # mL/min above which drain is "rapid"
DEVIATION_THRESHOLD_PERCENT = settings.DEVIATION_THRESHOLD_PERCENT  # ±25% default


# ── Flow / Alarm Status Enumerations ──────────────────────────────────────────

class FlowStatus:
    NORMAL = "NORMAL"
    ADVISORY = "ADVISORY"
    CRITICAL = "CRITICAL"
    HIGH_PRIORITY = "HIGH_PRIORITY"
    ANOMALY = "ANOMALY"


class AlarmPriority:
    NORMAL = "NORMAL"
    LOW = "LOW"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


# ── Per-sensor sliding state ───────────────────────────────────────────────────

@dataclass
class SensorState:
    """Mutable sliding-window state maintained per sensor ID."""
    # Moving-average buffer: each entry is (drip_count_delta, elapsed_secs)
    drip_rate_buffer: Deque[float] = field(default_factory=lambda: deque(maxlen=DRIP_MOVING_AVG_WINDOW))

    # Raw drip count from previous sample (to compute delta)
    prev_drip_count: Optional[int] = None
    prev_timestamp: Optional[float] = None

    # Tracking zero-flow window
    zero_flow_since: Optional[float] = None   # epoch when drops went to 0
    last_drop_seen: Optional[float] = None    # epoch of last non-zero drop

    # Persistence filter: (status, first_seen_epoch)
    pending_alarm_status: Optional[str] = None
    pending_alarm_since: Optional[float] = None

    # Last confirmed (escalated) alarm status
    confirmed_alarm_status: str = FlowStatus.NORMAL

    # Volume tracking for rapid-drain detection
    prev_volume_ml: Optional[float] = None
    prev_volume_ts: Optional[float] = None

    # Alarm acknowledgement (reset on new alarm escalation)
    alarm_acknowledged: bool = False


# Global in-process store (reset on restart; backed by DB for persistence)
_state_store: Dict[str, SensorState] = {}


def get_or_create_state(sensor_id: str) -> SensorState:
    if sensor_id not in _state_store:
        _state_store[sensor_id] = SensorState()
    return _state_store[sensor_id]


def reset_sensor_state(sensor_id: str) -> None:
    """Called when a new bag is confirmed; resets volume and flow tracking."""
    _state_store[sensor_id] = SensorState()


# ── Core Fusion Function ───────────────────────────────────────────────────────

def process_payload(
    sensor_id: str,
    weight_grams: float,
    raw_drip_count: int,
    timestamp: float,          # Unix epoch float
    bag_size_ml: float,
    prescribed_rate_gtt_min: float,
) -> dict:
    """
    Fuse weight + drip sensor readings into a clinical state snapshot.

    Returns a dict matching the fields of TelemetryState (minus DB/patient
    metadata fields that the caller must inject).
    """
    state = get_or_create_state(sensor_id)
    now = timestamp  # use sensor timestamp; fall back to wall-clock if needed

    # ── 1. Volume Calculation ─────────────────────────────────────────────────
    # Subtract estimated tare weight of empty bag
    net_weight = max(weight_grams - EMPTY_BAG_THRESHOLD_GRAMS, 0.0)
    volume_ml = net_weight                  # 1 g ≈ 1 mL for aqueous IV fluids
    percentage = min(100.0, (volume_ml / bag_size_ml) * 100.0) if bag_size_ml > 0 else 0.0

    # ── 2. Smoothed Drip Rate (gtt/min) ──────────────────────────────────────
    drip_rate_gtt_min = _compute_smoothed_drip_rate(state, raw_drip_count, now)

    # ── 3. Rapid-Drain Detection ──────────────────────────────────────────────
    drain_rate_ml_per_min = _compute_drain_rate(state, volume_ml, now)

    # ── 4. Sensor Fusion & Status Classification ──────────────────────────────
    raw_status = _classify_status(
        weight_grams=weight_grams,
        volume_ml=volume_ml,
        drip_rate_gtt_min=drip_rate_gtt_min,
        drain_rate_ml_per_min=drain_rate_ml_per_min,
        prescribed_rate_gtt_min=prescribed_rate_gtt_min,
        state=state,
        now=now,
    )

    # ── 5. Persistence Filter (>3s before escalation) ─────────────────────────
    flow_status, alarm_priority = _apply_persistence_filter(state, raw_status, now)

    # ── 6. ETA Calculation ────────────────────────────────────────────────────
    eta_string = _calculate_eta(
        volume_ml=volume_ml,
        drip_rate_gtt_min=drip_rate_gtt_min,
        flow_status=flow_status,
    )

    # ── 7. Update volume history ──────────────────────────────────────────────
    state.prev_volume_ml = volume_ml
    state.prev_volume_ts = now

    return {
        "sensor_id": sensor_id,
        "raw_weight_grams": weight_grams,
        "volume_ml": round(volume_ml, 1),
        "percentage": round(percentage, 1),
        "drip_rate_gtt_min": round(drip_rate_gtt_min, 1),
        "flow_status": flow_status,
        "alarm_priority": alarm_priority,
        "eta_string": eta_string,
        "alarm_acknowledged": state.alarm_acknowledged,
    }


# ── Helpers ────────────────────────────────────────────────────────────────────

def _compute_smoothed_drip_rate(
    state: SensorState, raw_drip_count: int, now: float
) -> float:
    """
    Compute instantaneous gtt/min from cumulative drip counter delta,
    then smooth with an 8-sample moving average.
    """
    if state.prev_drip_count is None or state.prev_timestamp is None:
        state.prev_drip_count = raw_drip_count
        state.prev_timestamp = now
        return 0.0

    elapsed = now - state.prev_timestamp
    if elapsed <= 0:
        elapsed = 1.0   # guard against zero division

    drip_delta = max(raw_drip_count - state.prev_drip_count, 0)
    instant_rate = (drip_delta / elapsed) * 60.0   # convert /sec → /min

    state.drip_rate_buffer.append(instant_rate)
    state.prev_drip_count = raw_drip_count
    state.prev_timestamp = now

    # Track zero-flow window
    if instant_rate > 0:
        state.last_drop_seen = now
        state.zero_flow_since = None
    else:
        if state.zero_flow_since is None:
            state.zero_flow_since = now

    return sum(state.drip_rate_buffer) / len(state.drip_rate_buffer)


def _compute_drain_rate(state: SensorState, volume_ml: float, now: float) -> float:
    """Return mL/min drain rate based on successive weight samples."""
    if state.prev_volume_ml is None or state.prev_volume_ts is None:
        return 0.0
    elapsed = now - state.prev_volume_ts
    if elapsed <= 0:
        return 0.0
    delta_ml = state.prev_volume_ml - volume_ml
    return max(delta_ml / (elapsed / 60.0), 0.0)


def _classify_status(
    weight_grams: float,
    volume_ml: float,
    drip_rate_gtt_min: float,
    drain_rate_ml_per_min: float,
    prescribed_rate_gtt_min: float,
    state: SensorState,
    now: float,
) -> str:
    """
    Fusion decision tree returning a raw (pre-persistence) status string.
    """
    # Bag essentially empty
    if weight_grams <= EMPTY_BAG_THRESHOLD_GRAMS:
        return FlowStatus.CRITICAL  # "Bag empty / no fluid"

    # Sensor noise / calibrating (very brief initial window)
    if state.prev_timestamp is None:
        return FlowStatus.ANOMALY

    zero_flow_duration = (now - state.zero_flow_since) if state.zero_flow_since else 0.0

    # Weight dropping fast AND no drops → line/sensor discrepancy
    if drain_rate_ml_per_min > RAPID_DRAIN_RATE and drip_rate_gtt_min < 1.0:
        return FlowStatus.HIGH_PRIORITY

    # Weight present but sustained zero drops (>15s)
    if volume_ml > 5.0 and zero_flow_duration > ZERO_FLOW_TIMEOUT_SECS:
        return FlowStatus.CRITICAL

    # Prescribed-rate deviation (only when flow is active, bag has fluid,
    # and a valid prescribed rate was provided). Placed after the critical
    # safety checks so empty-bag, no-flow, and line-discrepancy always take
    # priority. Returns ADVISORY — the persistence filter (>3s) prevents
    # alarm fatigue from transient sensor noise.
    if drip_rate_gtt_min >= 1.0 and volume_ml > 5.0 and prescribed_rate_gtt_min > 0:
        deviation = abs(drip_rate_gtt_min - prescribed_rate_gtt_min) / prescribed_rate_gtt_min
        if deviation > DEVIATION_THRESHOLD_PERCENT:
            return FlowStatus.ADVISORY

    # Normal flow: weight decreasing with detected drops
    if drip_rate_gtt_min >= 1.0 and volume_ml > 5.0:
        return FlowStatus.NORMAL

    # Advisory: very slow drip or very low volume
    if volume_ml <= 50.0 or (0 < drip_rate_gtt_min < 1.0):
        return FlowStatus.ADVISORY

    # Catch-all
    return FlowStatus.NORMAL


def _apply_persistence_filter(
    state: SensorState, raw_status: str, now: float
) -> tuple[str, str]:
    """
    Require abnormal states to persist >3s before escalating the alarm.
    Normal state escalates immediately.
    Returns (flow_status, alarm_priority).
    """
    if raw_status == FlowStatus.NORMAL:
        # Immediately clear pending alarm and confirm normal
        state.pending_alarm_status = None
        state.pending_alarm_since = None
        state.confirmed_alarm_status = FlowStatus.NORMAL
        # Reset ack only if we had a non-normal state before
        return FlowStatus.NORMAL, AlarmPriority.NORMAL

    # For abnormal states, start or continue persistence window
    if state.pending_alarm_status != raw_status:
        state.pending_alarm_status = raw_status
        state.pending_alarm_since = now
        # Return previously confirmed status while window counts down
        return state.confirmed_alarm_status, _priority_for_status(state.confirmed_alarm_status)

    # Check if persistence window exceeded
    dwell = now - (state.pending_alarm_since or now)
    if dwell >= ANOMALY_PERSIST_SECS:
        # Escalate
        if state.confirmed_alarm_status != raw_status:
            # New escalation → reset acknowledgement
            state.alarm_acknowledged = False
        state.confirmed_alarm_status = raw_status
        return raw_status, _priority_for_status(raw_status)

    # Still within window — hold previous confirmed status
    return state.confirmed_alarm_status, _priority_for_status(state.confirmed_alarm_status)


def _priority_for_status(status: str) -> str:
    return {
        FlowStatus.NORMAL: AlarmPriority.NORMAL,
        FlowStatus.ADVISORY: AlarmPriority.LOW,
        FlowStatus.HIGH_PRIORITY: AlarmPriority.HIGH,
        FlowStatus.CRITICAL: AlarmPriority.CRITICAL,
        FlowStatus.ANOMALY: AlarmPriority.LOW,
    }.get(status, AlarmPriority.NORMAL)


def _calculate_eta(
    volume_ml: float,
    drip_rate_gtt_min: float,
    flow_status: str,
) -> str:
    """
    Estimate time remaining using: remaining_volume / flow_rate_in_ml_per_min.
    Drop factor: 20 gtt/mL (standard set).
    """
    if flow_status in (FlowStatus.CRITICAL, FlowStatus.HIGH_PRIORITY) or drip_rate_gtt_min < 1.0:
        return "ETA Unavailable"

    flow_ml_per_min = drip_rate_gtt_min / DROP_FACTOR_GTT_PER_ML
    if flow_ml_per_min <= 0:
        return "ETA Unavailable"

    total_minutes = volume_ml / flow_ml_per_min
    hours = int(total_minutes // 60)
    mins = int(total_minutes % 60)

    if hours > 0:
        return f"~{hours}h {mins}m"
    return f"~{mins}m"


def acknowledge_alarm(sensor_id: str) -> None:
    """Mark current alarm as acknowledged (does not clear underlying condition)."""
    state = get_or_create_state(sensor_id)
    state.alarm_acknowledged = True
