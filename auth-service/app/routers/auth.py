"""Auth router — registration, login, token refresh, current user."""

from pydantic import BaseModel
from fastapi import APIRouter, Depends, status, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from ml_platform_core.schemas.auth import UserStatsResponse
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
class UpdateCredentialsRequest(BaseModel):
    current_password: str
    new_username: str | None = None
    new_password: str | None = None

@router.post("/update")
async def update_user_credentials(
    request: UpdateCredentialsRequest,
    current_user = Depends(get_current_user), # Standard auth dependency
    db_session = Depends(get_db)
):
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

@router.get("/me/stats")
async def get_user_stats(current_user = Depends(get_current_user), db_session = Depends(get_db)):
    
    # ... your existing logic to get predictions, cache hits, etc ...
    
    # 1. Fetch the exact breakdown of algorithms
    algo_query = await db_session.execute(
        text("SELECT algorithm, COUNT(*) as count FROM models WHERE user_id = :uid GROUP BY algorithm"),
        {"uid": current_user.id}
    )
    algorithm_usage = [{"algorithm": row.algorithm, "count": row.count} for row in algo_query]
    
    # 2. THE MATH FIX: Sum the active nodes directly from the array
    calculated_total_nodes = sum(item["count"] for item in algorithm_usage)
    
    return {
        "total_predictions": user_predictions_count, # from your existing logic
        "cache_hits": user_cache_hits,               # from your existing logic
        "total_data_rows_processed": user_data_rows, # from your existing logic
        "total_models_trained": calculated_total_nodes, # This guarantees the UI matches!
        "algorithm_usage": algorithm_usage,
    }

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
