# Smart IV Fluid & Flow Rate Monitoring System

A real-time IV bag monitoring platform for hospital central nurse stations and mobile nursing views.

---

## Project Structure

```
INSA project/
├── backend/            # Python FastAPI backend
│   ├── app/
│   │   ├── main.py             # Application entry point
│   │   ├── config.py           # Settings (env-based)
│   │   ├── database.py         # Async SQLAlchemy engine
│   │   ├── models.py           # ORM models
│   │   ├── schemas.py          # Pydantic schemas
│   │   ├── fusion_engine.py    # Sensor Fusion Engine (core logic)
│   │   ├── simulator.py        # Hardware simulator (4 mock beds)
│   │   ├── websocket_manager.py
│   │   └── routers/
│   │       ├── telemetry.py    # POST/GET /api/telemetry
│   │       ├── iv_management.py# register / acknowledge / new-bag
│   │       └── websocket.py    # WS /ws/telemetry
│   ├── requirements.txt
│   └── .env.example
│
└── frontend/           # React Native Expo frontend
    ├── app/
    │   ├── _layout.tsx         # Root navigation + WS init
    │   ├── index.tsx           # Central Dashboard
    │   ├── register.tsx        # IV Registration Wizard
    │   └── details/[ivId].tsx  # IV Details + Diagnostics
    ├── components/
    │   ├── AlarmBanner.tsx
    │   ├── NewBagModal.tsx
    │   ├── PatientCard.tsx
    │   ├── StatusBadge.tsx
    │   ├── SummaryBar.tsx
    │   └── VolumeBar.tsx
    ├── constants/
    │   ├── config.ts           # API URLs
    │   └── theme.ts            # Clinical dark mode design tokens
    ├── store/ivStore.ts        # Zustand state + WS management
    ├── types/index.ts          # TypeScript interfaces
    └── package.json
```

---

## Quick Start

### 1. Backend

```bash
cd backend

# Copy and configure environment
cp .env.example .env
# Edit .env — set DATABASE_URL and optionally set SIMULATOR_MODE=true

# Install dependencies
pip install -r requirements.txt

# Run (simulator mode works without a real database)
uvicorn app.main:app --reload --port 8000
```

The API docs are available at `http://localhost:8000/docs`.

**Note:** If you don't have PostgreSQL, set `SIMULATOR_MODE=true` in `.env`.
The simulator will generate live data for 4 mock beds even without a connected database
(it will log a warning but continue running with in-memory state only).

### 2. Frontend

```bash
cd frontend

# Install dependencies
npm install

# Start Expo dev server
npx expo start

# Press 'w' for web, 'i' for iOS simulator, 'a' for Android
```

**Important:** Update `frontend/constants/config.ts` to point `BASE_URL` and `WS_URL`
at your backend server. If testing on a real device, use your machine's LAN IP address
(e.g. `http://192.168.1.100:8000`).

---

## Architecture Overview

### Sensor Fusion Engine (backend/app/fusion_engine.py)

| Condition | Flow Status | Alarm Priority |
|---|---|---|
| Weight decreasing + normal drops | NORMAL | NORMAL |
| Volume < 50 mL or very slow drip | ADVISORY | LOW |
| Sustained zero drops > 15s (weight remains) | CRITICAL | CRITICAL |
| Rapid weight drain + zero drops | HIGH_PRIORITY | HIGH |
| Initial calibration / noise | ANOMALY | LOW |

- **8-sample moving average** smooths drip-rate noise
- **3-second persistence filter** prevents alarm fatigue from transient spikes
- **ETA** = remaining_volume_mL / (smoothed_gtt_min ÷ 20 drop_factor)

### API Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/telemetry` | Ingest raw ESP32 sensor payload |
| GET  | `/api/telemetry` | Get latest state for all IV lines |
| POST | `/api/iv/register` | Register a new IV line / sensor binding |
| POST | `/api/iv/acknowledge` | Acknowledge active alarm |
| POST | `/api/iv/new-bag` | Confirm new bag and reset volume state |
| GET  | `/api/iv/list` | List all active IV registrations |
| GET  | `/api/iv/history/{iv_id}` | Get telemetry logs + event history |
| WS   | `/ws/telemetry` | Real-time WebSocket feed |

### ESP32 Payload Format

```json
{
  "sensorId": "SENS-104",
  "weightGrams": 250.0,
  "rawDripCount": 1420,
  "timestamp": 1776510000
}
```

---

## Clinical UX Design Decisions

- **Strict dark mode** (`#0f172a` background) — reduces eye strain in ward lighting
- **Color coding**: Green = Normal, Amber = Advisory, Red = Critical/High Priority
- **Summary bar** — at a glance: Critical / Attention / Normal / Stale counts
- **Sort by Urgency** (default) — most critical beds always appear first
- **Alarm banner flashes** — unacknowledged critical alarms pulse red at the top
- **Persistence filter** — abnormal states must persist >3s before escalating (prevents alarm fatigue)
- **New bag modal** — auto-triggered on significant weight spike (>100g increase)
- **Acknowledge workflow** — nurse acknowledges without silencing underlying condition

---

## Database Schema

Three tables:

- **`iv_metadata`** — Patient/room/sensor registration records
- **`telemetry_logs`** — Time-series log of every processed sensor reading
- **`iv_events`** — Audit trail (BAG_REPLACEMENT, ALERT_ACKNOWLEDGED, REGISTERED)
