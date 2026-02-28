"""Auth router — registration, login, token refresh, current user."""

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from ml_platform_core.dependencies import get_current_user, get_db
from ml_platform_core.models.user import User
from ml_platform_core.schemas.auth import (
    TokenRefreshRequest,
    TokenRefreshResponse,
    TokenResponse,
    UserLoginRequest,
    UserRegisterRequest,
    UserRegisterResponse,
    UserResponse,
)

from app.services.auth_service import AuthService

router = APIRouter()


@router.post(
    "/register",
    response_model=UserRegisterResponse,
    status_code=status.HTTP_201_CREATED,
)
async def register(body: UserRegisterRequest, db: AsyncSession = Depends(get_db)):
    """Register a new user account."""
    user = await AuthService.register(db, body)
    return user


@router.post("/login", response_model=TokenResponse)
async def login(body: UserLoginRequest, db: AsyncSession = Depends(get_db)):
    """Authenticate and receive access + refresh tokens."""
    return await AuthService.login(db, body)


@router.post("/refresh", response_model=TokenRefreshResponse)
async def refresh(body: TokenRefreshRequest):
    """Exchange a valid refresh token for a new access token."""
    return await AuthService.refresh_token(body)


@router.get("/me", response_model=UserResponse)
async def me(current_user: User = Depends(get_current_user)):
    """Return the currently authenticated user's profile."""
    return current_user
