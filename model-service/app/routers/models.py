"""Models router — dataset upload, training, model listing."""
import os
from uuid import UUID
from fastapi import Response, status, HTTPException
from fastapi import APIRouter, Depends, UploadFile, File, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text, select, delete
from ml_platform_core.dependencies import get_current_user, get_db
from ml_platform_core.models.user import User
from ml_platform_core.schemas.model import (
    DatasetUploadResponse,
    ModelListResponse,
    ModelResponse,
    ModelTrainRequest,
    ModelTrainResponse,
)
from ml_platform_core.models.ml_model import MLModel
from ml_platform_core.models.prediction import Prediction
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

@router.delete("/{model_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_model(
    model_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Safely delete a model, its predictions, its cache, and its physical artifacts."""
    
    # FIX 2: Use MLModel instead of Model
    query = select(MLModel).where(MLModel.id == model_id, MLModel.user_id == current_user.id)
    result = await db.execute(query)
    model = result.scalar_one_or_none()

    if not model:
        raise HTTPException(status_code=404, detail="Model not found or access denied")

    # FIX 3 & 4: Safe ORM Deletion with synchronize_session=False to prevent async memory crashes
    delete_stmt = delete(Prediction).where(Prediction.model_id == model_id).execution_options(synchronize_session=False)
    await db.execute(delete_stmt)

    # Delete the actual physical model file from the disk
    if model.file_path and os.path.exists(model.file_path):
        try:
            os.remove(model.file_path)
            print(f"Artifact deleted: {model.file_path}")
        except Exception as e:
            print(f"Warning: Could not delete physical file {model.file_path}: {e}")

    # Finally, delete the model record from the database
    await db.delete(model)
    await db.commit()
    
    return Response(status_code=status.HTTP_204_NO_CONTENT)