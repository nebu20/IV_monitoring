#!/usr/bin/env python3
"""
MediGuard Medicine Reminder Bridge
====================================
Reads JSON event lines emitted by the ATmega328P medicine reminder
firmware (proteus/firmware/main.c) from a serial port or file, then
calls the MediGuard medication API to:
  1. Ensure a DoseRecord exists for the fired slot (POST /api/medications/doses/ensure)
  2. Acknowledge the reminder   (POST /api/medications/doses/{id}/acknowledge)

Firmware events (one JSON line per event, CR+LF terminated):
  {"event":"ALARM_FIRED",    "hour":8,"minute":0}
  {"event":"ALARM_DISMISSED","hour":8,"minute":0}

ALARM_FIRED   → create/find the DoseRecord, mark reminder as acknowledged
ALARM_DISMISSED → same (idempotent), records that a human saw and dismissed it

Important: the bridge does NOT record administration (GIVEN/REFUSED/etc).
That remains a nurse action through the MediGuard dashboard.

Usage
-----
  # Serial mode (Proteus COMPIM / Virtual Terminal on the VM):
  python3 med_bridge.py --serial /dev/tty.usbserial-XXXX --baud 9600 \\
      --schedule-id 3 --card-id MRN-10042 --token <JWT>

  # File mode (Proteus Virtual Terminal "Save to File"):
  python3 med_bridge.py --file /tmp/med_output.txt \\
      --schedule-id 3 --card-id MRN-10042 --token <JWT>

  # Simulate mode (no hardware — for end-to-end testing):
  python3 med_bridge.py --simulate \\
      --schedule-id 3 --card-id MRN-10042 --token <JWT>

Configuration (CLI args or env vars):
  --serial        Serial port path           (env: MED_BRIDGE_SERIAL)
  --baud          Baud rate (default 9600)   (env: MED_BRIDGE_BAUD)
  --file          Input file path            (env: MED_BRIDGE_FILE)
  --simulate      Generate fake events       (no hardware)
  --backend       Backend URL                (env: MED_BRIDGE_BACKEND, default http://localhost:8000)
  --token         JWT bearer token           (env: MED_BRIDGE_TOKEN)
  --schedule-id   MedicationSchedule.id      (env: MED_BRIDGE_SCHEDULE_ID)
  --card-id       CardRoomPatient.card_id    (env: MED_BRIDGE_CARD_ID)
  --timezone      Local timezone name        (env: MED_BRIDGE_TZ, default Africa/Addis_Ababa)

Why schedule-id and token are required
---------------------------------------
The ensure endpoint requires authentication (JWT token) and a schedule_id to
create the dose record.  The token must belong to a staff account that has
access to the patient (nurse assigned to the ward, or admin).  The schedule_id
identifies which medication schedule this alarm corresponds to.

Multiple alarms / schedules
-----------------------------
If the hardware is connected to one Proteus instance managing one patient, run
one bridge process per patient/schedule.  The bridge matches alarm hour:minute
to the schedule's configured dose times.  If no matching scheduled time is
found within ±5 minutes, the event is logged but skipped (not silently dropped).
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import sys
import time
import datetime
from typing import Optional
from zoneinfo import ZoneInfo

try:
    import requests
except ImportError:
    requests = None  # type: ignore[assignment]
    # Only exit at runtime if actually called; allows test import without exit
    _requests_missing = True
else:
    _requests_missing = False


def _require_requests() -> None:
    if _requests_missing:
        print("ERROR: 'requests' not installed. pip install requests pyserial")
        sys.exit(1)

# ── Defaults ──────────────────────────────────────────────────────────────────

DEFAULT_BACKEND  = os.environ.get("MED_BRIDGE_BACKEND",  "http://localhost:8000")
DEFAULT_BAUD     = int(os.environ.get("MED_BRIDGE_BAUD", "9600"))
DEFAULT_TZ       = os.environ.get("MED_BRIDGE_TZ",       "Africa/Addis_Ababa")

running = True


def _signal_handler(sig, frame):
    global running
    running = False
    print("\n[MedBridge] Shutting down…")


# ── API helpers ────────────────────────────────────────────────────────────────

def _auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _local_dt_for_alarm(hour: int, minute: int, tz_name: str) -> datetime.datetime:
    """
    Build the local-aware datetime for today's (or yesterday's, if the alarm
    was just after midnight) dose at hour:minute.

    Strategy: try today first.  If the resulting UTC naive datetime is more
    than 4 hours in the past, assume yesterday (e.g. bridge started after
    midnight, alarm was 23:00 previous day).
    """
    local_tz = ZoneInfo(tz_name)
    today = datetime.datetime.now(tz=local_tz).date()
    local_dt = datetime.datetime(today.year, today.month, today.day,
                                  hour, minute, tzinfo=local_tz)
    utc_offset = local_dt.utcoffset()
    utc_dt = (local_dt - utc_offset).replace(tzinfo=None)

    now_utc = datetime.datetime.utcnow()
    if (now_utc - utc_dt).total_seconds() > 4 * 3600:
        # Probably yesterday
        yesterday = today - datetime.timedelta(days=1)
        local_dt = datetime.datetime(yesterday.year, yesterday.month,
                                      yesterday.day, hour, minute,
                                      tzinfo=local_tz)
        utc_offset = local_dt.utcoffset()
        utc_dt = (local_dt - utc_offset).replace(tzinfo=None)

    return utc_dt


def _get_schedule_times(backend: str, schedule_id: int, token: str) -> list[str]:
    """Fetch the scheduled_times list from the backend for validation."""
    if _requests_missing:
        return []
    try:
        resp = requests.get(
            f"{backend}/api/medications/schedules/{schedule_id}",
            headers=_auth_headers(token),
            timeout=10,
        )
        if resp.status_code == 200:
            return resp.json().get("scheduled_times", [])
    except Exception:
        pass
    return []


def _nearest_scheduled_time(
    hour: int, minute: int, scheduled_times: list[str], tolerance_minutes: int = 5
) -> Optional[str]:
    """
    Return the HH:MM string from scheduled_times that is closest to hour:minute,
    or None if no time is within tolerance_minutes.
    """
    alarm_total = hour * 60 + minute
    best: Optional[str] = None
    best_diff = tolerance_minutes + 1

    for t in scheduled_times:
        try:
            h, m = map(int, t.split(":"))
        except ValueError:
            continue
        sched_total = h * 60 + m
        diff = abs(alarm_total - sched_total)
        if diff < best_diff:
            best_diff = diff
            best = t

    return best if best_diff <= tolerance_minutes else None


def ensure_and_acknowledge(
    backend: str, schedule_id: int, token: str,
    hour: int, minute: int, tz_name: str,
) -> bool:
    _require_requests()
    """
    Main action: ensure a PENDING DoseRecord exists for the alarm slot, then
    acknowledge the reminder.  Both operations are idempotent.

    Returns True if at least the ensure succeeded.
    """
    utc_dt = _local_dt_for_alarm(hour, minute, tz_name)
    utc_iso = utc_dt.isoformat()

    # 1. Ensure a DoseRecord exists
    ensure_url = (
        f"{backend}/api/medications/doses/ensure"
        f"?schedule_id={schedule_id}&scheduled_datetime={utc_iso}"
    )
    try:
        resp = requests.post(ensure_url, headers=_auth_headers(token), timeout=10)
        if resp.status_code not in (200, 409):
            print(f"[MedBridge] ensure failed: HTTP {resp.status_code} — {resp.text.strip()}")
            return False

        dose_id = resp.json().get("id")
        if dose_id is None:
            print("[MedBridge] ensure returned no id")
            return False

        print(f"[MedBridge] dose_id={dose_id} for {hour:02d}:{minute:02d} UTC {utc_iso}")
    except requests.exceptions.ConnectionError:
        print(f"[MedBridge] CONNECTION ERROR — cannot reach {backend}")
        return False
    except Exception as exc:
        print(f"[MedBridge] ensure error: {exc}")
        return False

    # 2. Acknowledge the reminder (idempotent — 409 means already acknowledged, that's fine)
    ack_url = f"{backend}/api/medications/doses/{dose_id}/acknowledge"
    try:
        ack_resp = requests.post(
            ack_url,
            headers=_auth_headers(token),
            json={"notes": "Acknowledged via Proteus hardware button"},
            timeout=10,
        )
        if ack_resp.status_code == 200:
            print(f"[MedBridge] Reminder acknowledged for dose {dose_id}")
        elif ack_resp.status_code == 409:
            print(f"[MedBridge] Already acknowledged (dose {dose_id}) — OK")
        else:
            print(f"[MedBridge] ack failed: HTTP {ack_resp.status_code} — {ack_resp.text.strip()}")
    except Exception as exc:
        print(f"[MedBridge] ack error: {exc}")
        # Not fatal — ensure succeeded

    return True


# ── Parse a single firmware event line ───────────────────────────────────────

def handle_event(
    line: str,
    backend: str,
    schedule_id: int,
    token: str,
    tz_name: str,
    scheduled_times: list[str],
) -> None:
    """Process one JSON line from the firmware."""
    line = line.strip()
    if not line:
        return

    try:
        data = json.loads(line)
    except json.JSONDecodeError:
        print(f"[MedBridge] SKIP  not JSON: {line[:80]}")
        return

    event = data.get("event")
    if event not in ("ALARM_FIRED", "ALARM_DISMISSED"):
        # Ignore unknown event types (e.g. startup messages)
        print(f"[MedBridge] SKIP  unknown event: {event!r}")
        return

    hour   = int(data.get("hour",   0))
    minute = int(data.get("minute", 0))

    # Validate against known scheduled times
    if scheduled_times:
        matched = _nearest_scheduled_time(hour, minute, scheduled_times)
        if matched is None:
            print(
                f"[MedBridge] WARNING  alarm {hour:02d}:{minute:02d} has no "
                f"matching scheduled time (±5 min) in schedule {schedule_id}. "
                f"Scheduled times: {scheduled_times}. Event skipped."
            )
            return
        print(f"[MedBridge] Alarm {hour:02d}:{minute:02d} matched schedule time {matched}")

    print(f"[MedBridge] {event} at {hour:02d}:{minute:02d} → calling API")
    ensure_and_acknowledge(backend, schedule_id, token, hour, minute, tz_name)


# ── Input modes ───────────────────────────────────────────────────────────────

def run_serial(
    port: str, baud: int, backend: str,
    schedule_id: int, token: str, tz_name: str,
    scheduled_times: list[str],
) -> None:
    try:
        import serial
    except ImportError:
        print("ERROR: pyserial not installed.  pip install pyserial")
        sys.exit(1)

    print(f"[MedBridge] Opening {port} @ {baud} baud…")
    try:
        ser = serial.Serial(port, baud, timeout=1)
    except Exception as exc:
        print(f"[MedBridge] ERROR cannot open {port}: {exc}")
        sys.exit(1)

    print(f"[MedBridge] Connected. Waiting for firmware events…")
    buf = ""
    while running:
        try:
            chunk = ser.read(ser.in_waiting or 1).decode("utf-8", errors="replace")
            if chunk:
                buf += chunk
                while "\n" in buf:
                    line, buf = buf.split("\n", 1)
                    handle_event(line, backend, schedule_id, token, tz_name, scheduled_times)
        except Exception as exc:
            print(f"[MedBridge] serial error: {exc}")
            time.sleep(1)
    ser.close()
    print("[MedBridge] Serial port closed.")


def run_file(
    filepath: str, backend: str,
    schedule_id: int, token: str, tz_name: str,
    scheduled_times: list[str],
) -> None:
    print(f"[MedBridge] Watching file {filepath} (tail mode)…")
    try:
        f = open(filepath, "r")
    except FileNotFoundError:
        print(f"[MedBridge] ERROR file not found: {filepath}")
        sys.exit(1)
    f.seek(0, 2)  # seek to end for tail mode
    while running:
        line = f.readline()
        if line:
            handle_event(line, backend, schedule_id, token, tz_name, scheduled_times)
        else:
            time.sleep(0.5)
    f.close()


def run_simulate(
    backend: str, schedule_id: int, token: str, tz_name: str,
    scheduled_times: list[str],
) -> None:
    """Emit a simulated ALARM_FIRED for each scheduled time, then ALARM_DISMISSED."""
    import random
    local_tz = ZoneInfo(tz_name)
    now_local = datetime.datetime.now(tz=local_tz)

    print(f"[MedBridge] SIMULATE mode for schedule {schedule_id}")
    print(f"[MedBridge] Local time: {now_local.strftime('%H:%M')} ({tz_name})")

    if not scheduled_times:
        print("[MedBridge] No scheduled times available — using current time")
        scheduled_times = [now_local.strftime("%H:%M")]

    for time_str in scheduled_times:
        h, m = map(int, time_str.split(":"))
        print(f"\n[MedBridge] Simulating ALARM_FIRED  at {h:02d}:{m:02d}")
        handle_event(
            json.dumps({"event": "ALARM_FIRED", "hour": h, "minute": m}),
            backend, schedule_id, token, tz_name, scheduled_times,
        )
        time.sleep(1)
        print(f"[MedBridge] Simulating ALARM_DISMISSED at {h:02d}:{m:02d}")
        handle_event(
            json.dumps({"event": "ALARM_DISMISSED", "hour": h, "minute": m}),
            backend, schedule_id, token, tz_name, scheduled_times,
        )
        time.sleep(2)

    print("\n[MedBridge] Simulation complete.")


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(
        description="MediGuard Medicine Reminder Bridge"
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--serial",   help="Serial port path")
    mode.add_argument("--file",     help="Input file path (tail mode)")
    mode.add_argument("--simulate", action="store_true", help="Simulate alarm events")

    parser.add_argument("--baud",        type=int,   default=DEFAULT_BAUD)
    parser.add_argument("--backend",     default=DEFAULT_BACKEND)
    parser.add_argument("--token",       default=os.environ.get("MED_BRIDGE_TOKEN"),
                        help="JWT bearer token (required)")
    parser.add_argument("--schedule-id", type=int,
                        default=int(os.environ.get("MED_BRIDGE_SCHEDULE_ID", "0")),
                        help="MedicationSchedule.id (required)")
    parser.add_argument("--card-id",     default=os.environ.get("MED_BRIDGE_CARD_ID"),
                        help="CardRoomPatient.card_id (used for logging)")
    parser.add_argument("--timezone",    default=DEFAULT_TZ,
                        help="Local timezone (default Africa/Addis_Ababa)")

    args = parser.parse_args()

    if not args.token:
        print("ERROR: --token is required (or set MED_BRIDGE_TOKEN env var)")
        sys.exit(1)
    if not args.schedule_id:
        print("ERROR: --schedule-id is required (or set MED_BRIDGE_SCHEDULE_ID env var)")
        sys.exit(1)

    signal.signal(signal.SIGINT, _signal_handler)

    print(f"[MedBridge] MediGuard Medicine Reminder Bridge starting…")
    print(f"[MedBridge] Backend:     {args.backend}")
    print(f"[MedBridge] Schedule ID: {args.schedule_id}")
    print(f"[MedBridge] Card ID:     {args.card_id or '(not specified)'}")
    print(f"[MedBridge] Timezone:    {args.timezone}")

    # Fetch scheduled times for validation (non-fatal if it fails)
    scheduled_times = _get_schedule_times(args.backend, args.schedule_id, args.token)
    if scheduled_times:
        print(f"[MedBridge] Scheduled times: {scheduled_times}")
    else:
        print("[MedBridge] WARNING: could not fetch scheduled times — alarms will not be validated")

    if args.simulate:
        run_simulate(args.backend, args.schedule_id, args.token,
                     args.timezone, scheduled_times)
    elif args.serial:
        run_serial(args.serial, args.baud, args.backend,
                   args.schedule_id, args.token, args.timezone, scheduled_times)
    elif args.file:
        run_file(args.file, args.backend,
                 args.schedule_id, args.token, args.timezone, scheduled_times)


if __name__ == "__main__":
    main()
