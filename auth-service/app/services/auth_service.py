"""Auth business logic — registration, authentication, token refresh."""

import logging
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ml_platform_core.exceptions import ConflictError
from ml_platform_core.models.user import User
from ml_platform_core.schemas.auth import (
    TokenRefreshRequest,
    TokenRefreshResponse,
    TokenResponse,
    UserLoginRequest,
    UserRegisterRequest,
)
from ml_platform_core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    get_password_hash,
    verify_password,
)

logger = logging.getLogger(__name__)


class AuthService:
    """Stateless service class for auth operations."""

    @staticmethod
    async def register(db: AsyncSession, data: UserRegisterRequest) -> User:
        """Register a new user. Raises ConflictError if email/username taken."""
        # Check for existing email
        result = await db.execute(select(User).where(User.email == data.email))
        if result.scalar_one_or_none() is not None:
            raise ConflictError("Email already registered")

        # Check for existing username
        result = await db.execute(select(User).where(User.username == data.username))
        if result.scalar_one_or_none() is not None:
            raise ConflictError("Username already taken")

        user = User(
            email=data.email,
            username=data.username,
            hashed_password=get_password_hash(data.password),
        )
        db.add(user)
        await db.flush()
        await db.refresh(user)

        logger.info(f"User registered: {user.email} (id={user.id})")
        return user

    @staticmethod
    async def login(db: AsyncSession, data: UserLoginRequest) -> TokenResponse:
        """Authenticate user and return JWT tokens."""
        result = await db.execute(select(User).where(User.email == data.email))
        user = result.scalar_one_or_none()

        if user is None or not verify_password(data.password, user.hashed_password):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password",
            )

        if not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Account is deactivated",
            )

        logger.info(f"User logged in: {user.email}")
        return TokenResponse(
            access_token=create_access_token(user.id),
            refresh_token=create_refresh_token(user.id),
        )

    @staticmethod
    async def refresh_token(data: TokenRefreshRequest) -> TokenRefreshResponse:
        """Validate refresh token and issue a new access token."""
        payload = decode_token(data.refresh_token)

        if payload is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired refresh token",
            )

        if payload.get("type") != "refresh":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token is not a refresh token",
            )

        user_id = payload.get("sub")
        if user_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token payload",
            )

        return TokenRefreshResponse(
            access_token=create_access_token(UUID(user_id)),
        )
