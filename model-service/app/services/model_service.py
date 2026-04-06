"""Model service — dataset upload, model training orchestration, listing."""

import logging
import os
import uuid

import pandas as pd
from fastapi import UploadFile
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ml_platform_core.config import get_settings
from ml_platform_core.exceptions import (
    DataValidationError,
    FileTooLargeError,
    ResourceNotFoundError,
    TrainingError,
    UnsupportedMediaTypeError,
)
from ml_platform_core.models.ml_model import MLModel
from ml_platform_core.models.user import User
from ml_platform_core.schemas.model import (
    DatasetUploadResponse,
    ModelTrainRequest,
    ModelTrainResponse,
)

from app.services.training import train_model

logger = logging.getLogger(__name__)

# --- THE FIX: DYNAMIC PATH GENERATION ---
# Get the directory where this script (model_service.py) lives
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
# Go up two levels (app -> services -> root) to get the base directory
BASE_DIR = os.path.dirname(os.path.dirname(CURRENT_DIR))
# Safely join them to create a storage folder inside the project workspace
STORAGE_BASE = os.path.join(BASE_DIR, "storage")
# ----------------------------------------


class ModelService:
    """Stateless service for model management operations."""

    # ------------------------------------------------------------------
    # Dataset upload
    # ------------------------------------------------------------------
    @staticmethod
    async def upload_dataset(file: UploadFile, user: User) -> DatasetUploadResponse:
        """Validate and persist a CSV dataset upload."""
        settings = get_settings()
        max_bytes = settings.max_dataset_size_mb * 1024 * 1024

        # Validate file extension
        if not file.filename or not file.filename.lower().endswith(".csv"):
            raise UnsupportedMediaTypeError("Only CSV files are accepted")

        # Read file content and validate size
        content = await file.read()
        if len(content) > max_bytes:
            raise FileTooLargeError(
                f"File exceeds maximum size of {settings.max_dataset_size_mb} MB"
            )
        if len(content) == 0:
            raise DataValidationError("Uploaded file is empty")

        # Generate dataset ID and save path
        dataset_id = str(uuid.uuid4())
        user_dir = os.path.join(STORAGE_BASE, "datasets", str(user.id))
        os.makedirs(user_dir, exist_ok=True)
        file_path = os.path.join(user_dir, f"{dataset_id}.csv")

        with open(file_path, "wb") as f:
            f.write(content)

        # Validate CSV structure
        try:
            df = pd.read_csv(file_path, nrows=5)
        except Exception:
            os.remove(file_path)
            raise DataValidationError("File is not a valid CSV")

        # Validate row count
        row_count = sum(1 for _ in open(file_path)) - 1  # subtract header
        if row_count > settings.max_dataset_rows:
            os.remove(file_path)
            raise DataValidationError(
                f"Dataset exceeds maximum of {settings.max_dataset_rows} rows"
            )
        if row_count < 1:
            os.remove(file_path)
            raise DataValidationError("Dataset must contain at least 1 data row")

        logger.info(
            f"Dataset uploaded: user={user.id}, dataset_id={dataset_id}, rows={row_count}"
        )
        return DatasetUploadResponse(
            dataset_id=dataset_id,
            filename=file.filename,
            rows=row_count,
            columns=list(df.columns),
        )

    # ------------------------------------------------------------------
    # Model training
    # ------------------------------------------------------------------
    @staticmethod
    async def train(
        db: AsyncSession, data: ModelTrainRequest, user: User
    ) -> ModelTrainResponse:
        """Train a scikit-learn model synchronously and persist metadata."""
        # Validate dataset exists and belongs to user
        dataset_path = os.path.join(
            STORAGE_BASE, "datasets", str(user.id), f"{data.dataset_id}.csv"
        )
        if not os.path.isfile(dataset_path):
            raise ResourceNotFoundError("Dataset not found")

        # Validate target column exists in dataset
        df_head = pd.read_csv(dataset_path, nrows=0)
        if data.target_column not in df_head.columns:
            raise DataValidationError(
                f"Target column '{data.target_column}' not found in dataset. "
                f"Available columns: {list(df_head.columns)}"
            )

        # Determine next version number
        result = await db.execute(
            select(func.coalesce(func.max(MLModel.version), 0)).where(
                MLModel.user_id == user.id,
                MLModel.name == data.name,
            )
        )
        next_version = result.scalar() + 1

        # Prepare model save path
        model_dir = os.path.join(
            STORAGE_BASE, "models", str(user.id), data.name
        )
        os.makedirs(model_dir, exist_ok=True)
        model_file_path = os.path.join(model_dir, f"v{next_version}.joblib")

        # Relative path for DB storage (portable across containers)
        relative_model_path = os.path.join(
            "models", str(user.id), data.name, f"v{next_version}.joblib"
        )
        relative_dataset_path = os.path.join(
            "datasets", str(user.id), f"{data.dataset_id}.csv"
        )

        # Create DB record with "training" status
        model = MLModel(
            user_id=user.id,
            name=data.name,
            version=next_version,
            algorithm=data.algorithm,
            status="training",
            file_path=relative_model_path,
            dataset_path=relative_dataset_path,
            training_params=data.training_params,
        )
        db.add(model)
        await db.flush()

        # Run training (synchronous in Phase 1)
        try:
            metrics = train_model(
                dataset_path=dataset_path,
                target_column=data.target_column,
                algorithm=data.algorithm,
                model_save_path=model_file_path,
                training_params=data.training_params,
            )
            model.status = "ready"
            model.metrics = metrics
            logger.info(
                f"Model trained: {model.name} v{model.version}, metrics={metrics}"
            )
        except Exception as exc:
            model.status = "failed"
            logger.error(f"Training failed for {model.name}: {exc}")
            await db.flush()
            raise TrainingError(f"Training failed: {str(exc)}")

        await db.flush()
        await db.refresh(model)
        await db.commit()

        return ModelTrainResponse(
            model_id=model.id,
            name=model.name,
            version=model.version,
            algorithm=model.algorithm,
            status=model.status,
            metrics=model.metrics,
        )

    # ------------------------------------------------------------------
    # Model listing / retrieval
    # ------------------------------------------------------------------
    @staticmethod
    async def list_models(db: AsyncSession, user: User) -> list[MLModel]:
        """List all models owned by the current user."""
        result = await db.execute(
            select(MLModel)
            .where(MLModel.user_id == user.id)
            .order_by(MLModel.created_at.desc())
        )
        return list(result.scalars().all())

    @staticmethod
    async def get_model(
        db: AsyncSession, model_id: uuid.UUID, user: User
    ) -> MLModel:
        """Get a single model, scoped to the current user."""
        result = await db.execute(
            select(MLModel).where(
                MLModel.id == model_id,
                MLModel.user_id == user.id,
            )
        )
        model = result.scalar_one_or_none()
        if model is None:
            raise ResourceNotFoundError("Model not found")
        return model