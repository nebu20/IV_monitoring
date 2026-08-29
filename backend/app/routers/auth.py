"""
Auth Router
===========
POST /api/auth/login           — issue JWT
POST /api/auth/logout          — clear cookie
GET  /api/auth/me              — current user info
POST /api/auth/register        — create nurse/admin (role-restricted)
GET  /api/auth/users           — list all users (admin+)
PUT  /api/auth/users/:id/beds  — update assigned beds (admin+)
PUT  /api/users/profile        — update own profile (all users)
POST /api/users/change-password — change own password (all users)
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, List

from app.auth import (
    hash_password, verify_password, create_access_token,
    get_current_user, require_admin, require_superadmin, is_superadmin,
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
    assigned_ward: Optional[str] = None
    assigned_beds: List[str] = []


class UserResponse(BaseModel):
    id: int
    username: str
    role: str
    full_name: Optional[str]
    staff_id: Optional[str]
    assigned_ward: Optional[str]
    assigned_beds: List[str]


class ProfileUpdateRequest(BaseModel):
    full_name: Optional[str] = None
    staff_id: Optional[str] = None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


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

    token = create_access_token({"sub": user.username, "role": user.role})

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
        assigned_ward=current_user.assigned_ward,
        assigned_beds=current_user.assigned_beds or [],
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
        assigned_ward=user.assigned_ward,
        assigned_beds=user.assigned_beds or [],
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


@profile_router.post("/change-password")
async def change_password(
    body: ChangePasswordRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Any authenticated user can change their own password."""
    if not verify_password(body.current_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    if len(body.new_password) < 6:
        raise HTTPException(status_code=400, detail="New password must be at least 6 characters")

    current_user.password_hash = hash_password(body.new_password)
    await db.commit()
    return {"success": True, "message": "Password updated successfully"}
