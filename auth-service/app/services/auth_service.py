"""Auth business logic — registration, authentication, token refresh."""

import logging
from uuid import UUID
from sqlalchemy import select, func, cast, Integer
from ml_platform_core.models.ml_model import MLModel
from ml_platform_core.models.prediction import Prediction
from ml_platform_core.models.user_analytics import UserAnalytics
from ml_platform_core.schemas.auth import UserStatsResponse, AlgorithmUsage
from fastapi import HTTPException, status

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
    
    @staticmethod
    async def get_user_stats(db: AsyncSession, user: User) -> UserStatsResponse:
        """Aggregate user telemetry for the profile dashboard."""
        
        # 1. Get the highly-optimized cache hits from our new table
        analytics_res = await db.execute(select(UserAnalytics).where(UserAnalytics.user_id == user.id))
        analytics = analytics_res.scalar_one_or_none()
        cache_hits = analytics.total_cache_hits if analytics else 0

        # 2. Get the Prediction stats (Volume and Latency)
        pred_query = select(
            func.count().label("total"),
            func.count().filter(Prediction.status == 'completed').label("successful"),
            func.coalesce(func.avg(Prediction.latency_ms).filter(Prediction.status == 'completed'), 0.0).label("avg_latency")
        ).where(Prediction.user_id == user.id)
        
        pred_stats = (await db.execute(pred_query)).one()
        avg_latency = float(pred_stats.avg_latency)

        # 3. Get the Model stats (Data processed)
        # We safely cast the JSON metrics to integers to sum them up directly in PostgreSQL
        models_query = select(
            func.coalesce(func.sum(
                cast(MLModel.metrics['train_size'].astext, Integer) + 
                cast(MLModel.metrics['test_size'].astext, Integer)
            ), 0).label("total_rows")
        ).where(MLModel.user_id == user.id, MLModel.status == 'ready')
        
        models_stats = (await db.execute(models_query)).one()

        # 4. THE SQL FIX: Get the Algorithm Matrix data by counting MODELS (Nodes), not Predictions
        algo_query = select(
            MLModel.algorithm, 
            func.count(MLModel.id).label("count")
        ).where(MLModel.user_id == user.id, MLModel.status == 'ready')\
         .group_by(MLModel.algorithm)
         
        algo_stats = (await db.execute(algo_query)).all()
        
        # Build the typed list
        algorithm_usage = [AlgorithmUsage(algorithm=r.algorithm, count=r.count) for r in algo_stats]

        # 5. THE MATH FIX: Sum the nodes directly from the array to guarantee UI alignment
        calculated_total_nodes = sum(item.count for item in algorithm_usage)

        # Calculate the flex metric: Time Saved
        compute_time_saved_ms = cache_hits * avg_latency

        return UserStatsResponse(
            total_predictions=pred_stats.total + cache_hits, 
            successful_predictions=pred_stats.successful,
            cache_hits=cache_hits,
            avg_latency_ms=round(avg_latency, 2),
            compute_time_saved_ms=round(compute_time_saved_ms, 2),
            total_data_rows_processed=models_stats.total_rows,
            total_models_trained=calculated_total_nodes,  # Using our guaranteed math fix
            algorithm_usage=algorithm_usage,
            member_since=user.created_at
        )