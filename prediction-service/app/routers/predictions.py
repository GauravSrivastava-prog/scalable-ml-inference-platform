"""Predictions router — run inference, list/get predictions."""

from uuid import UUID

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession
from ml_platform_core.schemas.prediction import BatchPredictionRequest, BatchPredictionResponse
from ml_platform_core.dependencies import get_current_user, get_db
from ml_platform_core.models.user import User
from ml_platform_core.schemas.prediction import (
    PredictionDetailResponse,
    PredictionListResponse,
    PredictionRequest,
    PredictionResponse,
)

from app.services.prediction_service import PredictionService

router = APIRouter()


@router.post(
    "/predict",
    response_model=PredictionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def predict(
    body: PredictionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Run synchronous inference on a trained model."""
    return await PredictionService.predict(db, body, current_user)


@router.get("/", response_model=list[PredictionListResponse])
async def list_predictions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all predictions for the current user."""
    return await PredictionService.list_predictions(db, current_user)


@router.get("/{prediction_id}", response_model=PredictionDetailResponse)
async def get_prediction(
    prediction_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a specific prediction (ownership-scoped)."""
    return await PredictionService.get_prediction(db, prediction_id, current_user)

@router.post("/batch", response_model=BatchPredictionResponse)
async def batch_predict(
    request: BatchPredictionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):

    return await PredictionService.batch_predict(
        db=db,
        user=current_user,
        request=request,
    )