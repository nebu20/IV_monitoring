#!/usr/bin/env python3
"""
MediGuard Serial Bridge
=======================
Reads JSON telemetry lines from a serial port (or file for testing),
adds a Unix timestamp, and POSTs to the MediGuard backend's
POST /api/telemetry endpoint.

The bridge does NOT implement any flow-rate calculation, alarm logic,
or data fusion — that all runs in the backend's fusion engine.

Usage:
  # Serial mode (from Proteus COMPIM / Virtual Terminal):
  python3 serial_bridge.py --serial /dev/tty.usbserial-XXXX --baud 9600

  # File mode (for testing without Proteus hardware):
  python3 serial_bridge.py --file /tmp/proteus_output.txt

  # Simulate mode (generates fake data for end-to-end testing):
  python3 serial_bridge.py --simulate

Configuration via CLI args or environment variables:
  --serial      Serial port path        (env: BRIDGE_SERIAL_PORT)
  --baud        Baud rate                (env: BRIDGE_BAUD_RATE, default 9600)
  --file        Read from file instead    (env: BRIDGE_INPUT_FILE)
  --simulate    Generate fake data        (no hardware needed)
  --backend     Backend URL              (env: BRIDGE_BACKEND_URL, default http://localhost:8000)
  --sensor-id   Override sensorId field  (env: BRIDGE_SENSOR_ID)
  --interval    Simulate interval (sec)  (env: BRIDGE_SIM_INTERVAL, default 3.0)
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import sys
import time
from typing import Optional

# httpx is already a backend dependency; use it for async HTTP.
# For the bridge we use requests (simpler for a synchronous script).
try:
    import requests
except ImportError:
    print("ERROR: 'requests' not installed.  pip install requests pyserial")
    sys.exit(1)


# ── Defaults ──────────────────────────────────────────────────────────────

DEFAULT_BACKEND = os.environ.get("BRIDGE_BACKEND_URL", "http://localhost:8000")
DEFAULT_BAUD = int(os.environ.get("BRIDGE_BAUD_RATE", "9600"))
DEFAULT_INTERVAL = float(os.environ.get("BRIDGE_SIM_INTERVAL", "3.0"))

running = True


def _signal_handler(sig, frame):
    global running
    running = False
    print("\n[Bridge] Shutting down…")


# ── Core: send one telemetry reading to the backend ───────────────────────

def send_telemetry(backend_url: str, sensor_id: str, weight_grams: float,
                   raw_drip_count: int, timestamp: Optional[int] = None) -> bool:
    """POST a single SensorPayload to /api/telemetry. Returns True on success."""
    if timestamp is None:
        timestamp = int(time.time())

    payload = {
        "sensorId": sensor_id,
        "weightGrams": weight_grams,
        "rawDripCount": raw_drip_count,
        "timestamp": timestamp,
    }

    url = f"{backend_url}/api/telemetry"
    try:
        resp = requests.post(url, json=payload, timeout=10)
        if resp.status_code == 200:
            body = resp.json()
            print(f"[Bridge] OK  sensor={sensor_id}  weight={weight_grams:.1f}g  "
                  f"drips={raw_drip_count}  status={body.get('flow_status', '?')}")
            return True
        else:
            print(f"[Bridge] ERROR  HTTP {resp.status_code}: {resp.text.strip()}")
            return False
    except requests.exceptions.ConnectionError:
        print(f"[Bridge] CONNECTION ERROR  Cannot reach {url} — is the backend running?")
        return False
    except Exception as exc:
        print(f"[Bridge] ERROR  {exc}")
        return False


# ── Validate a parsed JSON line ────────────────────────────────────────────

def parse_and_validate(line: str, sensor_id_override: Optional[str] = None) -> Optional[dict]:
    """Parse a JSON telemetry line from the firmware. Returns validated dict or None."""
    line = line.strip()
    if not line:
        return None

    try:
        data = json.loads(line)
    except json.JSONDecodeError:
        print(f"[Bridge] SKIP  not JSON: {line[:80]}")
        return None

    # Must have sensorId (or we apply override)
    if sensor_id_override:
        data["sensorId"] = sensor_id_override
    elif "sensorId" not in data:
        print(f"[Bridge] SKIP  missing sensorId: {line[:80]}")
        return None

    # Must have weightGrams
    if "weightGrams" not in data:
        print(f"[Bridge] SKIP  missing weightGrams: {line[:80]}")
        return None

    # rawDripCount defaults to 0 if missing (weight-only sensor)
    if "rawDripCount" not in data:
        data["rawDripCount"] = 0

    # Validate numeric types
    try:
        data["weightGrams"] = float(data["weightGrams"])
        data["rawDripCount"] = int(data["rawDripCount"])
    except (ValueError, TypeError):
        print(f"[Bridge] SKIP  invalid numeric value: {line[:80]}")
        return None

    # Timestamp: use firmware value if present, else host clock
    if "timestamp" not in data or not data["timestamp"]:
        data["timestamp"] = int(time.time())
    else:
        data["timestamp"] = int(data["timestamp"])

    return data


# ── Mode: Serial port ──────────────────────────────────────────────────────

def run_serial(port: str, baud: int, backend_url: str,
                sensor_id_override: Optional[str]):
    """Read JSON lines from a serial port and forward to backend."""
    try:
        import serial
    except ImportError:
        print("ERROR: pyserial not installed.  pip install pyserial")
        sys.exit(1)

    print(f"[Bridge] Opening serial port {port} @ {baud} baud…")
    try:
        ser = serial.Serial(port, baud, timeout=1)
    except Exception as exc:
        print(f"[Bridge] ERROR  cannot open {port}: {exc}")
        sys.exit(1)

    print(f"[Bridge] Connected. Forwarding to {backend_url}/api/telemetry")
    buffer = ""

    while running:
        try:
            chunk = ser.read(ser.in_waiting or 1).decode("utf-8", errors="replace")
            if chunk:
                buffer += chunk
                while "\n" in buffer:
                    line, buffer = buffer.split("\n", 1)
                    data = parse_and_validate(line, sensor_id_override)
                    if data:
                        send_telemetry(
                            backend_url,
                            data["sensorId"],
                            data["weightGrams"],
                            data["rawDripCount"],
                            data["timestamp"],
                        )
        except Exception as exc:
            print(f"[Bridge] ERROR  {exc}")
            time.sleep(1)

    ser.close()
    print("[Bridge] Serial port closed.")


# ── Mode: File (for testing without hardware) ──────────────────────────────

def run_file(filepath: str, backend_url: str, sensor_id_override: Optional[str]):
    """Read JSON lines from a file (tail-follow style) and forward to backend."""
    print(f"[Bridge] Watching file {filepath} (tail mode)…")
    print(f"[Bridge] Forwarding to {backend_url}/api/telemetry")

    try:
        f = open(filepath, "r")
    except FileNotFoundError:
        print(f"[Bridge] ERROR  file not found: {filepath}")
        sys.exit(1)

    # Seek to end for tail mode
    f.seek(0, 2)

    while running:
        line = f.readline()
        if line:
            data = parse_and_validate(line, sensor_id_override)
            if data:
                send_telemetry(
                    backend_url,
                    data["sensorId"],
                    data["weightGrams"],
                    data["rawDripCount"],
                    data["timestamp"],
                )
        else:
            time.sleep(0.5)  # no new data — wait

    f.close()
    print("[Bridge] File closed.")


# ── Mode: Simulate (no hardware needed) ────────────────────────────────────

def run_simulate(backend_url: str, sensor_id: str, interval: float):
    """Generate realistic fake telemetry for end-to-end testing."""
    import random

    print(f"[Bridge] SIMULATE mode — generating fake data for {sensor_id}")
    print(f"[Bridge] Interval: {interval}s  Backend: {backend_url}")
    print("[Bridge] Press Ctrl+C to stop.")

    # Simulate a 500mL bag starting at ~400g (net volume ~380mL)
    weight = 400.0
    drip_count = 0
    prescribed_rate = 30.0   # gtt/min
    drop_factor = 20.0       # gtt/mL

    while running:
        # Drain at prescribed rate + noise
        drain_ml = (prescribed_rate / drop_factor / 60.0) * interval
        weight -= drain_ml + random.gauss(0, 0.5)
        weight = max(weight, 20.0)

        # Accumulate drops
        drops = (prescribed_rate / 60.0) * interval + random.gauss(0, 0.3)
        drip_count += max(0, int(drops))

        send_telemetry(backend_url, sensor_id, weight, drip_count)
        time.sleep(interval)


# ── Entry point ────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="MediGuard Serial Bridge — Proteus to backend telemetry forwarder"
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--serial", help="Serial port path (e.g. /dev/tty.usbserial-XXXX)")
    group.add_argument("--file", help="Read telemetry from a file (tail mode)")
    group.add_argument("--simulate", action="store_true", help="Generate fake data (no hardware)")

    parser.add_argument("--baud", type=int, default=DEFAULT_BAUD, help="Serial baud rate (default 9600)")
    parser.add_argument("--backend", default=DEFAULT_BACKEND, help="Backend URL (default http://localhost:8000)")
    parser.add_argument("--sensor-id", default=os.environ.get("BRIDGE_SENSOR_ID"), help="Override sensorId in payload")
    parser.add_argument("--interval", type=float, default=DEFAULT_INTERVAL, help="Simulate interval in seconds")

    args = parser.parse_args()
    signal.signal(signal.SIGINT, _signal_handler)

    print(f"[Bridge] MediGuard Serial Bridge starting…")
    print(f"[Bridge] Backend: {args.backend}")

    if args.simulate:
        sid = args.sensor_id or "SENS-101"
        run_simulate(args.backend, sid, args.interval)
    elif args.serial:
        run_serial(args.serial, args.baud, args.backend, args.sensor_id)
    elif args.file:
        run_file(args.file, args.backend, args.sensor_id)


if __name__ == "__main__":
    main()
