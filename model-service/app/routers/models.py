"""Models router — dataset upload, training, model listing.

ROUTE ORDERING CONTRACT
-----------------------
Static paths MUST be registered BEFORE wildcard paths (e.g. /{model_id}).
Starlette's router evaluates routes in insertion order. A wildcard like
/{model_id} will match any path segment — including "analyze-dataset" —
and if the HTTP method doesn't match, it returns 405 instead of falling
through to the correct static handler. Keeping all static POST routes at
the top of this file prevents that ambiguity entirely.
"""
import os
from uuid import UUID
from fastapi import Response, status, HTTPException
from fastapi import APIRouter, Depends, UploadFile, File, status, Body
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text, select, delete
from ml_platform_core.dependencies import get_current_user, get_db
from ml_platform_core.models.user import User
from ml_platform_core.schemas.model import (
    DatasetUploadResponse,
    DatasetAnalyzeRequest,
    DatasetAnalysisResponse,
    ModelListResponse,
    ModelResponse,
    ModelTrainRequest,
    ModelTrainResponse,
)
from ml_platform_core.models.ml_model import MLModel
from ml_platform_core.models.prediction import Prediction
from app.services.model_service import ModelService

router = APIRouter()


# ──────────────────────────────────────────────────────────────────────────────
# STATIC POST ROUTES  (must come before wildcard GET/DELETE /{model_id})
# ──────────────────────────────────────────────────────────────────────────────

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
    "/analyze-dataset",
    response_model=DatasetAnalysisResponse,
    status_code=status.HTTP_200_OK,
)
async def analyze_dataset(
    body: DatasetAnalyzeRequest,
    current_user: User = Depends(get_current_user),
):
    """Profile an uploaded CSV and return Copilot suggestions.

    Accepts a JSON body: { "dataset_id": "<uuid-string>" }
    Returns classification + regression target/algorithm suggestions based
    on a lightweight Pandas analysis of the already-uploaded CSV file.
    """
    return await ModelService.analyze_dataset(body.dataset_id, current_user)


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
    """Train a model on an uploaded dataset (async Celery pipeline)."""
    return await ModelService.train(db, body, current_user)


# ──────────────────────────────────────────────────────────────────────────────
# STATIC GET ROUTES  (list before wildcard)
# ──────────────────────────────────────────────────────────────────────────────

@router.get("/", response_model=list[ModelListResponse])
async def list_models(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all models owned by the current user."""
    return await ModelService.list_models(db, current_user)


# ──────────────────────────────────────────────────────────────────────────────
# WILDCARD ROUTES  (must come LAST — matches any /{model_id} segment)
# ──────────────────────────────────────────────────────────────────────────────

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
    current_user: User = Depends(get_current_user),
):
    """Safely delete a model, its predictions, its cache, and its physical artifacts."""
    query = select(MLModel).where(MLModel.id == model_id, MLModel.user_id == current_user.id)
    result = await db.execute(query)
    model = result.scalar_one_or_none()

    if not model:
        raise HTTPException(status_code=404, detail="Model not found or access denied")

    # Safe ORM deletion with synchronize_session=False to prevent async memory crashes
    delete_stmt = delete(Prediction).where(Prediction.model_id == model_id).execution_options(synchronize_session=False)
    await db.execute(delete_stmt)

    # Delete the physical model artifact from disk
    if model.file_path and os.path.exists(model.file_path):
        try:
            os.remove(model.file_path)
            print(f"Artifact deleted: {model.file_path}")
        except Exception as e:
            print(f"Warning: Could not delete physical file {model.file_path}: {e}")

    await db.delete(model)
    await db.commit()

    return Response(status_code=status.HTTP_204_NO_CONTENT)