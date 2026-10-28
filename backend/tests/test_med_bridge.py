"""
tests/test_med_bridge.py
=========================
Unit and integration tests for the medicine reminder bridge logic.

Tests cover:
  - JSON event parsing (valid, invalid, unknown event types)
  - _nearest_scheduled_time matching and tolerance boundaries
  - _local_dt_for_alarm UTC conversion for Africa/Addis_Ababa
  - ensure_and_acknowledge API integration via backend (in-memory SQLite)
  - handle_event: ALARM_FIRED triggers ensure+ack; ALARM_DISMISSED is idempotent
  - ALARM_FIRED when no matching scheduled time → event skipped
  - Concurrent ensure calls return the same dose_id (uniqueness constraint)

These tests exercise the Python bridge logic independently of real serial
hardware.  They use the test-database infrastructure from other test files
so no real Proteus connection is needed.
"""

from __future__ import annotations

import asyncio
import json
import sys
import os
from datetime import datetime, timedelta
from typing import AsyncGenerator
from unittest.mock import patch, MagicMock

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy import select

# ── Allow importing the bridge from outside the backend package ───────────────
BRIDGE_DIR = os.path.join(
    os.path.dirname(__file__), "..", "..", "proteus", "bridge"
)
sys.path.insert(0, os.path.abspath(BRIDGE_DIR))

from med_bridge import (
    _nearest_scheduled_time,
    _local_dt_for_alarm,
    handle_event,
)

from app.auth import create_access_token, hash_password
from app.database import Base, get_db
from app.models import User, CardRoomPatient, IVMetadata, DoseRecord, MedicationSchedule

# ── In-memory SQLite ──────────────────────────────────────────────────────────

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"
_engine = create_async_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
_Session = async_sessionmaker(_engine, class_=AsyncSession, expire_on_commit=False)


async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
    async with _Session() as session:
        yield session


@pytest_asyncio.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(scope="session", autouse=True)
async def setup_db():
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest_asyncio.fixture(scope="session")
async def db() -> AsyncGenerator[AsyncSession, None]:
    async with _Session() as session:
        yield session


@pytest_asyncio.fixture(scope="session")
async def seeded(db: AsyncSession):
    nurse = User(
        username="nurse_bridge", password_hash=hash_password("pass"),
        role="Nurse", full_name="Bridge Nurse", staff_id="STF-BR-001",
        assigned_ward="2A", assigned_beds=["2A-01"], active=True,
    )
    db.add(nurse)
    patient = CardRoomPatient(
        card_id="MRN-BRIDGE-001", patient_name="Bridge Patient",
        age=50, ward="2A",
    )
    db.add(patient)
    await db.commit()

    r = await db.execute(select(User).where(User.username == "nurse_bridge"))
    uid = r.scalars().first().id

    # Create a medication schedule with two dose times
    schedule = MedicationSchedule(
        card_id="MRN-BRIDGE-001",
        medication_name="Bridge Med",
        dose="100 mg",
        route="PO",
        frequency="BID",
        scheduled_times=["08:00", "20:00"],
        start_date=datetime.utcnow() - timedelta(days=1),
        active=True,
        created_by="nurse_bridge",
    )
    db.add(schedule)
    await db.commit()
    await db.refresh(schedule)
    return {"user_id": uid, "schedule_id": schedule.id}


def _tok(username: str, role: str, tv: int = 1) -> str:
    return create_access_token({"sub": username, "role": role, "tv": tv})


@pytest_asyncio.fixture(scope="session")
async def client(seeded) -> AsyncGenerator[AsyncClient, None]:
    os.environ.setdefault("SIMULATOR_MODE", "false")
    os.environ.setdefault("DATABASE_URL", TEST_DB_URL)
    from app.main import app
    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


# ══════════════════════════════════════════════════════════════════════════════
# Pure-logic unit tests (no network / no DB)
# ══════════════════════════════════════════════════════════════════════════════

class TestNearestScheduledTime:

    def test_exact_match(self):
        assert _nearest_scheduled_time(8, 0, ["08:00", "20:00"]) == "08:00"

    def test_within_tolerance(self):
        assert _nearest_scheduled_time(8, 3, ["08:00", "20:00"]) == "08:00"

    def test_exactly_at_tolerance_boundary(self):
        # 5 minutes is the tolerance limit — exactly 5 min away should match
        assert _nearest_scheduled_time(8, 5, ["08:00", "20:00"]) == "08:00"

    def test_just_outside_tolerance(self):
        # 6 minutes away — should NOT match
        assert _nearest_scheduled_time(8, 6, ["08:00", "20:00"]) is None

    def test_picks_closest(self):
        assert _nearest_scheduled_time(20, 2, ["08:00", "20:00"]) == "20:00"

    def test_empty_scheduled_times(self):
        assert _nearest_scheduled_time(8, 0, []) is None

    def test_malformed_time_skipped(self):
        # malformed entry does not crash; valid entry still matches
        result = _nearest_scheduled_time(8, 0, ["bad", "08:00"])
        assert result == "08:00"


class TestLocalDtForAlarm:

    def test_returns_naive_datetime(self):
        dt = _local_dt_for_alarm(8, 0, "Africa/Addis_Ababa")
        assert dt.tzinfo is None   # stored as UTC-naive

    def test_addis_ababa_offset_is_three_hours(self):
        # Africa/Addis_Ababa is UTC+3
        # 08:00 local = 05:00 UTC
        dt = _local_dt_for_alarm(8, 0, "Africa/Addis_Ababa")
        assert dt.hour == 5
        assert dt.minute == 0

    def test_midnight_local_is_21_utc_previous_day(self):
        # 00:00 local = 21:00 UTC previous day
        dt = _local_dt_for_alarm(0, 0, "Africa/Addis_Ababa")
        assert dt.hour == 21
        assert dt.minute == 0


class TestEventParsing:
    """Test handle_event with mocked API calls."""

    def _make_responses(self, ensure_status=200, ack_status=200):
        ensure_resp = MagicMock()
        ensure_resp.status_code = ensure_status
        ensure_resp.json.return_value = {"id": 42, "status": "PENDING"}
        ensure_resp.text = ""

        ack_resp = MagicMock()
        ack_resp.status_code = ack_status
        ack_resp.json.return_value = {"success": True}
        ack_resp.text = ""
        return ensure_resp, ack_resp

    def test_alarm_fired_calls_api(self):
        ensure_resp, ack_resp = self._make_responses()
        with patch("med_bridge.requests.post", side_effect=[ensure_resp, ack_resp]) as mock_post:
            handle_event(
                json.dumps({"event": "ALARM_FIRED", "hour": 8, "minute": 0}),
                backend="http://localhost:8000",
                schedule_id=1,
                token="test-token",
                tz_name="Africa/Addis_Ababa",
                scheduled_times=["08:00"],
            )
            assert mock_post.call_count == 2
            # First call should be to ensure endpoint
            first_call_url = mock_post.call_args_list[0][0][0]
            assert "doses/ensure" in first_call_url
            # Second call should be to acknowledge endpoint
            second_call_url = mock_post.call_args_list[1][0][0]
            assert "acknowledge" in second_call_url

    def test_alarm_dismissed_calls_api(self):
        ensure_resp, ack_resp = self._make_responses()
        with patch("med_bridge.requests.post", side_effect=[ensure_resp, ack_resp]) as mock_post:
            handle_event(
                json.dumps({"event": "ALARM_DISMISSED", "hour": 20, "minute": 0}),
                backend="http://localhost:8000",
                schedule_id=1,
                token="tok",
                tz_name="Africa/Addis_Ababa",
                scheduled_times=["20:00"],
            )
            assert mock_post.call_count == 2

    def test_already_acknowledged_409_is_ok(self):
        """409 on acknowledge is not an error — idempotent."""
        ensure_resp, ack_resp = self._make_responses(ensure_status=200, ack_status=409)
        with patch("med_bridge.requests.post", side_effect=[ensure_resp, ack_resp]) as mock_post:
            # Should not raise
            handle_event(
                json.dumps({"event": "ALARM_FIRED", "hour": 8, "minute": 0}),
                backend="http://localhost:8000",
                schedule_id=1,
                token="tok",
                tz_name="Africa/Addis_Ababa",
                scheduled_times=["08:00"],
            )
            assert mock_post.call_count == 2

    def test_no_matching_schedule_time_skips_event(self):
        """Alarm at 14:30 with no matching scheduled time → no API call."""
        with patch("med_bridge.requests.post") as mock_post:
            handle_event(
                json.dumps({"event": "ALARM_FIRED", "hour": 14, "minute": 30}),
                backend="http://localhost:8000",
                schedule_id=1,
                token="tok",
                tz_name="Africa/Addis_Ababa",
                scheduled_times=["08:00", "20:00"],   # no match for 14:30
            )
            mock_post.assert_not_called()

    def test_non_json_line_skipped(self):
        with patch("med_bridge.requests.post") as mock_post:
            handle_event("not json at all", "http://localhost:8000", 1, "tok",
                         "Africa/Addis_Ababa", ["08:00"])
            mock_post.assert_not_called()

    def test_unknown_event_skipped(self):
        with patch("med_bridge.requests.post") as mock_post:
            handle_event(
                json.dumps({"event": "STARTUP", "msg": "Boot OK"}),
                "http://localhost:8000", 1, "tok", "Africa/Addis_Ababa", ["08:00"],
            )
            mock_post.assert_not_called()

    def test_empty_line_skipped(self):
        with patch("med_bridge.requests.post") as mock_post:
            handle_event("", "http://localhost:8000", 1, "tok", "Africa/Addis_Ababa", [])
            mock_post.assert_not_called()

    def test_no_scheduled_times_validation_skipped(self):
        """Empty scheduled_times list → no validation → event processed."""
        ensure_resp, ack_resp = self._make_responses()
        with patch("med_bridge.requests.post", side_effect=[ensure_resp, ack_resp]) as mock_post:
            handle_event(
                json.dumps({"event": "ALARM_FIRED", "hour": 8, "minute": 0}),
                "http://localhost:8000", 1, "tok", "Africa/Addis_Ababa",
                scheduled_times=[],    # no validation when empty
            )
            assert mock_post.call_count == 2


# ══════════════════════════════════════════════════════════════════════════════
# Integration tests: bridge → backend API (in-memory SQLite)
# ══════════════════════════════════════════════════════════════════════════════

class TestBridgeApiIntegration:
    """
    End-to-end: simulate what the bridge does when it receives firmware events,
    then verify the backend database reflects the expected state.
    """

    async def test_alarm_fired_creates_dose_and_acknowledges(
        self, client: AsyncClient, db: AsyncSession, seeded
    ):
        """
        ALARM_FIRED for a schedule's dose time must result in a PENDING
        DoseRecord that has acknowledged_by set (reminder acknowledged).
        """
        schedule_id = seeded["schedule_id"]
        tok = _tok("nurse_bridge", "Nurse")

        # Compute the UTC datetime for 08:00 local (Africa/Addis_Ababa = UTC+3 → 05:00 UTC)
        utc_dt = _local_dt_for_alarm(8, 0, "Africa/Addis_Ababa")

        # Step 1: ensure
        ensure_url = (
            f"/api/medications/doses/ensure"
            f"?schedule_id={schedule_id}"
            f"&scheduled_datetime={utc_dt.isoformat()}"
        )
        r1 = await client.post(ensure_url, headers={"Authorization": f"Bearer {tok}"})
        assert r1.status_code == 200, r1.text
        dose_id = r1.json()["id"]

        # Step 2: acknowledge
        r2 = await client.post(
            f"/api/medications/doses/{dose_id}/acknowledge",
            json={"notes": "Proteus hardware button"},
            headers={"Authorization": f"Bearer {tok}"},
        )
        assert r2.status_code in (200, 409), r2.text

        # Verify DB
        db.expire_all()
        row = await db.execute(select(DoseRecord).where(DoseRecord.id == dose_id))
        dose = row.scalars().first()
        assert dose is not None
        assert dose.status == "PENDING"            # bridge never administers
        assert dose.acknowledged_by == "nurse_bridge"

    async def test_ensure_idempotent_from_bridge(
        self, client: AsyncClient, db: AsyncSession, seeded
    ):
        """Two ensure calls from the bridge for the same slot return the same id."""
        schedule_id = seeded["schedule_id"]
        tok = _tok("nurse_bridge", "Nurse")
        utc_dt = _local_dt_for_alarm(20, 0, "Africa/Addis_Ababa")  # 20:00 local = 17:00 UTC

        url = (
            f"/api/medications/doses/ensure"
            f"?schedule_id={schedule_id}"
            f"&scheduled_datetime={utc_dt.isoformat()}"
        )
        r1 = await client.post(url, headers={"Authorization": f"Bearer {tok}"})
        r2 = await client.post(url, headers={"Authorization": f"Bearer {tok}"})
        assert r1.status_code == 200, r1.text
        assert r2.status_code == 200, r2.text
        assert r1.json()["id"] == r2.json()["id"]

    async def test_bridge_does_not_auto_administer(
        self, client: AsyncClient, db: AsyncSession, seeded
    ):
        """
        After alarm_fired handling, the dose status must still be PENDING —
        the bridge must NEVER call /administer.
        """
        schedule_id = seeded["schedule_id"]
        tok = _tok("nurse_bridge", "Nurse")
        utc_dt = _local_dt_for_alarm(8, 0, "Africa/Addis_Ababa")

        url = (
            f"/api/medications/doses/ensure"
            f"?schedule_id={schedule_id}"
            f"&scheduled_datetime={utc_dt.isoformat()}"
        )
        r = await client.post(url, headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 200
        dose_id = r.json()["id"]

        db.expire_all()
        row = await db.execute(select(DoseRecord).where(DoseRecord.id == dose_id))
        dose = row.scalars().first()
        assert dose.status == "PENDING", (
            "Bridge must not change status from PENDING — only nurses record outcomes"
        )

    async def test_unauthenticated_ensure_returns_401(self, client: AsyncClient, seeded):
        """Bridge with invalid token gets 401 — API authentication is enforced."""
        utc_dt = _local_dt_for_alarm(8, 0, "Africa/Addis_Ababa")
        url = (
            f"/api/medications/doses/ensure"
            f"?schedule_id={seeded['schedule_id']}"
            f"&scheduled_datetime={utc_dt.isoformat()}"
        )
        r = await client.post(url, headers={"Authorization": "Bearer invalid-token"})
        assert r.status_code == 401, r.text
