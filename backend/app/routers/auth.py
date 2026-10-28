"""
Auth Router
===========
POST /api/auth/login                       — issue JWT
POST /api/auth/logout                      — clear cookie
GET  /api/auth/me                          — current user info
POST /api/auth/register                    — create nurse/admin (role-restricted)
GET  /api/auth/users                       — list all users (admin+)
GET  /api/auth/users/all                   — list including inactive (superadmin only)
PUT  /api/auth/users/:id/beds              — update assigned beds (admin+)
POST /api/auth/users/:id/reset-password    — superadmin-only password reset
PUT  /api/auth/users/:id/deactivate        — superadmin-only deactivation
PUT  /api/auth/users/:id/reactivate        — superadmin-only reactivation
PUT  /api/auth/users/:id/role              — superadmin-only role change
PUT  /api/users/profile                    — update own profile (all users)
POST /api/users/change-password            — change own password (knows current)
POST /api/users/force-change-password      — change temporary password (no old pw needed)
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, List

from app.auth import (
    hash_password, verify_password, create_access_token,
    get_current_user, get_current_user_allow_force_change,
    require_admin, require_superadmin, is_superadmin,
)
from app.database import get_db
from app.models import User

router = APIRouter(prefix="/api/auth", tags=["Authentication"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    username: str
    password: str
    role: str = "Nurse"           # "Admin" (Ward Admin) | "Nurse"
    full_name: Optional[str] = None
    staff_id: Optional[str] = None
    license_id: Optional[str] = None   # RN / badge number — persisted on User
    assigned_ward: Optional[str] = None
    assigned_beds: List[str] = []


class UserResponse(BaseModel):
    id: int
    username: str
    role: str
    full_name: Optional[str]
    staff_id: Optional[str]
    license_id: Optional[str]
    assigned_ward: Optional[str]
    assigned_beds: List[str]
    must_change_password: bool = False


class ProfileUpdateRequest(BaseModel):
    full_name: Optional[str] = None
    staff_id: Optional[str] = None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class AdminResetPasswordRequest(BaseModel):
    """
    Superadmin-only: set a new password for another user.
    The new password must meet the same minimum-length policy as
    self-service password changes (≥ 8 characters — see password policy note).

    After reset, the target user's token_version is incremented (invalidating
    all existing sessions) and must_change_password is set True (blocking
    normal access until they use /api/users/force-change-password).
    """
    new_password: str


class ForceChangePasswordRequest(BaseModel):
    """
    Used when must_change_password is True.  Does not require the current
    (temporary) password — only the new password the user chooses.
    The caller must be authenticated (valid token for their account); the
    endpoint is open to anyone whose must_change_password flag is set.
    After success: must_change_password → False, token_version incremented,
    and a fresh token is returned so the user can continue without re-logging in.
    """
    new_password: str


class DeactivateRequest(BaseModel):
    reason: Optional[str] = None


class RoleChangeRequest(BaseModel):
    role: str  # "Nurse" | "Admin" | "Superadmin"


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/login")
async def login(
    response: Response,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(User).where(User.username == form_data.username, User.active == True)
    )
    user = result.scalars().first()

    if not user or not verify_password(form_data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect username or password")

    token_version = user.token_version if user.token_version is not None else 1
    token = create_access_token({
        "sub": user.username,
        "role": user.role,
        "tv": token_version,
    })

    response.set_cookie(
        key="access_token", value=token,
        httponly=True, samesite="lax", max_age=28800,
    )

    return {
        "access_token": token,
        "token_type": "bearer",
        "role": user.role,
        "username": user.username,
        "full_name": user.full_name,
        "staff_id": user.staff_id,
        "assigned_ward": user.assigned_ward,
        "assigned_beds": user.assigned_beds or [],
        "must_change_password": bool(user.must_change_password),
    }


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie("access_token")
    return {"message": "Logged out"}


@router.get("/me", response_model=UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    return UserResponse(
        id=current_user.id,
        username=current_user.username,
        role=current_user.role,
        full_name=current_user.full_name,
        staff_id=current_user.staff_id,
        license_id=current_user.license_id,
        assigned_ward=current_user.assigned_ward,
        assigned_beds=current_user.assigned_beds or [],
        must_change_password=bool(current_user.must_change_password),
    )


@router.post("/register", response_model=UserResponse, status_code=201)
async def register_user(
    body: RegisterRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Role creation rules:
    - Superadmin can create Admin (Ward Admin) or Nurse accounts.
    - Admin (Ward Admin) can only create Nurse accounts in their ward.
    - Nobody can create another Superadmin via the API.
    """
    # Prevent creating Superadmin via API
    if body.role == "Superadmin":
        raise HTTPException(
            status_code=403,
            detail="Superadmin accounts cannot be created via the API. Use the environment seed."
        )

    # Ward Admin can only create Nurses (not other Admins)
    if current_user.role == "Admin" and body.role == "Admin":
        raise HTTPException(
            status_code=403,
            detail="Ward Administrators cannot create other Admin accounts. Only the Superadmin can."
        )

    # Ward Admin can only create nurses in their own ward
    if current_user.role == "Admin" and body.assigned_ward:
        if current_user.assigned_ward and body.assigned_ward != current_user.assigned_ward:
            raise HTTPException(
                status_code=403,
                detail=f"Ward Admin for Ward {current_user.assigned_ward} cannot create accounts for Ward {body.assigned_ward}."
            )

    existing = await db.execute(select(User).where(User.username == body.username))
    if existing.scalars().first():
        raise HTTPException(status_code=409, detail="Username already exists")

    user = User(
        username=body.username,
        password_hash=hash_password(body.password),
        role=body.role,
        full_name=body.full_name,
        staff_id=body.staff_id,
        license_id=body.license_id,
        assigned_ward=body.assigned_ward,
        assigned_beds=body.assigned_beds if body.role == "Nurse" else [],
        active=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    return UserResponse(
        id=user.id,
        username=user.username,
        role=user.role,
        full_name=user.full_name,
        staff_id=user.staff_id,
        license_id=user.license_id,
        assigned_ward=user.assigned_ward,
        assigned_beds=user.assigned_beds or [],
        must_change_password=False,
    )


@router.get("/users")
async def list_users(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Superadmin sees all users.
    Ward Admin sees only nurses in their ward.
    """
    query = select(User).where(User.active == True)
    result = await db.execute(query)
    users = result.scalars().all()

    # Ward Admin filtering
    if current_user.role == "Admin":
        users = [u for u in users if u.assigned_ward == current_user.assigned_ward or u.id == current_user.id]

    return [
        {
            "id": u.id,
            "username": u.username,
            "role": u.role,
            "full_name": u.full_name,
            "staff_id": u.staff_id,
            "license_id": u.license_id,
            "assigned_ward": u.assigned_ward,
            "assigned_beds": u.assigned_beds or [],
        }
        for u in users
        if u.role != "Superadmin"  # Never expose Superadmin in listings
    ]


@router.put("/users/{user_id}/beds")
async def update_assigned_beds(
    user_id: int,
    body: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalars().first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Ward Admin can only update nurses in their ward
    if current_user.role == "Admin" and user.assigned_ward != current_user.assigned_ward:
        raise HTTPException(status_code=403, detail="Cannot modify users outside your ward")

    user.assigned_beds = body.get("assigned_beds", [])
    await db.commit()
    return {"success": True, "assigned_beds": user.assigned_beds}


@router.post("/users/{user_id}/reset-password", status_code=200)
async def admin_reset_password(
    user_id: int,
    body: AdminResetPasswordRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_superadmin),
):
    """
    Superadmin-only: reset any eligible user's password.

    Eligibility rules:
    - The target user must exist and be active.
    - A superadmin cannot reset their own password via this endpoint
      (use POST /api/users/change-password instead).
    - The target user must not be a Superadmin (prevents privilege
      escalation via the reset path).

    Token invalidation note:
    This endpoint sets a new bcrypt hash on the target user.  Any JWTs
    the target user holds before the reset remain cryptographically valid
    until they expire (default: 8 hours).  The User model does not
    currently have a token_version column, so server-side token
    revocation is not implemented.  The target user's next API call that
    reaches get_current_user will succeed if the JWT has not expired.
    Full token revocation requires adding a token_version column (Phase 2).
    """
    # Superadmin cannot reset their own password here
    if user_id == current_user.id:
        raise HTTPException(
            status_code=403,
            detail="Use POST /api/users/change-password to change your own password.",
        )

    result = await db.execute(select(User).where(User.id == user_id))
    target = result.scalars().first()

    if not target:
        raise HTTPException(status_code=404, detail=f"User {user_id} not found.")

    if not target.active:
        raise HTTPException(
            status_code=409,
            detail="Cannot reset password for a deactivated account.",
        )

    # Prevent resetting another superadmin's password
    if target.role == "Superadmin":
        raise HTTPException(
            status_code=403,
            detail="Superadmin passwords cannot be reset via this endpoint.",
        )

    # Enforce minimum password length
    if len(body.new_password) < 8:
        raise HTTPException(
            status_code=422,
            detail="Password must be at least 8 characters.",
        )

    # Increment token_version to invalidate all existing sessions
    current_ver = target.token_version if target.token_version is not None else 1
    target.token_version = current_ver + 1
    target.password_hash = hash_password(body.new_password)
    target.must_change_password = True
    await db.commit()

    # Never log or return the password or hash
    return {
        "success": True,
        "message": f"Password reset for user '{target.username}'. "
                   "Existing sessions have been invalidated. "
                   "The user must log in with the new password and complete "
                   "a forced password change via POST /api/users/force-change-password.",
        "username": target.username,
        "must_change_password": True,
    }


# ── Phase 2: Deactivation / Reactivation / Role Change ────────────────────────

VALID_ROLES = {"Nurse", "Admin", "Superadmin"}


async def _count_active_superadmins(db: AsyncSession) -> int:
    """Count active Superadmin accounts — used to protect the last one."""
    result = await db.execute(
        select(func.count()).select_from(User).where(
            User.role == "Superadmin", User.active == True
        )
    )
    return result.scalar() or 0


@router.get("/users/all")
async def list_all_users(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_superadmin),
):
    """
    Superadmin-only: list all users including deactivated accounts.
    Returns full audit info (active, deactivated_by, deactivated_at, reason).
    """
    result = await db.execute(select(User).order_by(User.id))
    users = result.scalars().all()

    return [
        {
            "id": u.id,
            "username": u.username,
            "role": u.role,
            "full_name": u.full_name,
            "staff_id": u.staff_id,
            "license_id": u.license_id,
            "assigned_ward": u.assigned_ward,
            "assigned_beds": u.assigned_beds or [],
            "active": u.active,
            "deactivated_by": u.deactivated_by,
            "deactivated_at": u.deactivated_at.isoformat() if u.deactivated_at else None,
            "deactivation_reason": u.deactivation_reason,
        }
        for u in users
        if u.role != "Superadmin" or current_user.role == "Superadmin"
    ]


@router.put("/users/{user_id}/deactivate")
async def deactivate_user(
    user_id: int,
    body: DeactivateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_superadmin),
):
    """
    Superadmin-only: deactivate a staff account.
    - Cannot deactivate yourself.
    - Cannot deactivate a Superadmin.
    - Cannot deactivate an already-inactive account.
    - Increments token_version to invalidate all existing sessions immediately.
    - Records who performed the deactivation, when, and an optional reason.
    - Does NOT delete the user or any clinical records.
    """
    from datetime import datetime

    if user_id == current_user.id:
        raise HTTPException(status_code=403, detail="You cannot deactivate your own account.")

    result = await db.execute(select(User).where(User.id == user_id))
    target = result.scalars().first()

    if not target:
        raise HTTPException(status_code=404, detail=f"User {user_id} not found.")

    if target.role == "Superadmin":
        raise HTTPException(status_code=403, detail="Superadmin accounts cannot be deactivated.")

    if not target.active:
        raise HTTPException(status_code=409, detail="Account is already deactivated.")

    current_ver = target.token_version if target.token_version is not None else 1
    target.active = False
    target.token_version = current_ver + 1
    target.deactivated_by = current_user.username
    target.deactivated_at = datetime.utcnow()
    target.deactivation_reason = body.reason
    await db.commit()

    return {
        "success": True,
        "message": f"Account '{target.username}' has been deactivated. "
                   "All existing sessions have been invalidated.",
        "username": target.username,
        "active": False,
    }


@router.put("/users/{user_id}/reactivate")
async def reactivate_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_superadmin),
):
    """
    Superadmin-only: reactivate a previously deactivated account.
    - Cannot reactivate yourself (you are already active).
    - Cannot reactivate a Superadmin (they cannot be deactivated in the first place).
    - Clears deactivation audit fields and increments token_version.
    - The user must log in again — old tokens are invalid.
    """
    if user_id == current_user.id:
        raise HTTPException(status_code=403, detail="Your account is already active.")

    result = await db.execute(select(User).where(User.id == user_id))
    target = result.scalars().first()

    if not target:
        raise HTTPException(status_code=404, detail=f"User {user_id} not found.")

    if target.role == "Superadmin":
        raise HTTPException(status_code=403, detail="Superadmin accounts cannot be managed via this endpoint.")

    if target.active:
        raise HTTPException(status_code=409, detail="Account is already active.")

    current_ver = target.token_version if target.token_version is not None else 1
    target.active = True
    target.token_version = current_ver + 1
    target.deactivated_by = None
    target.deactivated_at = None
    target.deactivation_reason = None
    await db.commit()

    return {
        "success": True,
        "message": f"Account '{target.username}' has been reactivated. "
                   "The user must log in again.",
        "username": target.username,
        "active": True,
    }


@router.put("/users/{user_id}/role")
async def change_user_role(
    user_id: int,
    body: RoleChangeRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_superadmin),
):
    """
    Superadmin-only: change a user's role.
    - Cannot change your own role.
    - Cannot change the role of a Superadmin (promotion/demotion of
      Superadmin is not permitted via the API for safety).
    - Cannot set role to an invalid value.
    - Prevents removing the last active Superadmin (if demoting a Superadmin
      would leave zero, reject — but Superadmin demotion is blocked anyway).
    - Increments token_version so existing sessions are invalidated;
      the user must re-login with their new role.
    """
    if user_id == current_user.id:
        raise HTTPException(status_code=403, detail="You cannot change your own role.")

    if body.role not in VALID_ROLES:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid role '{body.role}'. Valid roles: {', '.join(sorted(VALID_ROLES))}.",
        )

    result = await db.execute(select(User).where(User.id == user_id))
    target = result.scalars().first()

    if not target:
        raise HTTPException(status_code=404, detail=f"User {user_id} not found.")

    if target.role == "Superadmin":
        raise HTTPException(
            status_code=403,
            detail="Superadmin role cannot be changed via the API. "
                   "Superadmin accounts are managed via environment seed only.",
        )

    if body.role == "Superadmin":
        raise HTTPException(
            status_code=403,
            detail="Users cannot be promoted to Superadmin via the API. "
                   "Superadmin accounts are created via environment seed only.",
        )

    if target.role == body.role:
        raise HTTPException(status_code=409, detail=f"User is already a {body.role}.")

    # Increment token_version to invalidate existing sessions
    current_ver = target.token_version if target.token_version is not None else 1
    old_role = target.role
    target.role = body.role
    target.token_version = current_ver + 1
    # Clear assigned_beds if promoting to Admin (admins don't have bed assignments)
    if body.role == "Admin":
        target.assigned_beds = []
    await db.commit()

    return {
        "success": True,
        "message": f"Role changed from '{old_role}' to '{body.role}' for '{target.username}'. "
                   "Existing sessions have been invalidated.",
        "username": target.username,
        "old_role": old_role,
        "new_role": body.role,
    }


# ── Self-service profile endpoints ────────────────────────────────────────────

profile_router = APIRouter(prefix="/api/users", tags=["User Profile"])


@profile_router.put("/profile")
async def update_profile(
    body: ProfileUpdateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Any authenticated user can update their own full name and staff ID."""
    if body.full_name is not None:
        current_user.full_name = body.full_name
    if body.staff_id is not None:
        current_user.staff_id = body.staff_id
    await db.commit()
    return {
        "success": True,
        "full_name": current_user.full_name,
        "staff_id": current_user.staff_id,
    }


@profile_router.post("/force-change-password")
async def force_change_password(
    body: ForceChangePasswordRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user_allow_force_change),
):
    """
    Complete a forced password change after a superadmin reset.
    - Accessible only to users whose must_change_password flag is True.
    - Does not require the old (temporary) password.
    - After success: must_change_password → False, token_version incremented,
      fresh JWT returned so the user can continue without re-logging in.
    - A user whose must_change_password is False receives 403.
    - An ordinary Admin cannot use this on behalf of another user — they
      would need to be authenticated as that user, which they cannot do.
    """
    if not current_user.must_change_password:
        raise HTTPException(
            status_code=403,
            detail="No forced password change is pending for your account. "
                   "Use POST /api/users/change-password instead.",
        )

    if len(body.new_password) < 8:
        raise HTTPException(
            status_code=422,
            detail="Password must be at least 8 characters.",
        )

    # Increment token_version to invalidate the temporary-password token
    current_ver = current_user.token_version if current_user.token_version is not None else 1
    new_ver = current_ver + 1
    current_user.token_version = new_ver
    current_user.password_hash = hash_password(body.new_password)
    current_user.must_change_password = False
    await db.commit()

    # Issue a fresh token so the client does not need to re-login
    new_token = create_access_token({
        "sub": current_user.username,
        "role": current_user.role,
        "tv": new_ver,
    })
    response.set_cookie(
        key="access_token", value=new_token,
        httponly=True, samesite="lax", max_age=28800,
    )

    return {
        "success": True,
        "message": "Password changed successfully. Your session has been refreshed.",
        "access_token": new_token,
        "token_type": "bearer",
    }


@profile_router.post("/change-password")
async def change_password(
    body: ChangePasswordRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Any authenticated user can change their own password when they know the current one."""
    if not verify_password(body.current_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    if len(body.new_password) < 8:
        raise HTTPException(status_code=400, detail="New password must be at least 8 characters")

    # Increment token_version to invalidate other existing sessions
    current_ver = current_user.token_version if current_user.token_version is not None else 1
    new_ver = current_ver + 1
    current_user.token_version = new_ver
    current_user.password_hash = hash_password(body.new_password)
    await db.commit()

    # Issue a fresh token so the current session continues uninterrupted
    new_token = create_access_token({
        "sub": current_user.username,
        "role": current_user.role,
        "tv": new_ver,
    })
    response.set_cookie(
        key="access_token", value=new_token,
        httponly=True, samesite="lax", max_age=28800,
    )

    return {
        "success": True,
        "message": "Password updated successfully.",
        "access_token": new_token,
        "token_type": "bearer",
    }
