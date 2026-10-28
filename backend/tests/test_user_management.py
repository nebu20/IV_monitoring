"""
tests/test_user_management.py
==============================
Phase 1 (license_id) + Phase 1 hardening (token-version, must_change_password).

Each stateful test class seeds its own dedicated users via a class-scoped
fixture so tests do not share mutable state.

Coverage:
  license_id
    - persisted at registration, returned in all user responses
    - omitted returns null
    - list_users includes license_id
    - get_me includes license_id
    - no response exposes password_hash

  password reset (superadmin-only)
    - superadmin resets nurse → 200, must_change_password=True, tv incremented
    - new password works, old password rejected
    - admin gets 403; unauthenticated gets 401
    - password < 8 chars → 422
    - nonexistent user → 404
    - superadmin cannot reset own password → 403
    - superadmin cannot reset another superadmin → 403
    - response never contains hash or plaintext

  token invalidation
    - old token (stale tv) rejected 401 after reset
    - no-tv token accepted (backward compat; version check skipped)
    - fresh token with correct tv accepted

  forced password change
    - normal endpoint blocked (403) when must_change_password=True
    - force-change endpoint accessible when flag set
    - force-change password < 8 → 422
    - force-change without pending flag → 403
    - after force-change: flag cleared, tv incremented, fresh token returned
    - old temp token rejected after force-change
    - fresh token from force-change accepted on normal endpoints

  self-service change-password (knows current password)
    - successful change increments tv, returns fresh token
    - old token rejected after change
    - wrong current password → 400
    - new password < 8 → 400
    - admin cannot change another user's password
"""

from __future__ import annotations

import asyncio
from typing import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy import select

from app.auth import create_access_token, hash_password, verify_password
from app.database import Base, get_db
from app.models import User

# ── Shared in-memory SQLite ───────────────────────────────────────────────────

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"
_engine = create_async_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
_Session = async_sessionmaker(_engine, class_=AsyncSession, expire_on_commit=False)


async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
    async with _Session() as session:
        yield session


# ── Session fixtures ──────────────────────────────────────────────────────────

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
async def client(setup_database) -> AsyncGenerator[AsyncClient, None]:
    import os
    os.environ.setdefault("SIMULATOR_MODE", "false")
    os.environ.setdefault("DATABASE_URL", TEST_DB_URL)
    from app.main import app
    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


# ── Base users seeded once ────────────────────────────────────────────────────

@pytest_asyncio.fixture(scope="session")
async def base_users(db: AsyncSession):
    """
    Seed a Superadmin and an Admin used by all tests.
    Returns their IDs.
    """
    sa = User(username="superadmin", password_hash=hash_password("superpass"),
              role="Superadmin", full_name="Super Admin", staff_id="STF-SUPER-01", active=True)
    adm = User(username="admin_user", password_hash=hash_password("adminpass"),
               role="Admin", full_name="Ward Admin", staff_id="STF-ADM-01",
               assigned_ward="2A", active=True)
    db.add_all([sa, adm])
    await db.commit()

    ids = {}
    for uname in ("superadmin", "admin_user"):
        r = await db.execute(select(User).where(User.username == uname))
        ids[uname] = r.scalars().first().id
    return ids


# ── Helpers ───────────────────────────────────────────────────────────────────

def _tok(username: str, role: str, tv: int = 1) -> str:
    return create_access_token({"sub": username, "role": role, "tv": tv})


def _tok_no_tv(username: str, role: str) -> str:
    return create_access_token({"sub": username, "role": role})


async def _fresh(db: AsyncSession, username: str) -> User:
    """Reload a user row, bypassing ORM cache."""
    db.expire_all()
    r = await db.execute(select(User).where(User.username == username))
    return r.scalars().first()


async def _add_user(db: AsyncSession, **kwargs) -> User:
    u = User(**kwargs)
    db.add(u)
    await db.commit()
    await db.refresh(u)
    return u


# ══════════════════════════════════════════════════════════════════════════════
# license_id
# ══════════════════════════════════════════════════════════════════════════════

class TestLicenseId:

    async def test_register_with_license_id_persists_and_returns(
        self, client: AsyncClient, base_users
    ):
        token = _tok("superadmin", "Superadmin")
        res = await client.post("/api/auth/register", json={
            "username": "lic_nurse_1", "password": "testpass11",
            "role": "Nurse", "full_name": "Licensed Nurse",
            "staff_id": "STF-L1", "license_id": "RN-12345",
        }, headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 201, res.text
        data = res.json()
        assert data["license_id"] == "RN-12345"
        assert "password_hash" not in data
        assert "password" not in data

    async def test_register_without_license_id_returns_null(
        self, client: AsyncClient, base_users
    ):
        token = _tok("superadmin", "Superadmin")
        res = await client.post("/api/auth/register", json={
            "username": "lic_nurse_2", "password": "testpass22",
            "role": "Nurse", "full_name": "Unlicensed", "staff_id": "STF-L2",
        }, headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 201, res.text
        assert res.json()["license_id"] is None

    async def test_list_users_includes_license_id(
        self, client: AsyncClient, db: AsyncSession, base_users
    ):
        # Register a nurse with a known license_id
        token = _tok("superadmin", "Superadmin")
        await client.post("/api/auth/register", json={
            "username": "lic_nurse_list", "password": "testpass33",
            "role": "Nurse", "full_name": "List Test", "staff_id": "STF-L3",
            "license_id": "RN-LIST-001",
        }, headers={"Authorization": f"Bearer {token}"})

        res = await client.get("/api/auth/users",
                               headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200, res.text
        users = res.json()
        for u in users:
            assert "license_id" in u
        target = next((u for u in users if u["username"] == "lic_nurse_list"), None)
        assert target is not None
        assert target["license_id"] == "RN-LIST-001"

    async def test_get_me_includes_license_id(
        self, client: AsyncClient, db: AsyncSession, base_users
    ):
        token = _tok("superadmin", "Superadmin")
        await client.post("/api/auth/register", json={
            "username": "lic_nurse_me", "password": "testpass44",
            "role": "Nurse", "full_name": "Me Test", "staff_id": "STF-L4",
            "license_id": "RN-ME-001",
        }, headers={"Authorization": f"Bearer {token}"})

        nurse = await _fresh(db, "lic_nurse_me")
        nurse_tok = _tok("lic_nurse_me", "Nurse", tv=nurse.token_version or 1)
        res = await client.get("/api/auth/me",
                               headers={"Authorization": f"Bearer {nurse_tok}"})
        assert res.status_code == 200, res.text
        assert res.json()["license_id"] == "RN-ME-001"

    async def test_no_response_contains_password_hash(
        self, client: AsyncClient, base_users
    ):
        token = _tok("superadmin", "Superadmin")
        res = await client.post("/api/auth/register", json={
            "username": "hash_check", "password": "secret9999",
            "role": "Nurse", "full_name": "Hash Check", "staff_id": "STF-HC",
        }, headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 201
        assert "password_hash" not in res.text
        assert "secret9999" not in res.text

        res = await client.get("/api/auth/users",
                               headers={"Authorization": f"Bearer {token}"})
        assert "password_hash" not in res.text


# ══════════════════════════════════════════════════════════════════════════════
# Password reset — each test uses a fresh dedicated nurse
# ══════════════════════════════════════════════════════════════════════════════

class TestAdminResetPassword:

    async def _reset_nurse(self, db: AsyncSession, suffix: str,
                           password: str = "initial99") -> User:
        return await _add_user(
            db, username=f"rst_{suffix}",
            password_hash=hash_password(password),
            role="Nurse", full_name=f"Reset {suffix}",
            staff_id=f"STF-RST-{suffix}", active=True,
        )

    async def test_superadmin_resets_returns_200_must_change_true(
        self, client: AsyncClient, db: AsyncSession, base_users
    ):
        nurse = await self._reset_nurse(db, "a")
        token = _tok("superadmin", "Superadmin")
        res = await client.post(
            f"/api/auth/users/{nurse.id}/reset-password",
            json={"new_password": "newpass999"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code == 200, res.text
        data = res.json()
        assert data["success"] is True
        assert data["must_change_password"] is True
        assert "password_hash" not in res.text
        assert "newpass999" not in res.text

    async def test_new_password_works_old_fails(
        self, client: AsyncClient, db: AsyncSession, base_users
    ):
        nurse = await self._reset_nurse(db, "b", password="oldpass99")
        sa_tok = _tok("superadmin", "Superadmin")
        await client.post(
            f"/api/auth/users/{nurse.id}/reset-password",
            json={"new_password": "brandnew9"},
            headers={"Authorization": f"Bearer {sa_tok}"},
        )
        refreshed = await _fresh(db, f"rst_b")
        assert verify_password("brandnew9", refreshed.password_hash) is True
        assert verify_password("oldpass99", refreshed.password_hash) is False

    async def test_token_version_incremented(
        self, client: AsyncClient, db: AsyncSession, base_users
    ):
        nurse = await self._reset_nurse(db, "c")
        tv_before = nurse.token_version or 1
        sa_tok = _tok("superadmin", "Superadmin")
        await client.post(
            f"/api/auth/users/{nurse.id}/reset-password",
            json={"new_password": "somepas99"},
            headers={"Authorization": f"Bearer {sa_tok}"},
        )
        refreshed = await _fresh(db, "rst_c")
        assert refreshed.token_version == tv_before + 1

    async def test_must_change_password_set(
        self, client: AsyncClient, db: AsyncSession, base_users
    ):
        nurse = await self._reset_nurse(db, "d")
        sa_tok = _tok("superadmin", "Superadmin")
        await client.post(
            f"/api/auth/users/{nurse.id}/reset-password",
            json={"new_password": "setflag99"},
            headers={"Authorization": f"Bearer {sa_tok}"},
        )
        refreshed = await _fresh(db, "rst_d")
        assert refreshed.must_change_password is True

    async def test_admin_cannot_reset_returns_403(
        self, client: AsyncClient, db: AsyncSession, base_users
    ):
        nurse = await self._reset_nurse(db, "e")
        token = _tok("admin_user", "Admin")
        res = await client.post(
            f"/api/auth/users/{nurse.id}/reset-password",
            json={"new_password": "shouldfail1"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code == 403, res.text

    async def test_unauthenticated_returns_401(
        self, client: AsyncClient, db: AsyncSession, base_users
    ):
        nurse = await self._reset_nurse(db, "f")
        res = await client.post(
            f"/api/auth/users/{nurse.id}/reset-password",
            json={"new_password": "shouldfail2"},
        )
        assert res.status_code == 401, res.text

    async def test_password_too_short_returns_422(
        self, client: AsyncClient, db: AsyncSession, base_users
    ):
        nurse = await self._reset_nurse(db, "g")
        token = _tok("superadmin", "Superadmin")
        res = await client.post(
            f"/api/auth/users/{nurse.id}/reset-password",
            json={"new_password": "abc"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code == 422, res.text

    async def test_nonexistent_user_returns_404(
        self, client: AsyncClient, base_users
    ):
        token = _tok("superadmin", "Superadmin")
        res = await client.post(
            "/api/auth/users/99999/reset-password",
            json={"new_password": "validpass1"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code == 404, res.text

    async def test_superadmin_cannot_reset_own_password(
        self, client: AsyncClient, base_users
    ):
        token = _tok("superadmin", "Superadmin")
        sa_id = base_users["superadmin"]
        res = await client.post(
            f"/api/auth/users/{sa_id}/reset-password",
            json={"new_password": "newpassword1"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code == 403, res.text
        assert "change-password" in res.json()["detail"].lower()

    async def test_superadmin_cannot_reset_another_superadmin(
        self, client: AsyncClient, db: AsyncSession, base_users
    ):
        second = await _add_user(
            db, username="second_super_x",
            password_hash=hash_password("s2secret1"),
            role="Superadmin", full_name="Second Super",
            staff_id="STF-SUPER-X", active=True,
        )
        token = _tok("superadmin", "Superadmin")
        res = await client.post(
            f"/api/auth/users/{second.id}/reset-password",
            json={"new_password": "newpassword2"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert res.status_code == 403, res.text


# ══════════════════════════════════════════════════════════════════════════════
# Token invalidation — dedicated nurse per test
# ══════════════════════════════════════════════════════════════════════════════

class TestTokenInvalidation:

    async def _make_reset_nurse(
        self, db: AsyncSession, client: AsyncClient, suffix: str,
        initial_pw: str = "initial99", new_pw: str = "temppass99"
    ) -> User:
        """Create a nurse and reset their password, returning refreshed user."""
        nurse = await _add_user(
            db, username=f"tv_{suffix}",
            password_hash=hash_password(initial_pw),
            role="Nurse", full_name=f"TV {suffix}",
            staff_id=f"STF-TV-{suffix}", active=True,
        )
        sa = _tok("superadmin", "Superadmin")
        await client.post(
            f"/api/auth/users/{nurse.id}/reset-password",
            json={"new_password": new_pw},
            headers={"Authorization": f"Bearer {sa}"},
        )
        return await _fresh(db, f"tv_{suffix}")

    async def test_old_token_rejected_after_reset(
        self, client: AsyncClient, db: AsyncSession, base_users
    ):
        """Token with stale tv=1 is rejected after reset increments tv to 2."""
        nurse = await self._make_reset_nurse(db, client, "rej")
        stale = _tok(nurse.username, "Nurse", tv=1)
        res = await client.get("/api/auth/me",
                               headers={"Authorization": f"Bearer {stale}"})
        assert res.status_code == 401, res.text
        assert "invalidated" in res.json()["detail"].lower()

    async def test_token_without_tv_rejected(
        self, client: AsyncClient, db: AsyncSession, base_users
    ):
        """
        Tokens without a tv claim are now rejected with 401 on all
        protected endpoints, including force-change-password.
        This closes the backward-compat gap where a pre-hardening token
        could bypass a password reset.
        """
        nurse = await self._make_reset_nurse(db, client, "compat")
        # nurse has must_change_password=True; token has no tv claim
        no_tv = _tok_no_tv(nurse.username, "Nurse")
        res = await client.post("/api/users/force-change-password",
                                json={"new_password": "sh"},
                                headers={"Authorization": f"Bearer {no_tv}"})
        assert res.status_code == 401, res.text
        assert "invalidated" in res.json()["detail"].lower()

    async def test_fresh_token_with_correct_tv_accepted(
        self, client: AsyncClient, db: AsyncSession, base_users
    ):
        """Token with tv matching current token_version is accepted."""
        nurse = await self._make_reset_nurse(db, client, "freshok")
        fresh = _tok(nurse.username, "Nurse", tv=nurse.token_version)
        # Same as above: force-change with short password → 422 confirms auth
        res = await client.post("/api/users/force-change-password",
                                json={"new_password": "sh"},
                                headers={"Authorization": f"Bearer {fresh}"})
        assert res.status_code == 422, res.text


# ══════════════════════════════════════════════════════════════════════════════
# Forced password change — each test uses a fresh nurse in reset state
# ══════════════════════════════════════════════════════════════════════════════

class TestForceChangePassword:

    async def _reset_nurse(
        self, db: AsyncSession, client: AsyncClient, suffix: str,
        initial_pw: str = "initial99", new_pw: str = "temppass99",
    ) -> User:
        nurse = await _add_user(
            db, username=f"fc_{suffix}",
            password_hash=hash_password(initial_pw),
            role="Nurse", full_name=f"FC {suffix}",
            staff_id=f"STF-FC-{suffix}", active=True,
        )
        sa = _tok("superadmin", "Superadmin")
        await client.post(
            f"/api/auth/users/{nurse.id}/reset-password",
            json={"new_password": new_pw},
            headers={"Authorization": f"Bearer {sa}"},
        )
        return await _fresh(db, f"fc_{suffix}")

    async def test_normal_endpoint_blocked_when_flag_set(
        self, client: AsyncClient, db: AsyncSession, base_users
    ):
        nurse = await self._reset_nurse(db, client, "blk")
        assert nurse.must_change_password is True
        tok = _tok(nurse.username, "Nurse", tv=nurse.token_version)
        res = await client.get("/api/auth/me",
                               headers={"Authorization": f"Bearer {tok}"})
        assert res.status_code == 403, res.text
        assert "force-change-password" in res.json()["detail"].lower()

    async def test_force_change_too_short_returns_422(
        self, client: AsyncClient, db: AsyncSession, base_users
    ):
        nurse = await self._reset_nurse(db, client, "short")
        tok = _tok(nurse.username, "Nurse", tv=nurse.token_version)
        res = await client.post("/api/users/force-change-password",
                                json={"new_password": "short"},
                                headers={"Authorization": f"Bearer {tok}"})
        assert res.status_code == 422, res.text

    async def test_force_change_without_flag_returns_403(
        self, client: AsyncClient, db: AsyncSession, base_users
    ):
        """User with must_change_password=False gets 403 on force-change."""
        admin = await _fresh(db, "admin_user")
        assert not admin.must_change_password
        tok = _tok("admin_user", "Admin", tv=admin.token_version or 1)
        res = await client.post("/api/users/force-change-password",
                                json={"new_password": "validpass99"},
                                headers={"Authorization": f"Bearer {tok}"})
        assert res.status_code == 403, res.text
        assert "change-password" in res.json()["detail"].lower()

    async def test_force_change_succeeds_clears_flag_returns_token(
        self, client: AsyncClient, db: AsyncSession, base_users
    ):
        nurse = await self._reset_nurse(db, client, "ok")
        tv_before = nurse.token_version
        tok = _tok(nurse.username, "Nurse", tv=tv_before)
        res = await client.post("/api/users/force-change-password",
                                json={"new_password": "mynewpass99"},
                                headers={"Authorization": f"Bearer {tok}"})
        assert res.status_code == 200, res.text
        data = res.json()
        assert data["success"] is True
        assert "access_token" in data
        assert "password_hash" not in res.text
        assert "mynewpass99" not in res.text

        refreshed = await _fresh(db, "fc_ok")
        assert refreshed.must_change_password is False
        assert refreshed.token_version == tv_before + 1

    async def test_old_temp_token_rejected_after_force_change(
        self, client: AsyncClient, db: AsyncSession, base_users
    ):
        nurse = await self._reset_nurse(db, client, "stale")
        tv_at_reset = nurse.token_version
        tok = _tok(nurse.username, "Nurse", tv=tv_at_reset)

        # Complete force-change
        res = await client.post("/api/users/force-change-password",
                                json={"new_password": "staletest99"},
                                headers={"Authorization": f"Bearer {tok}"})
        assert res.status_code == 200, res.text

        # The token used for force-change is now stale
        res2 = await client.get("/api/auth/me",
                                headers={"Authorization": f"Bearer {tok}"})
        assert res2.status_code == 401, res2.text

    async def test_fresh_token_after_force_change_works(
        self, client: AsyncClient, db: AsyncSession, base_users
    ):
        nurse = await self._reset_nurse(db, client, "fresh")
        tv_at_reset = nurse.token_version
        tok = _tok(nurse.username, "Nurse", tv=tv_at_reset)

        res = await client.post("/api/users/force-change-password",
                                json={"new_password": "freshpass99"},
                                headers={"Authorization": f"Bearer {tok}"})
        assert res.status_code == 200, res.text

        refreshed = await _fresh(db, "fc_fresh")
        new_tok = _tok(nurse.username, "Nurse", tv=refreshed.token_version)
        res2 = await client.get("/api/auth/me",
                                headers={"Authorization": f"Bearer {new_tok}"})
        assert res2.status_code == 200, res2.text
        assert res2.json()["must_change_password"] is False


# ══════════════════════════════════════════════════════════════════════════════
# Self-service change-password
# ══════════════════════════════════════════════════════════════════════════════

class TestSelfChangePassword:

    async def _make_nurse(
        self, db: AsyncSession, suffix: str, pw: str = "initial99"
    ) -> User:
        return await _add_user(
            db, username=f"sc_{suffix}",
            password_hash=hash_password(pw),
            role="Nurse", full_name=f"SC {suffix}",
            staff_id=f"STF-SC-{suffix}", active=True,
        )

    async def test_successful_change_returns_fresh_token_and_increments_tv(
        self, client: AsyncClient, db: AsyncSession, base_users
    ):
        nurse = await self._make_nurse(db, "ok", pw="currentp1")
        tv_before = nurse.token_version or 1
        tok = _tok(nurse.username, "Nurse", tv=tv_before)
        res = await client.post("/api/users/change-password",
                                json={"current_password": "currentp1",
                                      "new_password": "newself99"},
                                headers={"Authorization": f"Bearer {tok}"})
        assert res.status_code == 200, res.text
        data = res.json()
        assert data["success"] is True
        assert "access_token" in data
        assert "password_hash" not in res.text

        refreshed = await _fresh(db, "sc_ok")
        assert refreshed.token_version == tv_before + 1

    async def test_old_token_rejected_after_self_change(
        self, client: AsyncClient, db: AsyncSession, base_users
    ):
        nurse = await self._make_nurse(db, "stale2", pw="currentp2")
        tv = nurse.token_version or 1
        tok = _tok(nurse.username, "Nurse", tv=tv)
        await client.post("/api/users/change-password",
                          json={"current_password": "currentp2",
                                "new_password": "changedp2"},
                          headers={"Authorization": f"Bearer {tok}"})
        res = await client.get("/api/auth/me",
                               headers={"Authorization": f"Bearer {tok}"})
        assert res.status_code == 401, res.text

    async def test_wrong_current_password_returns_400(
        self, client: AsyncClient, db: AsyncSession, base_users
    ):
        nurse = await self._make_nurse(db, "wrongpw", pw="correctp3")
        tv = nurse.token_version or 1
        tok = _tok(nurse.username, "Nurse", tv=tv)
        res = await client.post("/api/users/change-password",
                                json={"current_password": "wrongpassword",
                                      "new_password": "validnew99"},
                                headers={"Authorization": f"Bearer {tok}"})
        assert res.status_code == 400, res.text

    async def test_new_password_too_short_returns_400(
        self, client: AsyncClient, db: AsyncSession, base_users
    ):
        nurse = await self._make_nurse(db, "shortpw", pw="currentp4")
        tv = nurse.token_version or 1
        tok = _tok(nurse.username, "Nurse", tv=tv)
        res = await client.post("/api/users/change-password",
                                json={"current_password": "currentp4",
                                      "new_password": "abc"},
                                headers={"Authorization": f"Bearer {tok}"})
        assert res.status_code == 400, res.text

    async def test_admin_cannot_change_another_users_password(
        self, client: AsyncClient, db: AsyncSession, base_users
    ):
        """change-password always acts on the authenticated user; wrong current pw → 400."""
        admin = await _fresh(db, "admin_user")
        tok = _tok("admin_user", "Admin", tv=admin.token_version or 1)
        res = await client.post("/api/users/change-password",
                                json={"current_password": "wrongpassword",
                                      "new_password": "hackedpass"},
                                headers={"Authorization": f"Bearer {tok}"})
        assert res.status_code == 400, res.text


# ══════════════════════════════════════════════════════════════════════════════
# Phase 2 — Deactivation / Reactivation / Role Change
# ══════════════════════════════════════════════════════════════════════════════

class TestDeactivation:
    """PUT /api/auth/users/{id}/deactivate"""

    async def _active_nurse(self, db: AsyncSession, suffix: str) -> User:
        return await _add_user(
            db, username=f"deact_{suffix}",
            password_hash=hash_password("testpass1"),
            role="Nurse", full_name=f"Deact {suffix}",
            staff_id=f"STF-D-{suffix}", active=True,
        )

    async def test_superadmin_deactivates_nurse(
        self, client: AsyncClient, db: AsyncSession, base_users
    ):
        nurse = await self._active_nurse(db, "ok")
        tv_before = nurse.token_version or 1
        sa = _tok("superadmin", "Superadmin")
        res = await client.put(
            f"/api/auth/users/{nurse.id}/deactivate",
            json={"reason": "Test deactivation"},
            headers={"Authorization": f"Bearer {sa}"},
        )
        assert res.status_code == 200, res.text
        assert res.json()["active"] is False

        refreshed = await _fresh(db, "deact_ok")
        assert refreshed.active is False
        assert refreshed.deactivated_by == "superadmin"
        assert refreshed.deactivated_at is not None
        assert refreshed.deactivation_reason == "Test deactivation"
        assert refreshed.token_version == tv_before + 1

    async def test_deactivated_user_cannot_login(
        self, client: AsyncClient, db: AsyncSession, base_users
    ):
        nurse = await self._active_nurse(db, "nologin")
        sa = _tok("superadmin", "Superadmin")
        await client.put(
            f"/api/auth/users/{nurse.id}/deactivate",
            json={},
            headers={"Authorization": f"Bearer {sa}"},
        )
        # Try to login — login checks active==True
        form = {"username": "deact_nologin", "password": "testpass1"}
        res = await client.post("/api/auth/login", data=form)
        assert res.status_code == 401, res.text

    async def test_existing_jwt_rejected_after_deactivation(
        self, client: AsyncClient, db: AsyncSession, base_users
    ):
        nurse = await self._active_nurse(db, "jwt")
        tv = nurse.token_version or 1
        old_token = _tok("deact_jwt", "Nurse", tv=tv)

        sa = _tok("superadmin", "Superadmin")
        await client.put(
            f"/api/auth/users/{nurse.id}/deactivate",
            json={},
            headers={"Authorization": f"Bearer {sa}"},
        )
        # Old token rejected — user.active is now False, get_current_user returns None
        res = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {old_token}"})
        assert res.status_code == 401, res.text

    async def test_admin_cannot_deactivate(
        self, client: AsyncClient, db: AsyncSession, base_users
    ):
        nurse = await self._active_nurse(db, "noadmin")
        tok = _tok("admin_user", "Admin")
        res = await client.put(
            f"/api/auth/users/{nurse.id}/deactivate",
            json={},
            headers={"Authorization": f"Bearer {tok}"},
        )
        assert res.status_code == 403, res.text

    async def test_superadmin_cannot_deactivate_self(
        self, client: AsyncClient, base_users
    ):
        sa = _tok("superadmin", "Superadmin")
        sa_id = base_users["superadmin"]
        res = await client.put(
            f"/api/auth/users/{sa_id}/deactivate",
            json={},
            headers={"Authorization": f"Bearer {sa}"},
        )
        assert res.status_code == 403, res.text

    async def test_cannot_deactivate_superadmin(
        self, client: AsyncClient, db: AsyncSession, base_users
    ):
        second_sa = await _add_user(
            db, username="second_sa_deact",
            password_hash=hash_password("s2pass1"),
            role="Superadmin", full_name="Second SA",
            staff_id="STF-SA2-DEACT", active=True,
        )
        sa = _tok("superadmin", "Superadmin")
        res = await client.put(
            f"/api/auth/users/{second_sa.id}/deactivate",
            json={},
            headers={"Authorization": f"Bearer {sa}"},
        )
        assert res.status_code == 403, res.text

    async def test_deactivating_already_inactive_returns_409(
        self, client: AsyncClient, db: AsyncSession, base_users
    ):
        nurse = await self._active_nurse(db, "alreadyinact")
        sa = _tok("superadmin", "Superadmin")
        # Deactivate once
        await client.put(f"/api/auth/users/{nurse.id}/deactivate",
                         json={}, headers={"Authorization": f"Bearer {sa}"})
        # Deactivate again
        res = await client.put(f"/api/auth/users/{nurse.id}/deactivate",
                               json={}, headers={"Authorization": f"Bearer {sa}"})
        assert res.status_code == 409, res.text

    async def test_deactivation_preserves_user_record(
        self, client: AsyncClient, db: AsyncSession, base_users
    ):
        """User row must not be deleted — only active flag changed."""
        nurse = await self._active_nurse(db, "preserve")
        sa = _tok("superadmin", "Superadmin")
        await client.put(f"/api/auth/users/{nurse.id}/deactivate",
                         json={}, headers={"Authorization": f"Bearer {sa}"})

        refreshed = await _fresh(db, "deact_preserve")
        assert refreshed is not None
        assert refreshed.username == "deact_preserve"
        assert refreshed.active is False


class TestReactivation:
    """PUT /api/auth/users/{id}/reactivate"""

    async def _inactive_nurse(self, db: AsyncSession, client: AsyncClient,
                              suffix: str) -> User:
        nurse = await _add_user(
            db, username=f"react_{suffix}",
            password_hash=hash_password("testpass1"),
            role="Nurse", full_name=f"React {suffix}",
            staff_id=f"STF-R-{suffix}", active=True,
        )
        sa = _tok("superadmin", "Superadmin")
        await client.put(
            f"/api/auth/users/{nurse.id}/deactivate",
            json={}, headers={"Authorization": f"Bearer {sa}"},
        )
        return await _fresh(db, f"react_{suffix}")

    async def test_superadmin_reactivates_nurse(
        self, client: AsyncClient, db: AsyncSession, base_users
    ):
        nurse = await self._inactive_nurse(db, client, "ok")
        sa = _tok("superadmin", "Superadmin")
        res = await client.put(
            f"/api/auth/users/{nurse.id}/reactivate",
            headers={"Authorization": f"Bearer {sa}"},
        )
        assert res.status_code == 200, res.text
        assert res.json()["active"] is True

        refreshed = await _fresh(db, "react_ok")
        assert refreshed.active is True
        assert refreshed.deactivated_by is None
        assert refreshed.deactivated_at is None

    async def test_admin_cannot_reactivate(
        self, client: AsyncClient, db: AsyncSession, base_users
    ):
        nurse = await self._inactive_nurse(db, client, "noadmin")
        tok = _tok("admin_user", "Admin")
        res = await client.put(
            f"/api/auth/users/{nurse.id}/reactivate",
            headers={"Authorization": f"Bearer {tok}"},
        )
        assert res.status_code == 403, res.text

    async def test_reactivating_already_active_returns_409(
        self, client: AsyncClient, db: AsyncSession, base_users
    ):
        nurse = await _add_user(
            db, username="react_already",
            password_hash=hash_password("testpass1"),
            role="Nurse", full_name="React Already",
            staff_id="STF-RA-001", active=True,
        )
        sa = _tok("superadmin", "Superadmin")
        res = await client.put(
            f"/api/auth/users/{nurse.id}/reactivate",
            headers={"Authorization": f"Bearer {sa}"},
        )
        assert res.status_code == 409, res.text

    async def test_old_token_still_invalid_after_reactivation(
        self, client: AsyncClient, db: AsyncSession, base_users
    ):
        """
        Reactivation increments token_version so the pre-deactivation token
        (and the deactivation-time token) remain invalid.  User must re-login.
        """
        nurse = await self._inactive_nurse(db, client, "stalereact")
        tv_before_deact = 1   # was 1 before deactivation
        pre_deact_token = _tok("react_stalereact", "Nurse", tv=tv_before_deact)

        sa = _tok("superadmin", "Superadmin")
        await client.put(
            f"/api/auth/users/{nurse.id}/reactivate",
            headers={"Authorization": f"Bearer {sa}"},
        )
        # Pre-deactivation token is still stale
        res = await client.get("/api/auth/me",
                               headers={"Authorization": f"Bearer {pre_deact_token}"})
        assert res.status_code == 401, res.text


class TestRoleChange:
    """PUT /api/auth/users/{id}/role"""

    async def _make_nurse(self, db: AsyncSession, suffix: str) -> User:
        return await _add_user(
            db, username=f"role_{suffix}",
            password_hash=hash_password("testpass1"),
            role="Nurse", full_name=f"Role {suffix}",
            staff_id=f"STF-RC-{suffix}", active=True,
        )

    async def _make_admin(self, db: AsyncSession, suffix: str) -> User:
        return await _add_user(
            db, username=f"radm_{suffix}",
            password_hash=hash_password("testpass1"),
            role="Admin", full_name=f"RAdm {suffix}",
            staff_id=f"STF-RA-{suffix}", active=True,
        )

    async def test_superadmin_promotes_nurse_to_admin(
        self, client: AsyncClient, db: AsyncSession, base_users
    ):
        nurse = await self._make_nurse(db, "promote")
        tv_before = nurse.token_version or 1
        sa = _tok("superadmin", "Superadmin")
        res = await client.put(
            f"/api/auth/users/{nurse.id}/role",
            json={"role": "Admin"},
            headers={"Authorization": f"Bearer {sa}"},
        )
        assert res.status_code == 200, res.text
        data = res.json()
        assert data["new_role"] == "Admin"
        assert data["old_role"] == "Nurse"

        refreshed = await _fresh(db, "role_promote")
        assert refreshed.role == "Admin"
        assert refreshed.token_version == tv_before + 1

    async def test_superadmin_demotes_admin_to_nurse(
        self, client: AsyncClient, db: AsyncSession, base_users
    ):
        adm = await self._make_admin(db, "demote")
        sa = _tok("superadmin", "Superadmin")
        res = await client.put(
            f"/api/auth/users/{adm.id}/role",
            json={"role": "Nurse"},
            headers={"Authorization": f"Bearer {sa}"},
        )
        assert res.status_code == 200, res.text
        refreshed = await _fresh(db, "radm_demote")
        assert refreshed.role == "Nurse"

    async def test_old_token_invalidated_after_role_change(
        self, client: AsyncClient, db: AsyncSession, base_users
    ):
        nurse = await self._make_nurse(db, "tvstale")
        tv = nurse.token_version or 1
        old_tok = _tok("role_tvstale", "Nurse", tv=tv)

        sa = _tok("superadmin", "Superadmin")
        await client.put(
            f"/api/auth/users/{nurse.id}/role",
            json={"role": "Admin"},
            headers={"Authorization": f"Bearer {sa}"},
        )
        res = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {old_tok}"})
        assert res.status_code == 401, res.text

    async def test_admin_cannot_change_role(
        self, client: AsyncClient, db: AsyncSession, base_users
    ):
        nurse = await self._make_nurse(db, "noadm")
        tok = _tok("admin_user", "Admin")
        res = await client.put(
            f"/api/auth/users/{nurse.id}/role",
            json={"role": "Admin"},
            headers={"Authorization": f"Bearer {tok}"},
        )
        assert res.status_code == 403, res.text

    async def test_superadmin_cannot_change_own_role(
        self, client: AsyncClient, base_users
    ):
        sa = _tok("superadmin", "Superadmin")
        sa_id = base_users["superadmin"]
        res = await client.put(
            f"/api/auth/users/{sa_id}/role",
            json={"role": "Admin"},
            headers={"Authorization": f"Bearer {sa}"},
        )
        assert res.status_code == 403, res.text

    async def test_cannot_change_role_of_superadmin(
        self, client: AsyncClient, db: AsyncSession, base_users
    ):
        second_sa = await _add_user(
            db, username="second_sa_role",
            password_hash=hash_password("s2pass2"),
            role="Superadmin", full_name="Second SA Role",
            staff_id="STF-SA2-ROLE", active=True,
        )
        sa = _tok("superadmin", "Superadmin")
        res = await client.put(
            f"/api/auth/users/{second_sa.id}/role",
            json={"role": "Admin"},
            headers={"Authorization": f"Bearer {sa}"},
        )
        assert res.status_code == 403, res.text

    async def test_cannot_promote_to_superadmin(
        self, client: AsyncClient, db: AsyncSession, base_users
    ):
        nurse = await self._make_nurse(db, "nosuperpromo")
        sa = _tok("superadmin", "Superadmin")
        res = await client.put(
            f"/api/auth/users/{nurse.id}/role",
            json={"role": "Superadmin"},
            headers={"Authorization": f"Bearer {sa}"},
        )
        assert res.status_code == 403, res.text

    async def test_invalid_role_returns_422(
        self, client: AsyncClient, db: AsyncSession, base_users
    ):
        nurse = await self._make_nurse(db, "invalidrole")
        sa = _tok("superadmin", "Superadmin")
        res = await client.put(
            f"/api/auth/users/{nurse.id}/role",
            json={"role": "Doctor"},
            headers={"Authorization": f"Bearer {sa}"},
        )
        assert res.status_code == 422, res.text

    async def test_same_role_returns_409(
        self, client: AsyncClient, db: AsyncSession, base_users
    ):
        nurse = await self._make_nurse(db, "samerole")
        sa = _tok("superadmin", "Superadmin")
        res = await client.put(
            f"/api/auth/users/{nurse.id}/role",
            json={"role": "Nurse"},
            headers={"Authorization": f"Bearer {sa}"},
        )
        assert res.status_code == 409, res.text

    async def test_nonexistent_user_returns_404(
        self, client: AsyncClient, base_users
    ):
        sa = _tok("superadmin", "Superadmin")
        res = await client.put(
            "/api/auth/users/999999/role",
            json={"role": "Nurse"},
            headers={"Authorization": f"Bearer {sa}"},
        )
        assert res.status_code == 404, res.text


class TestListAllUsers:
    """GET /api/auth/users/all"""

    async def test_superadmin_sees_inactive_users(
        self, client: AsyncClient, db: AsyncSession, base_users
    ):
        nurse = await _add_user(
            db, username="listall_nurse",
            password_hash=hash_password("testpass1"),
            role="Nurse", full_name="List All",
            staff_id="STF-LA-001", active=True,
        )
        # Deactivate
        sa = _tok("superadmin", "Superadmin")
        await client.put(
            f"/api/auth/users/{nurse.id}/deactivate",
            json={}, headers={"Authorization": f"Bearer {sa}"},
        )
        # Fetch all
        res = await client.get("/api/auth/users/all",
                               headers={"Authorization": f"Bearer {sa}"})
        assert res.status_code == 200, res.text
        all_users = res.json()
        deact = next((u for u in all_users if u["username"] == "listall_nurse"), None)
        assert deact is not None
        assert deact["active"] is False
        assert "deactivated_by" in deact

    async def test_admin_cannot_access_all_users(
        self, client: AsyncClient, base_users
    ):
        tok = _tok("admin_user", "Admin")
        res = await client.get("/api/auth/users/all",
                               headers={"Authorization": f"Bearer {tok}"})
        assert res.status_code == 403, res.text


class TestPhase2Regression:
    """Ensure Phase 1 features still work after Phase 2 changes."""

    async def test_password_reset_still_works(
        self, client: AsyncClient, db: AsyncSession, base_users
    ):
        nurse = await _add_user(
            db, username="reg_reset",
            password_hash=hash_password("oldpass99"),
            role="Nurse", full_name="Reg Reset",
            staff_id="STF-REG-001", active=True,
        )
        sa = _tok("superadmin", "Superadmin")
        res = await client.post(
            f"/api/auth/users/{nurse.id}/reset-password",
            json={"new_password": "newpass99"},
            headers={"Authorization": f"Bearer {sa}"},
        )
        assert res.status_code == 200, res.text
        assert res.json()["must_change_password"] is True

    async def test_legacy_jwt_still_rejected(
        self, client: AsyncClient, base_users
    ):
        """Tokens without tv claim are rejected — Phase 1 hardening intact."""
        no_tv = _tok_no_tv("admin_user", "Admin")
        res = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {no_tv}"})
        assert res.status_code == 401, res.text

    async def test_deactivated_user_force_change_rejected(
        self, client: AsyncClient, db: AsyncSession, base_users
    ):
        """
        A deactivated user's token should be rejected even on the
        force-change endpoint — active==False causes get_current_user
        to return None (401).
        """
        nurse = await _add_user(
            db, username="deact_fcp",
            password_hash=hash_password("testpass1"),
            role="Nurse", full_name="Deact FCP",
            staff_id="STF-DFCP-001", active=True,
        )
        tv = nurse.token_version or 1
        nurse_tok = _tok("deact_fcp", "Nurse", tv=tv)

        sa = _tok("superadmin", "Superadmin")
        await client.put(
            f"/api/auth/users/{nurse.id}/deactivate",
            json={}, headers={"Authorization": f"Bearer {sa}"},
        )
        res = await client.post(
            "/api/users/force-change-password",
            json={"new_password": "newpass99"},
            headers={"Authorization": f"Bearer {nurse_tok}"},
        )
        assert res.status_code == 401, res.text
