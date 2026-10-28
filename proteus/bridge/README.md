# MediGuard Hardware Bridge — Setup and Integration Guide

This directory connects the Proteus hardware simulations to the MediGuard
backend so sensor readings and alarm events appear on the live dashboard.

```
Proteus Simulation
   │
   ├── IV Monitoring circuit (IV_monitoring.pdsprj)
   │   ATmega328P + HX711 + IR sensor
   │   UART TX (PD1) → Virtual Terminal / COMPIM
   │   → serial_bridge.py → POST /api/telemetry
   │   → fusion engine → WebSocket → dashboard IV cards
   │
   └── Medicine Reminder circuit (medicine reminder.pdsprj)
       ATmega328P + DS3234 RTC + buttons + buzzer
       UART TX (PD1) → Virtual Terminal / COMPIM
       → med_bridge.py → POST /api/medications/doses/ensure
                       → POST /api/medications/doses/{id}/acknowledge
```

---

## Prerequisites

```bash
# 1. Install Python bridge dependencies (run once)
pip install -r proteus/bridge/requirements.txt
# installs: requests>=2.31.0, pyserial>=3.5

# 2. Start the MediGuard backend (terminal 1)
cd "INSA project/backend"
uvicorn app.main:app --reload --port 8000

# 3. Start the Expo frontend (terminal 2)
cd "INSA project/frontend"
npx expo start --web
```

---

## IV Monitoring bridge (serial_bridge.py)

### Firmware
The firmware is in `proteus/firmware/IV.c`.
It reads weight from an HX711 and drop pulses from an IR sensor,
then emits one JSON line per reading over UART at 9600 baud:

```
{"sensorId":"SENS-101","weightGrams":380,"rawDripCount":14}
```

**Pin map** (verify against your schematic before flashing):

| Signal | Pin |
|---|---|
| HX711 DOUT | PD6 |
| HX711 SCK  | PD7 |
| IR sensor  | PB2 |
| UART TX    | PD1 → Virtual Terminal RX |

**`SENSOR_ID`** in `IV.c` (and `IV.h`) defaults to `"SENS-101"`.
This must match an IV line registered in MediGuard
(`POST /api/iv/register`). Change it if your sensor ID differs.

### Quick test without hardware (simulate mode)
```bash
cd "INSA project/proteus/bridge"
python3 serial_bridge.py --simulate --backend http://localhost:8000 --sensor-id SENS-101
```
Open the dashboard — you will see the IV card updating every 3 seconds.

### Serial mode (Proteus running on the Mac)
```bash
# If Proteus is on macOS directly, find the Virtual Terminal port:
ls /dev/tty.*           # look for a USB serial or named pipe

python3 serial_bridge.py \
    --serial /dev/tty.usbserial-XXXX \
    --baud 9600 \
    --backend http://localhost:8000
```

### Serial mode (Proteus in Windows VMware Fusion)
Proteus's Virtual Terminal does not automatically expose a serial device
to the Mac host.  Two reliable approaches:

**Option A — Virtual Terminal → Save to File (simplest)**

1. In Proteus, right-click the Virtual Terminal → "Save to File…"
2. Save to a path accessible from the Mac
   (e.g., the VMware shared folder `/Users/<you>/Desktop/iv_output.txt`).
3. Run the bridge in file mode:
   ```bash
   python3 serial_bridge.py \
       --file "/Users/<you>/Desktop/iv_output.txt" \
       --backend http://localhost:8000
   ```

**Option B — Named pipe via VMware Fusion Serial Port**

1. In VMware Fusion → VM Settings → Serial Port → Add serial port.
2. Connection type: **Named Pipe**. Pipe name: `/tmp/proteus_iv`.
3. Direction: **VM writes, Mac reads** (or bidirectional).
4. In Proteus, add a COMPIM component. Set COM port to the VM serial port.
5. Run:
   ```bash
   python3 serial_bridge.py \
       --serial /tmp/proteus_iv \
       --baud 9600 \
       --backend http://localhost:8000
   ```

---

## Medicine Reminder bridge (med_bridge.py)

### Firmware
The firmware is in `proteus/firmware/main.c`.
It uses a DS3234 SPI RTC to track time, rings an alarm when the set time
matches the current time, and emits JSON events over UART at 9600 baud:

```
{"event":"ALARM_FIRED",    "hour":8,"minute":0}
{"event":"ALARM_DISMISSED","hour":8,"minute":0}
```

`ALARM_FIRED` is sent when the alarm triggers.
`ALARM_DISMISSED` is sent when a button press dismisses it.

**Pin map** (DS3234 SPI):

| Signal | Pin |
|---|---|
| RTC CS   | PB2 |
| RTC MOSI | PB3 |
| RTC MISO | PB4 |
| RTC SCK  | PB5 |
| LED      | PB0 |
| Buzzer   | PB1 |
| UART TX  | PD1 → Virtual Terminal RX |
| BTN SET  | PD2 |
| BTN UP   | PD3 |
| BTN DOWN | PD4 |

### Prerequisites in MediGuard before running the bridge

1. Create a patient in the Card Room:
   ```bash
   curl -X POST http://localhost:8000/api/patients \
     -H "Content-Type: application/json" \
     -d '{"cardId":"MRN-10042","patientName":"Abebe Girma","ward":"2A"}'
   ```

2. Log in and get a JWT:
   ```bash
   curl -X POST http://localhost:8000/api/auth/login \
     -F "username=admin" -F "password=<YOUR_ADMIN_PASSWORD>"
   # Copy the access_token from the response
   ```

3. Create a medication schedule (note the `id` returned):
   ```bash
   curl -X POST http://localhost:8000/api/medications/schedules \
     -H "Authorization: Bearer <TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{
       "card_id": "MRN-10042",
       "medication_name": "Amoxicillin",
       "dose": "500 mg",
       "route": "PO",
       "frequency": "BID",
       "scheduled_times": ["08:00", "20:00"],
       "start_date": "2026-01-01T00:00:00"
     }'
   ```

### Quick test without hardware (simulate mode)
```bash
cd "INSA project/proteus/bridge"

python3 med_bridge.py \
    --simulate \
    --backend http://localhost:8000 \
    --token "<JWT from step 2>" \
    --schedule-id <id from step 3> \
    --card-id MRN-10042
```

Expected output:
```
[MedBridge] Scheduled times: ['08:00', '20:00']
[MedBridge] Alarm 08:00 matched schedule time 08:00
[MedBridge] ALARM_FIRED at 08:00 → calling API
[MedBridge] dose_id=1 for 08:00 UTC 2026-10-28T05:00:00
[MedBridge] Reminder acknowledged for dose 1
...
```

Open the MediGuard medication reminders screen — the dose should
appear as acknowledged (green dot) but still PENDING (not administered).
That is correct: only a nurse records the actual outcome.

### Serial mode (same options as IV bridge above)
```bash
python3 med_bridge.py \
    --serial /dev/tty.usbserial-XXXX \
    --baud 9600 \
    --backend http://localhost:8000 \
    --token "<JWT>" \
    --schedule-id 3 \
    --card-id MRN-10042 \
    --timezone "Africa/Addis_Ababa"
```

---

## What is NOT tested yet (hardware required)

| Item | Status |
|---|---|
| Firmware compiled and loaded into Proteus | Not tested — requires avr-gcc (`brew install avr-gcc`) |
| Virtual Terminal → file output in Proteus | Not tested — requires Proteus running |
| COMPIM named-pipe through VMware Fusion | Not tested — requires VMware configuration |
| HX711 calibration in Proteus | Not done — placeholder values in `IV.c` |
| DS3234 clock accuracy in Proteus sim | Not tested |
| Multi-patient, multi-bridge deployment | Not tested |

## Verified by automated tests

- JSON event parsing (valid, invalid, unknown, empty)
- `_nearest_scheduled_time` tolerance and boundary logic
- `_local_dt_for_alarm` UTC conversion for Africa/Addis_Ababa (UTC+3)
- `handle_event` ALARM_FIRED → ensure + acknowledge (mocked HTTP)
- `handle_event` ALARM_DISMISSED → idempotent
- 409 on already-acknowledged dose handled gracefully
- No matching schedule time → event skipped (not silently dropped)
- Backend: ensure is idempotent (duplicate calls return same dose_id)
- Backend: bridge never auto-administers (dose stays PENDING)
- Backend: unauthenticated bridge request returns 401

Run with:
```bash
cd "INSA project/backend"
.venv/bin/python -m pytest tests/test_med_bridge.py -v
```

## Environment variables

Both bridges can be configured without CLI flags using environment variables:

| Bridge | Variable | Purpose |
|---|---|---|
| Both | `BRIDGE_BACKEND_URL` / `MED_BRIDGE_BACKEND` | Backend URL |
| IV | `BRIDGE_SERIAL_PORT` | Serial port |
| IV | `BRIDGE_BAUD_RATE` | Baud rate |
| IV | `BRIDGE_SENSOR_ID` | Sensor ID override |
| IV | `BRIDGE_SIM_INTERVAL` | Simulate interval (s) |
| Med | `MED_BRIDGE_TOKEN` | JWT token |
| Med | `MED_BRIDGE_SCHEDULE_ID` | Schedule ID |
| Med | `MED_BRIDGE_CARD_ID` | Card/MRN ID |
| Med | `MED_BRIDGE_TZ` | Timezone (default Africa/Addis_Ababa) |
