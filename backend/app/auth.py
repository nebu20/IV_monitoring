"""
JWT Authentication & Role-Based Access Control
===============================================
Role hierarchy (highest to lowest):
  Superadmin  — single root account, full system access
  Admin       — Ward Administrator, manages nurses in their ward
  Nurse       — bedside staff, sees only assigned beds
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from fastapi import Depends, HTTPException, status, Cookie
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.models import User

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 480  # 8-hour shift


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode["exp"] = expire
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=ALGORITHM)

def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )


# ── Role helpers ──────────────────────────────────────────────────────────────

def is_superadmin(user: User) -> bool:
    return user.role == "Superadmin"


def is_admin_or_above(user: User) -> bool:
    return user.role in ("Superadmin", "Admin")


# ── FastAPI Dependencies ───────────────────────────────────────────────────────

async def get_current_user(
    token: Optional[str] = Depends(oauth2_scheme),
    access_token: Optional[str] = Cookie(default=None),
    db: AsyncSession = Depends(get_db),
) -> User:
    raw_token = token or access_token
    if not raw_token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    payload = decode_token(raw_token)
    username: str = payload.get("sub", "")
    if not username:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    result = await db.execute(
        select(User).where(User.username == username, User.active == True)
    )
    user = result.scalars().first()
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")

    # Token-version check: reject tokens that lack a tv claim or carry a
    # stale version.  All tokens issued after Phase 1 hardening include tv,
    # so the absence of tv is itself a rejection signal.
    token_ver = payload.get("tv")
    user_ver = user.token_version if user.token_version is not None else 1
    if token_ver is None or token_ver != user_ver:
        raise HTTPException(
            status_code=401,
            detail="Session invalidated. Please log in again.",
        )

    # Force-change check: block normal endpoints if a password change is required.
    if user.must_change_password:
        raise HTTPException(
            status_code=403,
            detail="Password change required before accessing this resource. "
                   "Use POST /api/users/force-change-password.",
        )

    return user


async def get_current_user_allow_force_change(
    token: Optional[str] = Depends(oauth2_scheme),
    access_token: Optional[str] = Cookie(default=None),
    db: AsyncSession = Depends(get_db),
) -> User:
    """
    Like get_current_user but does NOT block users flagged for a forced
    password change.  Used only by the force-change-password endpoint itself
    so the user can authenticate and complete the required action.
    """
    raw_token = token or access_token
    if not raw_token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    payload = decode_token(raw_token)
    username: str = payload.get("sub", "")
    if not username:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    result = await db.execute(
        select(User).where(User.username == username, User.active == True)
    )
    user = result.scalars().first()
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")

    # Token-version check: same rule as get_current_user — tv is required.
    token_ver = payload.get("tv")
    user_ver = user.token_version if user.token_version is not None else 1
    if token_ver is None or token_ver != user_ver:
        raise HTTPException(
            status_code=401,
            detail="Session invalidated. Please log in again.",
        )

    return user


async def require_superadmin(current_user: User = Depends(get_current_user)) -> User:
    if not is_superadmin(current_user):
        raise HTTPException(status_code=403, detail="Superadmin access required")
    return current_user


async def require_admin(current_user: User = Depends(get_current_user)) -> User:
    """Allows Superadmin and Admin (Ward Administrator)."""
    if not is_admin_or_above(current_user):
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


async def require_nurse_or_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role not in ("Superadmin", "Admin", "Nurse"):
        raise HTTPException(status_code=403, detail="Access denied")
    return current_user
