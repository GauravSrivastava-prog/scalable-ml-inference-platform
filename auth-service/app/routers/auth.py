"""Auth router — registration, login, token refresh, current user."""

from pydantic import BaseModel
from fastapi import APIRouter, Depends, status, HTTPException
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
    UserStatsResponse,
)

# ✅ FIX 1: Import your password hashing utilities! 
# (Adjust this import path if your security functions live somewhere else)
from ml_platform_core.security import verify_password, get_password_hash

from app.services.auth_service import AuthService

router = APIRouter()

class UpdateCredentialsRequest(BaseModel):
    current_password: str
    new_username: str | None = None
    new_password: str | None = None


@router.post("/update")
async def update_user_credentials(
    request: UpdateCredentialsRequest,
    current_user: User = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db)
):
    """Securely update username or password."""
    # 1. Verify the current password is correct
    if not verify_password(request.current_password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Current password is incorrect."
        )
    
    # 2. Update properties if provided
    if request.new_username:
        current_user.username = request.new_username
        
    if request.new_password:
        current_user.hashed_password = get_password_hash(request.new_password)
        
    db_session.add(current_user)
    await db_session.commit()
    
    return {"message": "Credentials updated successfully"}


@router.get(
    "/me/stats", 
    response_model=UserStatsResponse,
    status_code=status.HTTP_200_OK
)
async def get_my_stats(
    current_user: User = Depends(get_current_user), 
    db: AsyncSession = Depends(get_db)
):
    """Get aggregated analytics for the user's profile dashboard."""
    # We defer the logic to your clean service layer
    return await AuthService.get_user_stats(db, current_user)


@router.post("/register", response_model=UserRegisterResponse, status_code=status.HTTP_201_CREATED)
async def register(body: UserRegisterRequest, db: AsyncSession = Depends(get_db)):
    return await AuthService.register(db, body)

@router.post("/login", response_model=TokenResponse)
async def login(body: UserLoginRequest, db: AsyncSession = Depends(get_db)):
    return await AuthService.login(db, body)

@router.post("/refresh", response_model=TokenRefreshResponse)
async def refresh(body: TokenRefreshRequest):
    return await AuthService.refresh_token(body)

@router.get("/me", response_model=UserResponse)
async def me(current_user: User = Depends(get_current_user)):
    return current_user