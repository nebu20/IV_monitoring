#!/usr/bin/env bash
# Quick-start script for the IV Monitor backend
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "==> Working directory: $SCRIPT_DIR"

# ── .env setup ──────────────────────────────────────────────────────────────
if [ ! -f .env ]; then
    cp .env.example .env
    echo "==> Created .env from .env.example"
    echo "    Review DATABASE_URL if you want PostgreSQL persistence."
    echo "    SIMULATOR_MODE=true is on by default — no DB required to start."
fi

# ── Python check ─────────────────────────────────────────────────────────────
echo "==> Checking Python version..."
python3 --version

# ── Virtual environment ───────────────────────────────────────────────────────
if [ ! -d .venv ]; then
    echo "==> Creating virtual environment (.venv)..."
    python3 -m venv .venv
    echo "==> Virtual environment created."
fi

echo "==> Activating virtual environment..."
source .venv/bin/activate

# ── Dependencies ──────────────────────────────────────────────────────────────
echo "==> Installing Python dependencies (this may take 1-2 minutes on first run)..."
pip install --upgrade pip --quiet
pip install -r requirements.txt

echo ""
echo "============================================================"
echo "  Smart IV Monitor — Backend Ready"
echo "============================================================"
echo "  REST API:    http://localhost:8000"
echo "  API Docs:    http://localhost:8000/docs"
echo "  WebSocket:   ws://localhost:8000/ws/telemetry"
echo "  Simulator:   ENABLED (4 mock beds generating live data)"
echo "============================================================"
echo ""
echo "  To use a real PostgreSQL DB, edit .env and set:"
echo "  DATABASE_URL=postgresql+asyncpg://user:pass@host:5432/dbname"
echo "  SIMULATOR_MODE=false"
echo ""
echo "  Press Ctrl+C to stop."
echo ""

uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
