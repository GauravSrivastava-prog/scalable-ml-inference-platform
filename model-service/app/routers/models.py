"""Models router — dataset upload, training, model listing."""

from uuid import UUID

from fastapi import APIRouter, Depends, UploadFile, File, status
from sqlalchemy.ext.asyncio import AsyncSession

from ml_platform_core.dependencies import get_current_user, get_db
from ml_platform_core.models.user import User
from ml_platform_core.schemas.model import (
    DatasetUploadResponse,
    ModelListResponse,
    ModelResponse,
    ModelTrainRequest,
    ModelTrainResponse,
)

from app.services.model_service import ModelService

router = APIRouter()


@router.post(
    "/upload-dataset",
    response_model=DatasetUploadResponse,
    status_code=status.HTTP_201_CREATED,
)
async def upload_dataset(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Upload a CSV dataset for training."""
    return await ModelService.upload_dataset(file, current_user)


@router.post(
    "/train",
    response_model=ModelTrainResponse,
    status_code=status.HTTP_201_CREATED,
)
async def train_model(
    body: ModelTrainRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Train a model on an uploaded dataset (synchronous in Phase 1)."""
    return await ModelService.train(db, body, current_user)


@router.get("/", response_model=list[ModelListResponse])
async def list_models(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all models owned by the current user."""
    return await ModelService.list_models(db, current_user)


@router.get("/{model_id}", response_model=ModelResponse)
async def get_model(
    model_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get details for a specific model (ownership-scoped)."""
    return await ModelService.get_model(db, model_id, current_user)
