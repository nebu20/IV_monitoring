# Smart IV Fluid & Flow Rate Monitoring System
## Complete Technical Documentation

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Technology Choices](#2-technology-choices)
3. [Folder Structure](#3-folder-structure)
4. [Backend Architecture](#4-backend-architecture)
5. [Frontend Architecture](#5-frontend-architecture)
6. [Sensor Fusion Engine](#6-sensor-fusion-engine)
7. [Database Design](#7-database-design)
8. [API Reference](#8-api-reference)
9. [Real-Time Communication](#9-real-time-communication)
10. [Hardware Simulator](#10-hardware-simulator)
11. [Clinical UX Design](#11-clinical-ux-design)
12. [Syntax & Code Patterns](#12-syntax--code-patterns)
13. [Data Flow: End to End](#13-data-flow-end-to-end)
14. [Running the System](#14-running-the-system)

---

## 1. System Overview

The Smart IV Fluid and Flow Rate Monitoring System is a real-time clinical decision support
tool designed for hospital wards. It continuously tracks intravenous (IV) fluid bags using
two physical sensors attached to each IV stand:

- **Load Cell** — measures the weight of the IV bag in grams
- **IR Drip Sensor** — counts individual drops falling through the drip chamber

An ESP32 microcontroller reads both sensors and sends the data to the backend server
every few seconds over HTTP. The backend processes, fuses, and interprets the raw numbers
into clinically meaningful information — flow rate, volume remaining, estimated time to
completion, and alarm status — then streams it live to nurse stations and mobile devices.

### Core Clinical Goal

At a single glance, a nurse must know:
- **WHICH** IV needs attention (Room, Patient Name)
- **WHY** it needs attention (Status badge, alarm colour)
- **HOW SOON** it needs attention (ETA, volume percentage)

---

## 2. Technology Choices

### 2.1 Python — Backend Language

**Why Python?**

Python was chosen for the backend for the following reasons:

1. **Scientific computing strength** — the sensor fusion engine requires moving averages,
   rate calculations, and time-series filtering. Python's syntax makes these algorithms
   readable and easy to audit for clinical correctness.

2. **FastAPI ecosystem** — Python has the most mature async web framework (FastAPI) that
   supports both REST endpoints and WebSockets in a single codebase.

3. **SQLAlchemy** — the most feature-complete async database ORM available, supporting
   PostgreSQL with full type safety.

4. **Rapid prototyping** — clinical prototypes need to be built and modified quickly.
   Python allows the logic to be written, read, and changed without ceremony.

**Why not Node.js or Go?**
Node.js is suitable but the numeric processing and moving-average logic would be less
readable. Go is fast but has limited data-science tooling. Python is the standard in
medical device software prototyping.

---

### 2.2 FastAPI — Web Framework

**Why FastAPI?**

FastAPI is a modern Python web framework built on top of Starlette and Pydantic.

| Feature | Why it matters here |
|---|---|
| Async/await native | Handles hundreds of WebSocket connections without blocking |
| Pydantic schemas | Validates every incoming sensor payload automatically |
| Auto docs (Swagger) | Generates interactive API docs at /docs with zero extra work |
| WebSocket support | Built-in, no extra library needed |
| Type hints | Every parameter is typed, catching errors before runtime |

FastAPI was chosen over Flask (no async, no built-in validation) and Django (too heavy,
not designed for real-time streaming).

---

### 2.3 PostgreSQL — Database

**Why PostgreSQL?**

1. **Time-series data** — telemetry logs are append-heavy time-series. PostgreSQL handles
   this well and can be extended with TimescaleDB if needed.
2. **ACID compliance** — patient data requires transactional integrity.
3. **asyncpg driver** — the fastest async PostgreSQL driver available for Python,
   giving near-native performance.
4. **JSON support** — useful for storing flexible event metadata.

The system also runs in **in-memory mode** without PostgreSQL for development and
demonstration, making it easy to run without any database setup.

---

### 2.4 SQLAlchemy — ORM (Object Relational Mapper)

**Why SQLAlchemy?**

SQLAlchemy maps Python classes to database tables. Instead of writing raw SQL like:

```sql
SELECT * FROM iv_metadata WHERE sensor_id = 'SENS-104' AND active = true
```

You write Python:

```python
select(IVMetadata).where(
    IVMetadata.sensor_id == 'SENS-104',
    IVMetadata.active == True
)
```

This is safer (prevents SQL injection), more readable, and works across different
database backends. The async version (AsyncSession) allows database queries to run
without blocking the WebSocket event loop.

---

### 2.5 TypeScript — Frontend Language

**Why TypeScript instead of plain JavaScript?**

TypeScript adds static types to JavaScript. This means:

1. **Compile-time safety** — if a sensor payload field is renamed, TypeScript immediately
   shows errors in every file that uses it. Without types, this breaks silently at runtime.

2. **Self-documenting code** — the type `TelemetryState` tells every developer exactly
   what fields exist and what type they are, without reading the backend source.

3. **IDE autocompletion** — the editor knows the shape of every object, making
   development faster and less error-prone.

4. **Clinical software standards** — in medical software, silent type errors are
   dangerous. TypeScript acts as a first layer of correctness checking.

Example — without TypeScript this bug is invisible until runtime:

```javascript
// JavaScript — no error shown, but crashes when rendered
const rate = state.drip_Rate_gtt_min; // wrong field name, undefined
```

With TypeScript:

```typescript
// TypeScript — error shown immediately in the editor
const rate = state.drip_Rate_gtt_min; // Error: Property does not exist
```

---

### 2.6 React Native with Expo — Frontend Framework

**Why React Native?**

React Native allows a single codebase to run on:
- Web browsers (Chrome, Safari, Firefox)
- iOS devices (iPhone, iPad)
- Android devices

For a hospital system, this means the central nurse station (web browser on a desktop)
and the mobile nurse (smartphone) see the same data from the same codebase.

**Why Expo specifically?**

Expo is a layer on top of React Native that:
- Removes the need for Xcode or Android Studio to get started
- Provides pre-built native modules (camera, fonts, status bar)
- Includes Expo Router for file-based navigation (like Next.js)
- Allows instant reload in the browser during development

**Why not a pure web framework like React or Next.js?**

The system is designed to also run on mobile devices at the bedside. React Native
gives this flexibility from day one without rewriting the UI layer.

---

### 2.7 Zustand — State Management

**Why Zustand instead of Redux?**

Zustand is a minimal state management library for React/React Native.

| | Redux | Zustand |
|---|---|---|
| Boilerplate | High (actions, reducers, dispatch) | Low (plain functions) |
| Bundle size | Large | ~1KB |
| Learning curve | Steep | Simple |
| Async support | Requires middleware | Native |

For a focused clinical application, Zustand provides everything needed:
- A central store for all IV states
- WebSocket connection lifecycle management
- Filter and sort logic
- Actions that components call directly

---

### 2.8 WebSockets — Real-Time Communication

**Why WebSockets instead of polling?**

Polling (asking the server "anything new?" every few seconds) is wasteful and slow.
WebSockets open a persistent two-way connection. When a new sensor reading arrives,
the server pushes it to all connected clients instantly — no delay, no wasted requests.

For an IV monitoring system where a "no flow" alarm could indicate a disconnected line
or infiltration, the difference between 0ms push latency and 3-5 seconds polling
latency is clinically significant.

---

## 3. Folder Structure

```
INSA project/
├── backend/                    ← Python FastAPI server
│   ├── app/
│   │   ├── __init__.py         ← Makes app/ a Python package
│   │   ├── main.py             ← Application entry point, lifespan, startup
│   │   ├── config.py           ← All settings loaded from .env file
│   │   ├── database.py         ← SQLAlchemy engine and session factory
│   │   ├── models.py           ← Database table definitions (ORM models)
│   │   ├── schemas.py          ← Pydantic request/response shapes
│   │   ├── fusion_engine.py    ← Core sensor fusion & alarm logic
│   │   ├── simulator.py        ← Hardware simulator (4 mock IV beds)
│   │   ├── websocket_manager.py← WebSocket connection pool
│   │   └── routers/
│   │       ├── __init__.py
│   │       ├── telemetry.py    ← POST/GET /api/telemetry
│   │       ├── iv_management.py← register, acknowledge, new-bag, history
│   │       └── websocket.py    ← WS /ws/telemetry endpoint
│   ├── requirements.txt        ← Python package dependencies
│   ├── .env.example            ← Template for environment configuration
│   └── run.sh                  ← One-command startup script
│
├── frontend/                   ← React Native Expo application
│   ├── app/
│   │   ├── _layout.tsx         ← Root layout: navigation + WebSocket init
│   │   ├── index.tsx           ← Central Dashboard screen
│   │   ├── register.tsx        ← IV Registration Wizard screen
│   │   └── details/
│   │       └── [ivId].tsx      ← IV Details screen (dynamic route)
│   ├── components/
│   │   ├── AlarmBanner.tsx     ← Flashing red banner for critical alarms
│   │   ├── NewBagModal.tsx     ← Confirm new bag installation modal
│   │   ├── PatientCard.tsx     ← Primary bed card in the grid
│   │   ├── StatusBadge.tsx     ← Colour-coded flow status pill
│   │   ├── SummaryBar.tsx      ← Unit-wide counts bar
│   │   └── VolumeBar.tsx       ← Fluid volume progress bar
│   ├── constants/
│   │   ├── config.ts           ← API URLs and WebSocket URL
│   │   └── theme.ts            ← Colours, typography, spacing design tokens
│   ├── store/
│   │   └── ivStore.ts          ← Zustand store: all state + WebSocket logic
│   ├── types/
│   │   └── index.ts            ← TypeScript type definitions
│   ├── assets/                 ← App icons and splash screen images
│   ├── package.json            ← Node.js dependencies
│   ├── app.json                ← Expo configuration
│   ├── babel.config.js         ← JavaScript transpiler configuration
│   └── tsconfig.json           ← TypeScript compiler configuration
│
└── README.md                   ← Quick start guide
```

### Why this folder structure?

**Separation of concerns** is the core principle. Each folder has one clear purpose:

- `app/routers/` — HTTP and WebSocket endpoints only. No business logic here.
- `app/fusion_engine.py` — All sensor math lives in one file. Easy to test and audit.
- `app/models.py` — Database structure in one place. Change the schema here, nothing else.
- `app/schemas.py` — API contracts. Frontend developers only need to read this file.
- `frontend/components/` — Reusable visual pieces. Each component does one thing.
- `frontend/store/` — All application state in one place. No state scattered in components.
- `frontend/constants/` — Colours and URLs defined once. Changing a colour means editing one line.

This structure follows the **Single Responsibility Principle**: each file has one reason
to change. If the alarm colour needs updating, only `theme.ts` changes. If the drip-rate
formula changes, only `fusion_engine.py` changes.

---

## 4. Backend Architecture

### 4.1 Request Lifecycle

When an ESP32 sends a sensor reading, this is the exact sequence of events:

```
ESP32 Hardware
    │
    │  POST /api/telemetry
    │  {"sensorId": "SENS-104", "weightGrams": 250, "rawDripCount": 1420, "timestamp": 1776510000}
    ▼
FastAPI Router (routers/telemetry.py)
    │
    ├── 1. Pydantic validates the payload shape and types
    ├── 2. Database lookup: find patient registered to SENS-104
    ├── 3. Sensor Fusion Engine (fusion_engine.py)
    │       ├── Compute drip delta from previous reading
    │       ├── Add to 8-sample moving average buffer
    │       ├── Calculate volume from weight
    │       ├── Run fusion decision tree
    │       ├── Apply 3-second persistence filter
    │       └── Calculate ETA string
    ├── 4. Write TelemetryLog row to PostgreSQL
    ├── 5. Update in-memory latest-state cache
    └── 6. Broadcast updated state to all WebSocket clients
```

### 4.2 Application Startup (lifespan)

FastAPI 0.115 uses a `lifespan` context manager for startup and shutdown:

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    # STARTUP — runs before the server accepts requests
    await create_tables()          # Create DB tables if they don't exist
    await _seed_simulator_beds()   # Insert mock patients
    asyncio.create_task(run_simulator(_simulator_ingest))  # Start simulator

    yield  # Server runs here — handles all requests

    # SHUTDOWN — runs when Ctrl+C is pressed
    logger.info("Shutting down...")
```

The `yield` keyword is the key concept: everything before `yield` is startup,
everything after `yield` is shutdown. This is a Python context manager pattern.

### 4.3 Dependency Injection

FastAPI uses dependency injection for database sessions:

```python
@router.post("/api/telemetry")
async def ingest_telemetry(
    payload: SensorPayload,           # ← Pydantic validates this automatically
    db: AsyncSession = Depends(get_db) # ← FastAPI injects a DB session here
):
```

`Depends(get_db)` means: "before calling this function, run `get_db()` and pass
the result as `db`". The `get_db` function opens a database session, yields it,
then closes it after the request completes — even if an error occurs.

---

## 5. Frontend Architecture

### 5.1 File-Based Routing (Expo Router)

Expo Router uses the file system as the navigation structure. The file path
directly determines the URL:

| File | URL | Screen |
|---|---|---|
| `app/index.tsx` | `/` | Central Dashboard |
| `app/register.tsx` | `/register` | IV Registration Wizard |
| `app/details/[ivId].tsx` | `/details/IV-SIM-001` | IV Details |

The `[ivId]` bracket syntax creates a dynamic route — the value between
the brackets becomes a parameter accessible with `useLocalSearchParams()`.

### 5.2 Component Tree

```
_layout.tsx (Root — sets up navigation, starts WebSocket)
│
├── index.tsx (Dashboard)
│   ├── AlarmBanner
│   ├── SummaryBar
│   ├── FlatList (grid)
│   │   └── PatientCard (×N)
│   │       ├── StatusBadge
│   │       └── VolumeBar
│   └── NewBagModal
│
├── register.tsx (Registration Wizard)
│
└── details/[ivId].tsx (IV Details)
    ├── StatusBadge
    └── VolumeBar
```

### 5.3 State Management (Zustand Store)

The entire application state lives in `store/ivStore.ts`:

```typescript
interface IVStore {
  ivMap: Record<string, TelemetryState>  // All live IV states
  wsConnected: boolean                    // WebSocket status
  sortMode: SortMode                      // 'urgency' | 'eta' | 'room'
  filterMode: FilterMode                  // 'all' | 'no_flow' | etc.
  newBagModalVisible: boolean             // Popup trigger

  // Actions
  connectWebSocket: () => void
  acknowledgeAlarm: (ivId: string) => Promise<void>
  getSortedFiltered: () => TelemetryState[]
}
```

Components read from the store with a selector:

```typescript
const items = useIVStore((s) => s.getSortedFiltered());
```

Components dispatch actions:

```typescript
const acknowledge = useIVStore((s) => s.acknowledgeAlarm);
await acknowledge('IV-SIM-001');
```

No Redux actions, no dispatch, no reducers. The store is plain TypeScript.

---

## 6. Sensor Fusion Engine

The fusion engine (`fusion_engine.py`) is the mathematical core of the system.
It runs on every incoming sensor reading and produces a clinical status.

### 6.1 Moving Average Filter

Raw drip counts are noisy — a single missed drop would show as zero flow for one
reading. An 8-sample moving average smooths this:

```python
DRIP_MOVING_AVG_WINDOW = 8

# Each new reading is added to a circular buffer
state.drip_rate_buffer.append(instant_rate)

# The smoothed rate is the average of the last 8 readings
smoothed = sum(state.drip_rate_buffer) / len(state.drip_rate_buffer)
```

Why 8 samples? With a 3-second tick interval, 8 samples = 24 seconds of smoothing.
This is enough to absorb sensor noise while still responding to real flow changes
within about 30 seconds — clinically acceptable.

### 6.2 Volume Calculation

```python
# Subtract the tare weight of the empty bag (20 grams)
net_weight = max(weight_grams - 20.0, 0.0)

# 1 gram of aqueous IV fluid ≈ 1 mL (density of water)
volume_ml = net_weight

# Percentage of original bag remaining
percentage = (volume_ml / bag_size_ml) * 100
```

The tare weight (empty bag weight) is set to 20g as a calibration constant.
In a production system this would be measured per bag type.

### 6.3 Fusion Decision Tree

```
Is weight ≤ 20g (empty)?
    YES → CRITICAL (bag empty)

Is this the first reading (no history)?
    YES → ANOMALY (calibrating)

Is weight draining fast AND zero drops detected?
    YES → HIGH_PRIORITY (sensor/line discrepancy)

Has zero drops persisted for more than 15 seconds, with volume remaining?
    YES → CRITICAL (no flow — assess IV line)

Is drip rate ≥ 1 gtt/min with volume remaining?
    YES → NORMAL (flow normal)

Is volume ≤ 50mL or drip rate very slow?
    YES → ADVISORY (low volume or slow drip)

Default → NORMAL
```

### 6.4 Persistence Filter

To prevent alarm fatigue from momentary sensor noise, an alarm state must persist
for more than 3 seconds before being escalated:

```python
ANOMALY_PERSIST_SECS = 3.0

if dwell >= ANOMALY_PERSIST_SECS:
    # Condition has persisted — escalate alarm
    state.confirmed_alarm_status = raw_status
    state.alarm_acknowledged = False  # Reset acknowledgement
```

This is the same principle used in cardiac monitoring equipment — a single
artifact should not trigger an alarm.

### 6.5 ETA Calculation

```
Drop factor: 20 gtt per mL (standard IV giving set)

flow_ml_per_min = drip_rate_gtt_min / 20

total_minutes = volume_ml / flow_ml_per_min

ETA = hours and minutes formatted as "~2h 30m"
```

If flow is unstable (CRITICAL or HIGH_PRIORITY status), ETA is set to
"ETA Unavailable" — it would be misleading to show a time estimate when
the flow rate cannot be trusted.

---

## 7. Database Design

### 7.1 Table: iv_metadata

Stores the registration of each IV line — the mapping between a physical
sensor, a patient, and an IV bag.

| Column | Type | Purpose |
|---|---|---|
| id | Integer (PK) | Internal identifier |
| patient_id | String | Hospital patient ID (e.g. PAT-001) |
| patient_name | String | Patient full name |
| room_bed | String | Location (e.g. "3A-02") |
| iv_id | String (unique) | IV line identifier |
| fluid_name | String | Fluid type (e.g. "NS 0.9%") |
| bag_size_ml | Float | Initial bag volume |
| prescribed_rate_gtt_min | Float | Doctor's ordered drip rate |
| sensor_id | String (unique) | Physical sensor identifier |
| active | Boolean | Whether this registration is current |

### 7.2 Table: telemetry_logs

A time-series log of every processed sensor reading. This is the raw history data.

| Column | Type | Purpose |
|---|---|---|
| id | Integer (PK) | Internal identifier |
| timestamp | DateTime | When the reading was taken |
| sensor_id | String (FK) | Which sensor sent this |
| raw_weight_grams | Float | Raw load cell reading |
| raw_drip_count | Integer | Cumulative drip counter |
| volume_ml | Float | Calculated remaining volume |
| percentage | Float | Percentage of bag remaining |
| drip_rate_gtt_min | Float | Smoothed drip rate |
| flow_status | String | NORMAL / ADVISORY / CRITICAL etc. |
| alarm_priority | String | NORMAL / LOW / HIGH / CRITICAL |
| eta_string | String | Human-readable ETA |
| alarm_acknowledged | Boolean | Whether nurse has acknowledged |

### 7.3 Table: iv_events

An audit trail of nurse-initiated actions. This is the event log.

| Column | Type | Purpose |
|---|---|---|
| id | Integer (PK) | Internal identifier |
| event_type | String | BAG_REPLACEMENT / ALERT_ACKNOWLEDGED / REGISTERED |
| timestamp | DateTime | When the event occurred |
| iv_id | String (FK) | Which IV line this applies to |
| nurse_notes | Text | Optional free-text from the nurse |

### 7.4 Why Three Tables?

- `iv_metadata` changes rarely — only when a nurse registers or re-assigns a sensor.
- `telemetry_logs` changes constantly — every 3 seconds per sensor.
- `iv_events` records deliberate human actions for audit and accountability.

Keeping them separate prevents the high-frequency sensor writes from making
the patient registration data harder to query.

---

## 8. API Reference

### POST /api/telemetry

Accepts a raw sensor payload from the ESP32 or simulator.

**Request body:**
```json
{
  "sensorId": "SENS-104",
  "weightGrams": 250.0,
  "rawDripCount": 1420,
  "timestamp": 1776510000
}
```

**Response:**
```json
{
  "status": "ok",
  "flow_status": "NORMAL"
}
```

**What it does internally:**
1. Validates the payload with Pydantic
2. Looks up the registered patient for this sensor_id
3. Runs the sensor fusion engine
4. Writes a row to telemetry_logs
5. Updates the in-memory state cache
6. Broadcasts the new state to all WebSocket clients

---

### POST /api/iv/register

Binds a sensor to a patient and IV bag.

**Request body:**
```json
{
  "patient_id": "PAT-001",
  "patient_name": "Abebe Girma",
  "room_bed": "3A-02",
  "iv_id": "IV-2024-001",
  "fluid_name": "NS 0.9%",
  "bag_size_ml": 1000,
  "prescribed_rate_gtt_min": 30,
  "sensor_id": "SENS-104"
}
```

---

### POST /api/iv/acknowledge

Marks the active alarm as acknowledged by a nurse. The underlying condition
is NOT cleared — if the alarm condition continues, it will re-escalate.

**Request body:**
```json
{
  "iv_id": "IV-2024-001",
  "nurse_notes": "Checked IV line, repositioned patient"
}
```

---

### POST /api/iv/new-bag

Confirms that a new IV bag has been installed. Resets volume tracking and ETA.

**Request body:**
```json
{
  "iv_id": "IV-2024-001",
  "new_bag_size_ml": 1000,
  "nurse_notes": "New 1000mL NS 0.9% bag installed"
}
```

---

### GET /api/iv/history/{iv_id}

Returns up to 50 recent telemetry readings and the event timeline for one IV line.
Falls back to in-memory cache when PostgreSQL is unavailable.

---

### WS /ws/telemetry

WebSocket endpoint. On connection:
1. Sends an `INITIAL_STATE` message with all current IV states
2. Sends `TELEMETRY_UPDATE` messages as new readings arrive

**Message types received by the client:**
```
INITIAL_STATE    → { type, data: TelemetryState[] }
TELEMETRY_UPDATE → { type, data: TelemetryState }
ALARM_ACKNOWLEDGED → { type, data: { iv_id, sensor_id } }
BAG_REPLACED     → { type, data: { iv_id, new_bag_size_ml } }
IV_REGISTERED    → { type, data: { iv_id, sensor_id, patient_name } }
```

**Message sent by the client:**
```
PING → { type: "PING" }   (sent every 30 seconds to keep connection alive)
```

---

## 9. Real-Time Communication

### 9.1 WebSocket Connection Manager

`websocket_manager.py` maintains the set of all active client connections:

```python
class ConnectionManager:
    def __init__(self):
        self._connections: Set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def broadcast(self, payload: dict):
        # Send to all connected clients simultaneously
        for ws in targets:
            await ws.send_text(json.dumps(payload))
```

An `asyncio.Lock` prevents race conditions when multiple sensor readings arrive
simultaneously and both try to modify the connections set.

### 9.2 Client Reconnection

The frontend WebSocket client in `ivStore.ts` implements exponential backoff
reconnection — it waits 1s, then 2s, then 4s, then 8s (capped at 30s) between
reconnection attempts:

```typescript
ws.onclose = () => {
  const retries = get().wsRetryCount;
  const delay = Math.min(1000 * Math.pow(2, retries), 30_000);
  setTimeout(() => get().connectWebSocket(), delay);
};
```

This prevents flooding the server with reconnection attempts during a network
outage while still recovering quickly when connectivity returns.

### 9.3 Initial State Snapshot

When a new WebSocket client connects, it immediately receives the full current
state of all IV lines. This prevents the client from showing an empty screen
while waiting for the next sensor tick:

```python
@router.websocket("/ws/telemetry")
async def telemetry_websocket(websocket: WebSocket):
    await manager.connect(websocket)
    # Push snapshot immediately on connect
    cache = get_latest_state_cache()
    if cache:
        await websocket.send_text(json.dumps({
            "type": "INITIAL_STATE",
            "data": list(cache.values())
        }))
```

---

## 10. Hardware Simulator

`simulator.py` generates realistic IV drip data for 4 mock beds when no
physical ESP32 hardware is connected.

### 10.1 Simulation Model

Each simulated bed has:
- An initial weight (partially filled bag)
- A prescribed drip rate
- A drain rate derived from that drip rate

Every tick (default: 3 seconds):
1. Weight decreases by `drain_rate × elapsed_seconds` plus Gaussian noise (±0.5g)
2. Cumulative drip count increases by `rate × elapsed_seconds` plus noise

### 10.2 Fault Injection

Every 90-300 seconds, the simulator randomly injects a fault into one bed:

- **no_flow** — drip count stops incrementing while weight continues draining.
  This simulates a kinked line or infiltration.
- **discrepancy** — weight drains faster than drops suggest.
  This simulates a sensor malfunction.

Faults last 20-45 seconds, then clear automatically. This tests the alarm
escalation and persistence filter logic continuously during development.

### 10.3 Mock Beds

| Sensor | Patient | Room | Fluid | Initial Fill |
|---|---|---|---|---|
| SENS-101 | Abebe Girma | 2A-01 | NS 0.9% | 920g (near full) |
| SENS-102 | Tigist Bekele | 2A-02 | D5W | 120g (nearly empty) |
| SENS-103 | Dawit Haile | 2B-01 | Lactated Ringer | 550g (half full) |
| SENS-104 | Meron Tadesse | 2B-02 | NS 0.9% | 380g (partial) |

Tigist Bekele starts nearly empty intentionally — this triggers the low-volume
advisory immediately so the alert system is visible from the first run.

---

## 11. Clinical UX Design

### 11.1 Colour System

The colour system is strict and unambiguous:

| Colour | Meaning | Hex Code |
|---|---|---|
| Green (#22c55e) | Flow Normal — no action needed | `Colors.status.normal` |
| Amber (#f59e0b) | Advisory — monitor closely | `Colors.status.advisory` |
| Orange (#f97316) | High Priority — line discrepancy | `Colors.status.high` |
| Red (#ef4444) | Critical — immediate action required | `Colors.status.critical` |
| Violet (#a78bfa) | Anomaly — sensor calibrating | `Colors.status.anomaly` |
| Dark background (#0f172a) | All screens | `Colors.bg.primary` |

These choices follow clinical display standards:
- **Dark background** reduces glare in brightly lit wards and reduces eye strain
  during long nursing shifts.
- **High contrast** ensures readability at a distance from a central monitor.
- **Red = danger** is a universal clinical convention — nurses are trained to
  respond to red immediately.

### 11.2 Design Tokens

All colours, font sizes, spacing, and border radii are defined as constants
in `constants/theme.ts`. This means:

- Changing the critical alarm colour requires editing ONE line in ONE file.
- No magic numbers appear in component code.
- The design is consistent across all screens automatically.

```typescript
// theme.ts — single source of truth
export const Colors = {
  status: {
    critical: '#ef4444',
    criticalBg: '#450a0a',
    criticalBorder: '#991b1b',
  }
}

// PatientCard.tsx — uses the token, not the hex code
borderTopColor: Colors.status.critical
```

### 11.3 Information Hierarchy

Each PatientCard is structured to deliver information in priority order,
top to bottom:

1. **Room / Bed** — WHERE is this patient?
2. **Patient Name** — WHO is this patient?
3. **Status Badge** — IS THERE A PROBLEM?
4. **Volume Bar** — HOW MUCH fluid is left?
5. **Flow / ETA / Rx Rate** — HOW IS IT FLOWING?
6. **Timestamp + Buttons** — WHEN was this last checked?

A nurse scanning the screen reads top-to-bottom and gets the most important
information first, with action buttons always at the bottom of each card.

### 11.4 Alarm Banner

The flashing red banner at the top of the dashboard uses an `Animated.loop`
that alternates opacity between 1.0 and 0.4 every 500ms:

```typescript
Animated.loop(
  Animated.sequence([
    Animated.timing(opacity, { toValue: 0.4, duration: 500 }),
    Animated.timing(opacity, { toValue: 1.0, duration: 500 }),
  ])
)
```

The wording is deliberately cautious: "No flow detected — assess IV line"
rather than "IV disconnected" — the system reports what it observes, not
a diagnosis. The nurse assesses and decides.

### 11.5 Responsive Grid

The dashboard uses a responsive column layout:

| Screen width | Columns | Cards visible |
|---|---|---|
| < 600px (phone) | 1 | 2-3 |
| 600px – 1100px (tablet/web) | 2 | 4-6 |
| > 1100px (desktop) | 3 | 6-9 |

This is implemented with React Native's `useWindowDimensions` hook:

```typescript
const { width } = useWindowDimensions();
const numColumns = width < 600 ? 1 : width < 1100 ? 2 : 3;
```

---

## 12. Syntax & Code Patterns

### 12.1 Python: Async/Await

The backend is fully asynchronous. This means it can handle many requests
simultaneously without blocking:

```python
# SYNCHRONOUS (blocking) — bad for a server
def get_patient(sensor_id: str):
    result = db.execute(query)   # waits here, nothing else can run
    return result

# ASYNCHRONOUS (non-blocking) — good for a server
async def get_patient(sensor_id: str):
    result = await db.execute(query)  # suspends here, other requests can run
    return result
```

The `await` keyword means "pause this coroutine and let other coroutines run
until this operation completes". This allows one server process to handle
thousands of WebSocket connections simultaneously.

### 12.2 Python: Dataclasses

The per-sensor fusion state uses a `@dataclass` decorator:

```python
@dataclass
class SensorState:
    drip_rate_buffer: Deque[float] = field(default_factory=lambda: deque(maxlen=8))
    prev_drip_count: Optional[int] = None
    alarm_acknowledged: bool = False
```

`@dataclass` automatically generates `__init__`, `__repr__`, and other methods.
`field(default_factory=...)` creates a new deque instance for each sensor —
without this, all sensors would share the same deque object.

### 12.3 Python: Type Annotations

```python
def process_payload(
    sensor_id: str,           # must be a string
    weight_grams: float,      # must be a float
    raw_drip_count: int,      # must be an integer
    timestamp: float,
    bag_size_ml: float,
    prescribed_rate_gtt_min: float,
) -> dict:                    # returns a dictionary
```

Type annotations in Python are not enforced at runtime (unlike TypeScript),
but they serve as documentation and are checked by type-checkers like mypy.

### 12.4 Python: Context Managers

The `asynccontextmanager` pattern is used for the application lifespan and
for database sessions:

```python
@asynccontextmanager
async def lifespan(app):
    await startup()   # runs once at server start
    yield             # server runs here
    await shutdown()  # runs once at server stop
```

```python
async def get_db():
    async with AsyncSessionLocal() as session:
        yield session   # gives the session to the route handler
    # session.close() is called automatically here
```

### 12.5 TypeScript: Interfaces

Interfaces define the shape of data objects:

```typescript
interface TelemetryState {
  sensor_id: string;
  patient_name: string;
  volume_ml: number;
  percentage: number;
  flow_status: FlowStatus;  // only valid FlowStatus values allowed
  alarm_priority: AlarmPriority;
}
```

### 12.6 TypeScript: Union Types

```typescript
// FlowStatus can ONLY be one of these exact strings — nothing else
type FlowStatus =
  | 'NORMAL'
  | 'ADVISORY'
  | 'CRITICAL'
  | 'HIGH_PRIORITY'
  | 'ANOMALY';
```

If any code tries to assign `'NORMALISH'` to a `FlowStatus`, TypeScript
reports a compile error immediately.

### 12.7 TypeScript: React Hooks

```typescript
// useWindowDimensions — React Native built-in hook
// Returns current screen width and height, re-renders when screen resizes
const { width } = useWindowDimensions();

// useState — local component state
const [refreshing, setRefreshing] = useState(false);

// useCallback — memoizes a function so it's not recreated on every render
const onRefresh = useCallback(async () => {
  setRefreshing(true);
  await fetchData();
  setRefreshing(false);
}, []);  // empty array = only created once
```

### 12.8 Pydantic: Automatic Validation

```python
class SensorPayload(BaseModel):
    sensorId: str = Field(..., example="SENS-104")
    weightGrams: float = Field(..., ge=0)  # ge=0 means "must be >= 0"
    rawDripCount: int = Field(..., ge=0)
    timestamp: int
```

When FastAPI receives a request, Pydantic automatically:
- Checks that all required fields are present
- Checks that each field is the correct type
- Checks constraints like `ge=0` (greater than or equal to zero)
- Returns a 422 Unprocessable Entity error with a clear message if anything fails

---

## 13. Data Flow: End to End

This section traces one complete cycle from hardware to screen.

### Step 1 — Sensor Reading (Hardware)

The ESP32 microcontroller reads:
- Load cell: 250 grams
- IR drip counter: 1420 cumulative drops

It sends an HTTP POST every 3 seconds:
```
POST http://server:8000/api/telemetry
{"sensorId":"SENS-104","weightGrams":250,"rawDripCount":1420,"timestamp":1776510000}
```

### Step 2 — Validation (FastAPI + Pydantic)

FastAPI receives the request. Pydantic checks the payload.
If `weightGrams` were a negative number, Pydantic would reject it here with
a 422 error. The payload passes validation.

### Step 3 — Metadata Lookup (Database)

```python
result = await db.execute(
    select(IVMetadata).where(IVMetadata.sensor_id == "SENS-104")
)
meta = result.scalars().first()
# meta.patient_name = "Meron Tadesse"
# meta.bag_size_ml = 500
# meta.prescribed_rate_gtt_min = 25
```

### Step 4 — Sensor Fusion (fusion_engine.py)

```
Previous reading:   weightGrams=253, rawDripCount=1415, timestamp=1776509997
Current reading:    weightGrams=250, rawDripCount=1420, timestamp=1776510000

Elapsed: 3 seconds
Drip delta: 1420 - 1415 = 5 drops
Instant rate: (5 drops / 3 seconds) × 60 = 100 gtt/min  ← seems high, moving avg smooths this
Moving average buffer: [95, 98, 97, 100, 96, 99, 98, 100]
Smoothed rate: 97.9 gtt/min

Volume: 250g - 20g tare = 230 mL remaining
Percentage: (230 / 500) × 100 = 46%

Classification: weight decreasing + normal drops → NORMAL
ETA: 230mL / (97.9 gtt/min ÷ 20) = 230 / 4.9 = 47 minutes → "~47m"
```

### Step 5 — Persistence Filter

Confirmed status: NORMAL (was already NORMAL, no change needed)

### Step 6 — Database Write

```sql
INSERT INTO telemetry_logs
(timestamp, sensor_id, volume_ml, percentage, drip_rate_gtt_min,
 flow_status, alarm_priority, eta_string, raw_weight_grams)
VALUES
('2026-08-19T10:00:00Z', 'SENS-104', 230.0, 46.0, 97.9,
 'NORMAL', 'NORMAL', '~47m', 250.0)
```

### Step 7 — WebSocket Broadcast

The server sends this JSON to every connected browser/app:

```json
{
  "type": "TELEMETRY_UPDATE",
  "data": {
    "sensor_id": "SENS-104",
    "iv_id": "IV-SIM-004",
    "patient_name": "Meron Tadesse",
    "room_bed": "2B-02",
    "fluid_name": "NS 0.9%",
    "volume_ml": 230.0,
    "percentage": 46.0,
    "drip_rate_gtt_min": 97.9,
    "flow_status": "NORMAL",
    "alarm_priority": "NORMAL",
    "eta_string": "~47m",
    "last_update": "2026-08-19T10:00:00Z"
  }
}
```

### Step 8 — Store Update (Zustand)

The WebSocket `onmessage` handler in `ivStore.ts` receives the message:

```typescript
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'TELEMETRY_UPDATE') {
    set({
      ivMap: { ...ivMap, [msg.data.sensor_id]: msg.data }
    });
  }
};
```

### Step 9 — React Re-render

The `PatientCard` component for Meron Tadesse reads the updated state and
re-renders. The volume bar moves from 47% to 46%. The ETA updates to ~47m.
This happens within milliseconds of the ESP32 sending the reading.

---

## 14. Running the System

### Backend

```bash
cd backend
bash run.sh
```

This script:
1. Creates a Python virtual environment in `.venv/`
2. Installs all dependencies from `requirements.txt`
3. Copies `.env.example` to `.env` on first run
4. Starts uvicorn on port 8000 with hot-reload enabled
5. Seeds 4 mock patient beds automatically
6. Starts the hardware simulator background task

**Available without PostgreSQL** — the system runs in in-memory mode
automatically when no database is reachable.

### Frontend

In a separate terminal:

```bash
# One-time setup
ulimit -n 65536           # Raise file watcher limit for this terminal session
cd frontend
npm install               # Install Node.js dependencies
npx expo install react-native-web react-dom @expo/metro-runtime  # Web support

# Start
npx expo start --web --clear
```

Browser opens automatically at `http://localhost:8081`.

### Connecting a Real ESP32

1. Flash the ESP32 with firmware that sends HTTP POST to `/api/telemetry`
2. Register the sensor using the "Register IV" button in the dashboard
3. Set `SIMULATOR_MODE=false` in `backend/.env`
4. Restart the backend

### Environment Variables (.env)

```
DATABASE_URL=postgresql+asyncpg://user:pass@host:5432/iv_monitor
SIMULATOR_MODE=true           # false to disable simulator
SIMULATOR_INTERVAL_SECONDS=3  # how often simulator sends readings
SECRET_KEY=change_me          # for future auth middleware
CORS_ORIGINS=["http://localhost:8081"]
```

---

*Documentation generated for INSA Smart IV Fluid Monitoring System — Version 1.0.0*
