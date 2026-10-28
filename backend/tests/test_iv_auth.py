"""
tests/test_iv_auth.py
=====================
Security tests for the IV management endpoints that were previously
unauthenticated:

  POST /api/iv/acknowledge
  POST /api/iv/new-bag
  POST /api/iv/register   (also secured in this fix)

Test matrix per endpoint:
  1. Unauthenticated request           → 401
  2. Invalid / expired token           → 401
  3. Nurse accessing unassigned bed    → 403
  4. Nurse accessing own assigned bed  → 200 / 201
  5. Admin accessing any bed           → 200 / 201
  6. Superadmin accessing any bed      → 200 / 201
"""

from __future__ import annotations

import asyncio
from datetime import datetime
from typing import AsyncGenerator

import pytest
import pytest_asyncio
from asgi_lifespan import LifespanManager
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.auth import create_access_token, hash_password
from app.database import Base, get_db
from app.models import IVMetadata, User

# ── In-memory SQLite test database ────────────────────────────────────────────

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"
_test_engine = create_async_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
_TestSession = async_sessionmaker(_test_engine, class_=AsyncSession, expire_on_commit=False)


async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
    async with _TestSession() as session:
        yield session


# ── Fixtures ───────────────────────────────────────────────────────────────────

@pytest_asyncio.fixture(scope="session")
def event_loop():
    """Use a single event loop for the entire session."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(scope="session", autouse=True)
async def setup_database():
    """Create tables once for the test session."""
    async with _test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with _test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture(scope="session")
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    async with _TestSession() as session:
        yield session


@pytest_asyncio.fixture(scope="session")
async def seed_data(db_session: AsyncSession):
    """
    Seed three users and one IV metadata row used across all tests.

    Users:
      nurse_own   — Nurse assigned to bed "2A-01"
      nurse_other — Nurse assigned to bed "3B-05" (different ward)
      admin_user  — Admin (no bed restriction)
      super_user  — Superadmin

    IV:
      IV-TEST-001  bed 2A-01  sensor SENS-TEST-001
    """
    users = [
        User(
            username="nurse_own",
            password_hash=hash_password("password"),
            role="Nurse",
            full_name="Nurse Own",
            staff_id="STF-001",
            assigned_ward="2A",
            assigned_beds=["2A-01"],
            active=True,
        ),
        User(
            username="nurse_other",
            password_hash=hash_password("password"),
            role="Nurse",
            full_name="Nurse Other",
            staff_id="STF-002",
            assigned_ward="3B",
            assigned_beds=["3B-05"],
            active=True,
        ),
        User(
            username="admin_user",
            password_hash=hash_password("password"),
            role="Admin",
            full_name="Admin User",
            staff_id="STF-ADM",
            assigned_ward=None,
            assigned_beds=[],
            active=True,
        ),
        User(
            username="super_user",
            password_hash=hash_password("password"),
            role="Superadmin",
            full_name="Super User",
            staff_id="STF-SUPER",
            assigned_ward=None,
            assigned_beds=[],
            active=True,
        ),
    ]
    for u in users:
        db_session.add(u)

    iv = IVMetadata(
        patient_id="PAT-TEST-001",
        patient_name="Test Patient",
        room_bed="2A-01",
        iv_id="IV-TEST-001",
        fluid_name="NS 0.9%",
        bag_size_ml=500.0,
        prescribed_rate_gtt_min=30.0,
        sensor_id="SENS-TEST-001",
        active=True,
        bed_status="ACTIVE",
        session_start=datetime.utcnow(),
    )
    db_session.add(iv)
    await db_session.commit()
    return {"iv_id": "IV-TEST-001", "sensor_id": "SENS-TEST-001"}


def _token(username: str, role: str) -> str:
    return create_access_token({"sub": username, "role": role, "tv": 1})


@pytest_asyncio.fixture(scope="session")
async def client(seed_data) -> AsyncGenerator[AsyncClient, None]:
    """
    Single AsyncClient wired to the FastAPI app with the DB dependency
    overridden to use the in-memory SQLite database.
    """
    # Import app after overriding settings to avoid real-DB connection
    import os
    os.environ.setdefault("SIMULATOR_MODE", "false")
    os.environ.setdefault("DATABASE_URL", TEST_DB_URL)

    from app.main import app
    app.dependency_overrides[get_db] = override_get_db

    # Bypass the full lifespan (no simulator, no real DB seed) so we don't need
    # PostgreSQL — we already seeded the SQLite DB above.
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()


# ── Helper: preload in-memory cache so fallback path is also exercised ─────────

def _preload_cache(iv_id: str, sensor_id: str, room_bed: str):
    """Push a minimal state entry into the live telemetry cache."""
    from app.routers.telemetry import get_latest_state_cache
    cache = get_latest_state_cache()
    cache[sensor_id] = {
        "sensor_id": sensor_id,
        "iv_id": iv_id,
        "patient_name": "Test Patient",
        "room_bed": room_bed,
        "fluid_name": "NS 0.9%",
        "bag_size_ml": 500.0,
        "volume_ml": 300.0,
        "percentage": 60.0,
        "drip_rate_gtt_min": 30.0,
        "raw_weight_grams": 320.0,
        "flow_status": "NORMAL",
        "alarm_priority": "CRITICAL",  # needs acknowledging
        "eta_string": "~10h 0m",
        "alarm_acknowledged": False,
        "last_update": datetime.utcnow().isoformat(),
        "prescribed_rate_gtt_min": 30.0,
    }


# ══════════════════════════════════════════════════════════════════════════════
# POST /api/iv/acknowledge
# ══════════════════════════════════════════════════════════════════════════════

class TestAcknowledge:

    async def test_unauthenticated_returns_401(self, client: AsyncClient):
        """No token → 401."""
        res = await client.post("/api/iv/acknowledge", json={"iv_id": "IV-TEST-001"})
        assert res.status_code == 401, res.text

    async def test_invalid_token_returns_401(self, client: AsyncClient):
        """Garbage token → 401."""
        res = await client.post(
            "/api/iv/acknowledge",
            json={"iv_id": "IV-TEST-001"},
            headers={"Authorization": "Bearer this.is.not.a.real.token"},
        )
        assert res.status_code == 401, res.text

    async def test_nurse_own_bed_returns_200(self, client: AsyncClient, seed_data):
        """Nurse assigned to 2A-01 CAN acknowledge IV on that bed."""
        _preload_cache(seed_data["iv_id"], seed_data["sensor_id"], "2A-01")
        token = _token("nurse_own", "Nurse")
        res = await client.post(
            "/api/iv/acknowledge",
            json={"iv_id": "IV-TEST-001", "nurse_notes": "Checked by nurse_own"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code == 200, res.text
        assert res.json()["success"] is True

    async def test_nurse_other_bed_returns_403(self, client: AsyncClient, seed_data):
        """Nurse assigned to 3B-05 CANNOT acknowledge IV on bed 2A-01."""
        _preload_cache(seed_data["iv_id"], seed_data["sensor_id"], "2A-01")
        token = _token("nurse_other", "Nurse")
        res = await client.post(
            "/api/iv/acknowledge",
            json={"iv_id": "IV-TEST-001"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code == 403, res.text
        assert "not assigned" in res.json()["detail"].lower()

    async def test_admin_can_acknowledge_any_bed(self, client: AsyncClient, seed_data):
        """Admin is not restricted by bed assignment."""
        _preload_cache(seed_data["iv_id"], seed_data["sensor_id"], "2A-01")
        token = _token("admin_user", "Admin")
        res = await client.post(
            "/api/iv/acknowledge",
            json={"iv_id": "IV-TEST-001"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code == 200, res.text

    async def test_superadmin_can_acknowledge_any_bed(self, client: AsyncClient, seed_data):
        """Superadmin is not restricted by bed assignment."""
        _preload_cache(seed_data["iv_id"], seed_data["sensor_id"], "2A-01")
        token = _token("super_user", "Superadmin")
        res = await client.post(
            "/api/iv/acknowledge",
            json={"iv_id": "IV-TEST-001"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code == 200, res.text

    async def test_nonexistent_iv_returns_404(self, client: AsyncClient):
        """IV that does not exist returns 404, not 500."""
        token = _token("nurse_own", "Nurse")
        res = await client.post(
            "/api/iv/acknowledge",
            json={"iv_id": "IV-DOES-NOT-EXIST"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code == 404, res.text


# ══════════════════════════════════════════════════════════════════════════════
# POST /api/iv/new-bag
# ══════════════════════════════════════════════════════════════════════════════

class TestNewBag:

    async def test_unauthenticated_returns_401(self, client: AsyncClient):
        """No token → 401."""
        res = await client.post(
            "/api/iv/new-bag",
            json={"iv_id": "IV-TEST-001", "new_bag_size_ml": 1000},
        )
        assert res.status_code == 401, res.text

    async def test_invalid_token_returns_401(self, client: AsyncClient):
        """Garbage token → 401."""
        res = await client.post(
            "/api/iv/new-bag",
            json={"iv_id": "IV-TEST-001", "new_bag_size_ml": 1000},
            headers={"Authorization": "Bearer bad.token.here"},
        )
        assert res.status_code == 401, res.text

    async def test_nurse_own_bed_returns_200(self, client: AsyncClient, seed_data):
        """Nurse assigned to 2A-01 CAN confirm a new bag on that bed."""
        _preload_cache(seed_data["iv_id"], seed_data["sensor_id"], "2A-01")
        token = _token("nurse_own", "Nurse")
        res = await client.post(
            "/api/iv/new-bag",
            json={"iv_id": "IV-TEST-001", "new_bag_size_ml": 1000.0},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code == 200, res.text
        assert res.json()["success"] is True

    async def test_nurse_other_bed_returns_403(self, client: AsyncClient, seed_data):
        """Nurse assigned to 3B-05 CANNOT confirm a new bag on bed 2A-01."""
        _preload_cache(seed_data["iv_id"], seed_data["sensor_id"], "2A-01")
        token = _token("nurse_other", "Nurse")
        res = await client.post(
            "/api/iv/new-bag",
            json={"iv_id": "IV-TEST-001", "new_bag_size_ml": 1000.0},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code == 403, res.text
        assert "not assigned" in res.json()["detail"].lower()

    async def test_admin_can_confirm_any_bed(self, client: AsyncClient, seed_data):
        """Admin is not restricted by bed assignment."""
        _preload_cache(seed_data["iv_id"], seed_data["sensor_id"], "2A-01")
        token = _token("admin_user", "Admin")
        res = await client.post(
            "/api/iv/new-bag",
            json={"iv_id": "IV-TEST-001", "new_bag_size_ml": 500.0},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code == 200, res.text

    async def test_superadmin_can_confirm_any_bed(self, client: AsyncClient, seed_data):
        """Superadmin is not restricted by bed assignment."""
        _preload_cache(seed_data["iv_id"], seed_data["sensor_id"], "2A-01")
        token = _token("super_user", "Superadmin")
        res = await client.post(
            "/api/iv/new-bag",
            json={"iv_id": "IV-TEST-001", "new_bag_size_ml": 500.0},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code == 200, res.text

    async def test_nonexistent_iv_returns_404(self, client: AsyncClient):
        """IV that does not exist returns 404."""
        token = _token("nurse_own", "Nurse")
        res = await client.post(
            "/api/iv/new-bag",
            json={"iv_id": "IV-DOES-NOT-EXIST", "new_bag_size_ml": 500.0},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code == 404, res.text


# ══════════════════════════════════════════════════════════════════════════════
# POST /api/iv/register
# ══════════════════════════════════════════════════════════════════════════════

class TestRegister:

    async def test_unauthenticated_returns_401(self, client: AsyncClient):
        """No token → 401."""
        res = await client.post("/api/iv/register", json={
            "patient_id": "PAT-X",
            "patient_name": "X",
            "room_bed": "2A-99",
            "iv_id": "IV-X-001",
            "fluid_name": "NS 0.9%",
            "bag_size_ml": 500,
            "prescribed_rate_gtt_min": 30,
            "sensor_id": "SENS-X-001",
        })
        assert res.status_code == 401, res.text

    async def test_authenticated_nurse_can_register(self, client: AsyncClient):
        """Any authenticated user (including Nurse) may register an IV line."""
        token = _token("nurse_own", "Nurse")
        res = await client.post(
            "/api/iv/register",
            json={
                "patient_id": "PAT-REG-001",
                "patient_name": "Registration Test",
                "room_bed": "2A-02",
                "iv_id": "IV-REG-001",
                "fluid_name": "D5W",
                "bag_size_ml": 500,
                "prescribed_rate_gtt_min": 20,
                "sensor_id": "SENS-REG-001",
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        # 201 = registered; 409 = conflict on re-run — both mean auth passed
        assert res.status_code in (201, 409), res.text
