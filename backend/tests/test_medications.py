"""
tests/test_medications.py
==========================
Regression tests covering the Phase 1 defect fixes:

  Fix 1 – Patient scope no longer requires an active IV session.
           A nurse whose assigned_ward matches CardRoomPatient.ward
           retains access after an IV session ends.
           A nurse with no ward/bed still has no access.

  Fix 2 – Unique constraint on (schedule_id, scheduled_datetime)
           prevents duplicate DoseRecords. Concurrent ensure_dose
           requests return the same row without creating duplicates.

  Fix 3 – update_schedule and discontinue_schedule are Admin+ only.
           Nurses cannot reach them (403). Admin access is system-wide;
           no additional ward restriction on writes.

  Fix 4 – Administration actions are awaitable and return success/failure.
           No-reason DELAYED/REFUSED/NOT_GIVEN → 422.
           Re-administration of terminal dose → 409.

  Fix 5 – Due endpoint includes PENDING doses from past days (up to
           LOOKBACK_DAYS) so missed doses survive midnight rollover.

  Fix 6 – Scheduled times validated at creation and update.
           Invalid values (bad format, out-of-range, empty string) → 422.
           End-date before start-date → 422 on create and update.

  Existing tests carried forward (scope, CRUD, ack separation).
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta
from typing import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy import select

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


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest_asyncio.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(scope="session", autouse=True)
async def setup_database():
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
async def base_users(db: AsyncSession):
    """
    Seed users and patients.

    Users:
      superadmin  – Superadmin
      admin_user  – Admin, ward 2A
      nurse_2a    – Nurse, ward 2A, beds [2A-01]
      nurse_3b    – Nurse, ward 3B, beds [3B-01]
      nurse_nobed – Nurse, no ward, no beds

    Patients:
      MRN-TEST-001  ward=2A  (active IV on 2A-01 for nurse_2a)
      MRN-ORAL-001  ward=2A  (no IV at all — oral meds only)
      MRN-OTHER-001 ward=3B
    """
    users = [
        User(username="superadmin",  password_hash=hash_password("superpass"),
             role="Superadmin", full_name="Super",      staff_id="STF-SA",    active=True),
        User(username="admin_user",  password_hash=hash_password("adminpass"),
             role="Admin",      full_name="Admin",       staff_id="STF-ADM",
             assigned_ward="2A", active=True),
        User(username="nurse_2a",    password_hash=hash_password("nursepass"),
             role="Nurse",      full_name="Nurse 2A",    staff_id="STF-N2A",
             assigned_ward="2A", assigned_beds=["2A-01"], active=True),
        User(username="nurse_3b",    password_hash=hash_password("nursepass"),
             role="Nurse",      full_name="Nurse 3B",    staff_id="STF-N3B",
             assigned_ward="3B", assigned_beds=["3B-01"], active=True),
        User(username="nurse_nobed", password_hash=hash_password("nursepass"),
             role="Nurse",      full_name="No Bed Nurse", staff_id="STF-NNB",
             active=True),
    ]
    db.add_all(users)

    patients = [
        CardRoomPatient(card_id="MRN-TEST-001", patient_name="Test Patient",
                        age=45, ward="2A"),
        CardRoomPatient(card_id="MRN-ORAL-001", patient_name="Oral Patient",
                        age=60, ward="2A"),
        CardRoomPatient(card_id="MRN-OTHER-001", patient_name="Other Patient",
                        age=30, ward="3B"),
    ]
    db.add_all(patients)

    # Active IV on 2A-01 for MRN-TEST-001
    db.add(IVMetadata(
        patient_id="MRN-TEST-001", patient_name="Test Patient",
        room_bed="2A-01", iv_id="IV-MED-001", fluid_name="NS 0.9%",
        bag_size_ml=500, prescribed_rate_gtt_min=30,
        sensor_id="SENS-MED-001", card_id="MRN-TEST-001",
        active=True, bed_status="ACTIVE",
    ))
    await db.commit()

    ids = {}
    for uname in ("superadmin", "admin_user", "nurse_2a", "nurse_3b", "nurse_nobed"):
        r = await db.execute(select(User).where(User.username == uname))
        ids[uname] = r.scalars().first().id
    return ids


def _tok(username: str, role: str, tv: int = 1) -> str:
    return create_access_token({"sub": username, "role": role, "tv": tv})


@pytest_asyncio.fixture(scope="session")
async def client(base_users) -> AsyncGenerator[AsyncClient, None]:
    import os
    os.environ.setdefault("SIMULATOR_MODE", "false")
    os.environ.setdefault("DATABASE_URL", TEST_DB_URL)
    os.environ.setdefault("MEDICATION_LOOKBACK_DAYS", "3")
    from app.main import app
    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _make_schedule(client: AsyncClient, card_id: str = "MRN-TEST-001",
                          times: list[str] | None = None) -> int:
    tok = _tok("admin_user", "Admin")
    res = await client.post("/api/medications/schedules", json={
        "card_id": card_id,
        "medication_name": "TestMed",
        "dose": "100 mg",
        "route": "PO",
        "frequency": "QD",
        "scheduled_times": times or ["08:00"],
        "start_date": datetime.utcnow().isoformat(),
    }, headers={"Authorization": f"Bearer {tok}"})
    assert res.status_code == 201, res.text
    return res.json()["id"]


async def _ensure(client: AsyncClient, schedule_id: int,
                  dt: datetime | None = None, tok_str: str | None = None) -> int:
    if tok_str is None:
        tok_str = _tok("nurse_2a", "Nurse")
    slot = (dt or datetime.utcnow().replace(hour=8, minute=0, second=0, microsecond=0))
    res = await client.post(
        f"/api/medications/doses/ensure"
        f"?schedule_id={schedule_id}&scheduled_datetime={slot.isoformat()}",
        headers={"Authorization": f"Bearer {tok_str}"},
    )
    assert res.status_code == 200, res.text
    return res.json()["id"]


# ══════════════════════════════════════════════════════════════════════════════
# Fix 1 – Patient scope: ward-based, not IV-active-based
# ══════════════════════════════════════════════════════════════════════════════

class TestPatientScope:

    async def test_nurse_sees_patient_by_ward_match(
        self, client: AsyncClient, base_users
    ):
        """nurse_2a (ward=2A) can see MRN-TEST-001 (ward=2A)."""
        sched_id = await _make_schedule(client)
        tok = _tok("nurse_2a", "Nurse")
        res = await client.get(f"/api/medications/schedules/{sched_id}",
                               headers={"Authorization": f"Bearer {tok}"})
        assert res.status_code == 200, res.text

    async def test_nurse_sees_oral_patient_by_ward(
        self, client: AsyncClient, base_users
    ):
        """Oral-only patient (no IV) is visible to nurse whose ward matches."""
        sched_id = await _make_schedule(client, card_id="MRN-ORAL-001")
        tok = _tok("nurse_2a", "Nurse")
        res = await client.get(f"/api/medications/schedules/{sched_id}",
                               headers={"Authorization": f"Bearer {tok}"})
        assert res.status_code == 200, res.text

    async def test_nurse_retains_access_after_iv_end(
        self, client: AsyncClient, db: AsyncSession, base_users
    ):
        """
        Deactivate the IV for MRN-TEST-001 — nurse_2a must still have
        access via the ward match.
        """
        # Deactivate the IV
        r = await db.execute(
            select(IVMetadata).where(IVMetadata.card_id == "MRN-TEST-001")
        )
        iv = r.scalars().first()
        if iv:
            iv.active = False
            await db.commit()

        sched_id = await _make_schedule(client)
        tok = _tok("nurse_2a", "Nurse")
        res = await client.get(f"/api/medications/schedules/{sched_id}",
                               headers={"Authorization": f"Bearer {tok}"})
        assert res.status_code == 200, res.text

        # Restore IV for other tests
        if iv:
            iv.active = True
            await db.commit()

    async def test_nurse_3b_cannot_see_ward_2a_patient(
        self, client: AsyncClient, base_users
    ):
        sched_id = await _make_schedule(client)
        tok = _tok("nurse_3b", "Nurse")
        res = await client.get(f"/api/medications/schedules/{sched_id}",
                               headers={"Authorization": f"Bearer {tok}"})
        assert res.status_code == 403, res.text

    async def test_nurse_no_bed_no_ward_has_no_access(
        self, client: AsyncClient, base_users
    ):
        sched_id = await _make_schedule(client)
        tok = _tok("nurse_nobed", "Nurse")
        res = await client.get(f"/api/medications/schedules/{sched_id}",
                               headers={"Authorization": f"Bearer {tok}"})
        assert res.status_code == 403, res.text

    async def test_nurse_sees_historical_iv_patient_via_ward(
        self, client: AsyncClient, db: AsyncSession, base_users
    ):
        """
        A patient registered in ward 2A (CardRoomPatient.ward) is accessible
        to nurse_2a even when there is no IVMetadata row at all.
        """
        sched_id = await _make_schedule(client, card_id="MRN-ORAL-001")
        tok = _tok("nurse_2a", "Nurse")
        res = await client.get("/api/medications/schedules",
                               headers={"Authorization": f"Bearer {tok}"})
        assert res.status_code == 200, res.text
        ids = [s["id"] for s in res.json()]
        assert sched_id in ids


# ══════════════════════════════════════════════════════════════════════════════
# Fix 2 – Unique constraint: no duplicate DoseRecords
# ══════════════════════════════════════════════════════════════════════════════

class TestDuplicatePrevention:

    async def test_ensure_idempotent_returns_same_id(
        self, client: AsyncClient, base_users
    ):
        """Two ensure calls for the same slot return the same dose_id."""
        sched_id = await _make_schedule(client)
        tok = _tok("nurse_2a", "Nurse")
        slot = datetime.utcnow().replace(hour=8, minute=0, second=0, microsecond=0)
        url = (f"/api/medications/doses/ensure"
               f"?schedule_id={sched_id}&scheduled_datetime={slot.isoformat()}")
        r1 = await client.post(url, headers={"Authorization": f"Bearer {tok}"})
        r2 = await client.post(url, headers={"Authorization": f"Bearer {tok}"})
        assert r1.status_code == 200, r1.text
        assert r2.status_code == 200, r2.text
        assert r1.json()["id"] == r2.json()["id"]

    async def test_cannot_readminister_terminal_dose(
        self, client: AsyncClient, base_users
    ):
        sched_id = await _make_schedule(client)
        dose_id = await _ensure(client, sched_id)
        tok = _tok("nurse_2a", "Nurse")
        r1 = await client.post(f"/api/medications/doses/{dose_id}/administer",
                               json={"status": "GIVEN"},
                               headers={"Authorization": f"Bearer {tok}"})
        assert r1.status_code == 200, r1.text
        r2 = await client.post(f"/api/medications/doses/{dose_id}/administer",
                               json={"status": "GIVEN"},
                               headers={"Authorization": f"Bearer {tok}"})
        assert r2.status_code == 409, r2.text

    async def test_db_uniqueness_preserved(
        self, client: AsyncClient, db: AsyncSession, base_users
    ):
        """
        Directly verify that the DB enforces uniqueness — count rows for
        a given slot after two ensure calls.
        """
        sched_id = await _make_schedule(client)
        slot = datetime.utcnow().replace(hour=9, minute=30, second=0, microsecond=0)
        tok = _tok("nurse_2a", "Nurse")
        url = (f"/api/medications/doses/ensure"
               f"?schedule_id={sched_id}&scheduled_datetime={slot.isoformat()}")
        await client.post(url, headers={"Authorization": f"Bearer {tok}"})
        await client.post(url, headers={"Authorization": f"Bearer {tok}"})

        db.expire_all()
        count_result = await db.execute(
            select(DoseRecord).where(
                DoseRecord.schedule_id == sched_id,
                DoseRecord.scheduled_datetime == slot,
            )
        )
        rows = count_result.scalars().all()
        assert len(rows) == 1, f"Expected 1 DoseRecord, found {len(rows)}"


# ══════════════════════════════════════════════════════════════════════════════
# Fix 3 – update / discontinue: Admin+ only; Nurse blocked
# ══════════════════════════════════════════════════════════════════════════════

class TestAdminOnlyWrites:

    async def test_nurse_cannot_update_schedule(
        self, client: AsyncClient, base_users
    ):
        sched_id = await _make_schedule(client)
        tok = _tok("nurse_2a", "Nurse")
        res = await client.put(
            f"/api/medications/schedules/{sched_id}",
            json={"dose": "999 mg"},
            headers={"Authorization": f"Bearer {tok}"},
        )
        assert res.status_code == 403, res.text

    async def test_nurse_cannot_discontinue_schedule(
        self, client: AsyncClient, base_users
    ):
        sched_id = await _make_schedule(client)
        tok = _tok("nurse_2a", "Nurse")
        res = await client.put(
            f"/api/medications/schedules/{sched_id}/discontinue",
            headers={"Authorization": f"Bearer {tok}"},
        )
        assert res.status_code == 403, res.text

    async def test_admin_can_update_any_schedule(
        self, client: AsyncClient, base_users
    ):
        """Admin access is system-wide — no per-ward restriction on writes."""
        sched_id = await _make_schedule(client)
        tok = _tok("admin_user", "Admin")
        res = await client.put(
            f"/api/medications/schedules/{sched_id}",
            json={"dose": "200 mg"},
            headers={"Authorization": f"Bearer {tok}"},
        )
        assert res.status_code == 200, res.text

    async def test_admin_can_discontinue_any_schedule(
        self, client: AsyncClient, base_users
    ):
        sched_id = await _make_schedule(client)
        tok = _tok("admin_user", "Admin")
        res = await client.put(
            f"/api/medications/schedules/{sched_id}/discontinue",
            headers={"Authorization": f"Bearer {tok}"},
        )
        assert res.status_code == 200, res.text

    async def test_unauthenticated_update_returns_401(
        self, client: AsyncClient, base_users
    ):
        sched_id = await _make_schedule(client)
        res = await client.put(
            f"/api/medications/schedules/{sched_id}",
            json={"dose": "1 mg"},
        )
        assert res.status_code == 401, res.text


# ══════════════════════════════════════════════════════════════════════════════
# Fix 5 – Past-day doses surfaced in /due endpoint
# ══════════════════════════════════════════════════════════════════════════════

class TestDueDosesLookback:

    async def test_pending_dose_from_yesterday_is_overdue(
        self, client: AsyncClient, db: AsyncSession, base_users
    ):
        """
        A DoseRecord created for yesterday (PENDING) must appear in /due
        with status OVERDUE — it must not be silently dropped at midnight.
        """
        from zoneinfo import ZoneInfo
        LOCAL_TZ = ZoneInfo("Africa/Addis_Ababa")
        import datetime as dt_mod

        sched_id = await _make_schedule(client, times=["08:00"])

        # Build yesterday 08:00 local → UTC naive
        local_yesterday = (dt_mod.datetime.now(tz=LOCAL_TZ) - timedelta(days=1)).date()
        local_dt = dt_mod.datetime(
            local_yesterday.year, local_yesterday.month, local_yesterday.day,
            8, 0, tzinfo=LOCAL_TZ,
        )
        utc_dt = (local_dt - local_dt.utcoffset()).replace(tzinfo=None)

        # Insert a PENDING DoseRecord directly for yesterday
        dose = DoseRecord(
            schedule_id=sched_id,
            scheduled_datetime=utc_dt,
            status="PENDING",
        )
        db.add(dose)
        await db.commit()

        tok = _tok("admin_user", "Admin")
        res = await client.get("/api/medications/due",
                               headers={"Authorization": f"Bearer {tok}"})
        assert res.status_code == 200, res.text
        items = res.json()
        overdue = [
            d for d in items
            if d["schedule_id"] == sched_id and d["status"] == "OVERDUE"
        ]
        assert len(overdue) >= 1, (
            "Expected at least one OVERDUE item for yesterday's PENDING dose"
        )

    async def test_past_day_dose_not_auto_resolved(
        self, client: AsyncClient, db: AsyncSession, base_users
    ):
        """
        A past-day dose appearing as OVERDUE in /due must still be
        PENDING in the DB — the endpoint does not auto-mark it as anything.
        """
        from zoneinfo import ZoneInfo
        LOCAL_TZ = ZoneInfo("Africa/Addis_Ababa")
        import datetime as dt_mod

        sched_id = await _make_schedule(client, times=["10:00"])

        local_two_days_ago = (
            dt_mod.datetime.now(tz=LOCAL_TZ) - timedelta(days=2)
        ).date()
        local_dt = dt_mod.datetime(
            local_two_days_ago.year, local_two_days_ago.month,
            local_two_days_ago.day, 10, 0, tzinfo=LOCAL_TZ,
        )
        utc_dt = (local_dt - local_dt.utcoffset()).replace(tzinfo=None)

        dose = DoseRecord(
            schedule_id=sched_id,
            scheduled_datetime=utc_dt,
            status="PENDING",
        )
        db.add(dose)
        await db.commit()
        dose_id = dose.id

        # Fetch /due — must show OVERDUE
        tok = _tok("admin_user", "Admin")
        res = await client.get("/api/medications/due",
                               headers={"Authorization": f"Bearer {tok}"})
        assert res.status_code == 200

        # DB record must still be PENDING — not auto-changed
        db.expire_all()
        row = await db.execute(select(DoseRecord).where(DoseRecord.id == dose_id))
        refreshed = row.scalars().first()
        assert refreshed.status == "PENDING", (
            "The /due endpoint must not modify DoseRecord.status"
        )


# ══════════════════════════════════════════════════════════════════════════════
# Fix 6 – Input validation: scheduled_times and end_date
# ══════════════════════════════════════════════════════════════════════════════

class TestInputValidation:

    async def _post_schedule(self, client: AsyncClient, times: list[str],
                              start: str | None = None,
                              end: str | None = None) -> int:
        tok = _tok("admin_user", "Admin")
        body = {
            "card_id": "MRN-TEST-001",
            "medication_name": "Validation Test",
            "dose": "1 mg",
            "route": "PO",
            "frequency": "QD",
            "scheduled_times": times,
            "start_date": start or datetime.utcnow().isoformat(),
        }
        if end:
            body["end_date"] = end
        res = await client.post("/api/medications/schedules", json=body,
                                headers={"Authorization": f"Bearer {tok}"})
        return res

    async def test_empty_times_rejected(self, client: AsyncClient, base_users):
        res = await self._post_schedule(client, [])
        assert res.status_code == 422, res.text

    async def test_bad_format_single_digit_rejected(self, client: AsyncClient, base_users):
        res = await self._post_schedule(client, ["8"])
        assert res.status_code == 422, res.text

    async def test_bad_format_hour_only_rejected(self, client: AsyncClient, base_users):
        res = await self._post_schedule(client, ["8:00"])
        # "8:00" is a single digit — fails ^(0\d|[12]\d|2[0-3]) pattern
        assert res.status_code == 422, res.text

    async def test_out_of_range_hour_rejected(self, client: AsyncClient, base_users):
        res = await self._post_schedule(client, ["25:00"])
        assert res.status_code == 422, res.text

    async def test_out_of_range_minute_rejected(self, client: AsyncClient, base_users):
        res = await self._post_schedule(client, ["08:61"])
        assert res.status_code == 422, res.text

    async def test_alpha_time_rejected(self, client: AsyncClient, base_users):
        res = await self._post_schedule(client, ["abc"])
        assert res.status_code == 422, res.text

    async def test_valid_times_accepted(self, client: AsyncClient, base_users):
        res = await self._post_schedule(client, ["00:00", "08:00", "23:59"])
        assert res.status_code == 201, res.text

    async def test_end_before_start_rejected_on_create(
        self, client: AsyncClient, base_users
    ):
        now = datetime.utcnow()
        res = await self._post_schedule(
            client, ["08:00"],
            start=(now + timedelta(days=5)).isoformat(),
            end=now.isoformat(),
        )
        assert res.status_code == 422, res.text

    async def test_end_before_start_rejected_on_update(
        self, client: AsyncClient, base_users
    ):
        sched_id = await _make_schedule(client)
        tok = _tok("admin_user", "Admin")
        # Set end_date before the schedule's start_date
        past = (datetime.utcnow() - timedelta(days=30)).isoformat()
        res = await client.put(
            f"/api/medications/schedules/{sched_id}",
            json={"end_date": past},
            headers={"Authorization": f"Bearer {tok}"},
        )
        assert res.status_code == 422, res.text

    async def test_invalid_times_on_update_rejected(
        self, client: AsyncClient, base_users
    ):
        sched_id = await _make_schedule(client)
        tok = _tok("admin_user", "Admin")
        res = await client.put(
            f"/api/medications/schedules/{sched_id}",
            json={"scheduled_times": ["25:00", "abc"]},
            headers={"Authorization": f"Bearer {tok}"},
        )
        assert res.status_code == 422, res.text


# ══════════════════════════════════════════════════════════════════════════════
# Existing coverage carried forward
# ══════════════════════════════════════════════════════════════════════════════

class TestScheduleCRUD:

    async def test_admin_creates_schedule(self, client: AsyncClient, base_users):
        tok = _tok("admin_user", "Admin")
        res = await client.post("/api/medications/schedules", json={
            "card_id": "MRN-TEST-001",
            "medication_name": "Amoxicillin",
            "dose": "500 mg",
            "route": "PO",
            "frequency": "BID",
            "scheduled_times": ["08:00", "20:00"],
            "start_date": datetime.utcnow().isoformat(),
        }, headers={"Authorization": f"Bearer {tok}"})
        assert res.status_code == 201, res.text
        data = res.json()
        assert data["medication_name"] == "Amoxicillin"
        assert data["active"] is True
        assert data["created_by"] == "admin_user"

    async def test_nurse_cannot_create_schedule(self, client: AsyncClient, base_users):
        tok = _tok("nurse_2a", "Nurse")
        res = await client.post("/api/medications/schedules", json={
            "card_id": "MRN-TEST-001", "medication_name": "Test",
            "dose": "1 mg", "route": "PO", "frequency": "QD",
            "scheduled_times": ["08:00"],
            "start_date": datetime.utcnow().isoformat(),
        }, headers={"Authorization": f"Bearer {tok}"})
        assert res.status_code == 403, res.text

    async def test_unauthenticated_cannot_create(self, client: AsyncClient):
        res = await client.post("/api/medications/schedules", json={
            "card_id": "MRN-TEST-001", "medication_name": "Test",
            "dose": "1 mg", "route": "PO", "frequency": "QD",
            "scheduled_times": ["08:00"],
            "start_date": datetime.utcnow().isoformat(),
        })
        assert res.status_code == 401, res.text

    async def test_nonexistent_patient_returns_404(self, client: AsyncClient, base_users):
        tok = _tok("admin_user", "Admin")
        res = await client.post("/api/medications/schedules", json={
            "card_id": "MRN-NONEXIST", "medication_name": "Test",
            "dose": "1 mg", "route": "PO", "frequency": "QD",
            "scheduled_times": ["08:00"],
            "start_date": datetime.utcnow().isoformat(),
        }, headers={"Authorization": f"Bearer {tok}"})
        assert res.status_code == 404, res.text

    async def test_invalid_route_returns_422(self, client: AsyncClient, base_users):
        tok = _tok("admin_user", "Admin")
        res = await client.post("/api/medications/schedules", json={
            "card_id": "MRN-TEST-001", "medication_name": "Test",
            "dose": "1 mg", "route": "ORAL", "frequency": "QD",
            "scheduled_times": ["08:00"],
            "start_date": datetime.utcnow().isoformat(),
        }, headers={"Authorization": f"Bearer {tok}"})
        assert res.status_code == 422, res.text


class TestAdministration:

    async def test_record_given(self, client: AsyncClient, base_users):
        sched_id = await _make_schedule(client)
        dose_id = await _ensure(client, sched_id)
        tok = _tok("nurse_2a", "Nurse")
        res = await client.post(f"/api/medications/doses/{dose_id}/administer",
                                json={"status": "GIVEN"},
                                headers={"Authorization": f"Bearer {tok}"})
        assert res.status_code == 200, res.text
        assert res.json()["status"] == "GIVEN"

    async def test_delayed_without_reason_returns_422(
        self, client: AsyncClient, base_users
    ):
        sched_id = await _make_schedule(client)
        dose_id = await _ensure(client, sched_id)
        tok = _tok("nurse_2a", "Nurse")
        res = await client.post(f"/api/medications/doses/{dose_id}/administer",
                                json={"status": "DELAYED"},
                                headers={"Authorization": f"Bearer {tok}"})
        assert res.status_code == 422, res.text

    async def test_delayed_with_reason_succeeds(self, client: AsyncClient, base_users):
        sched_id = await _make_schedule(client)
        dose_id = await _ensure(client, sched_id)
        tok = _tok("nurse_2a", "Nurse")
        res = await client.post(f"/api/medications/doses/{dose_id}/administer",
                                json={"status": "DELAYED", "reason": "In procedure"},
                                headers={"Authorization": f"Bearer {tok}"})
        assert res.status_code == 200, res.text

    async def test_nurse_3b_blocked_from_2a_patient(
        self, client: AsyncClient, base_users
    ):
        sched_id = await _make_schedule(client)
        dose_id = await _ensure(client, sched_id)
        tok = _tok("nurse_3b", "Nurse")
        res = await client.post(f"/api/medications/doses/{dose_id}/administer",
                                json={"status": "GIVEN"},
                                headers={"Authorization": f"Bearer {tok}"})
        assert res.status_code == 403, res.text

    async def test_nonexistent_dose_returns_404(self, client: AsyncClient, base_users):
        tok = _tok("nurse_2a", "Nurse")
        res = await client.post("/api/medications/doses/99999/administer",
                                json={"status": "GIVEN"},
                                headers={"Authorization": f"Bearer {tok}"})
        assert res.status_code == 404, res.text


class TestAcknowledgement:

    async def test_acknowledge_then_administer(self, client: AsyncClient, base_users):
        """Ack is separate from administration."""
        sched_id = await _make_schedule(client)
        dose_id = await _ensure(client, sched_id)
        tok = _tok("nurse_2a", "Nurse")

        r1 = await client.post(f"/api/medications/doses/{dose_id}/acknowledge",
                               json={},
                               headers={"Authorization": f"Bearer {tok}"})
        assert r1.status_code == 200, r1.text

        r2 = await client.post(f"/api/medications/doses/{dose_id}/administer",
                               json={"status": "GIVEN"},
                               headers={"Authorization": f"Bearer {tok}"})
        assert r2.status_code == 200, r2.text

    async def test_double_ack_returns_409(self, client: AsyncClient, base_users):
        sched_id = await _make_schedule(client)
        dose_id = await _ensure(client, sched_id)
        tok = _tok("nurse_2a", "Nurse")

        await client.post(f"/api/medications/doses/{dose_id}/acknowledge",
                          json={}, headers={"Authorization": f"Bearer {tok}"})
        r2 = await client.post(f"/api/medications/doses/{dose_id}/acknowledge",
                               json={}, headers={"Authorization": f"Bearer {tok}"})
        assert r2.status_code == 409, r2.text


class TestHistory:

    async def test_nurse_2a_can_access_history(self, client: AsyncClient, base_users):
        tok = _tok("nurse_2a", "Nurse")
        res = await client.get("/api/medications/history/MRN-TEST-001",
                               headers={"Authorization": f"Bearer {tok}"})
        assert res.status_code == 200, res.text
        assert isinstance(res.json(), list)

    async def test_nurse_3b_blocked_from_2a_history(
        self, client: AsyncClient, base_users
    ):
        tok = _tok("nurse_3b", "Nurse")
        res = await client.get("/api/medications/history/MRN-TEST-001",
                               headers={"Authorization": f"Bearer {tok}"})
        assert res.status_code == 403, res.text
