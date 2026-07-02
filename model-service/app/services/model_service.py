"""Model service — dataset upload, model training orchestration, listing."""

import logging
import os
import uuid
from supabase import create_client
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
    DatasetAnalyzeRequest,
    DatasetAnalysisResponse,
    ColumnProfile,
    SuggestionBlock,
    ModelTrainRequest,
    ModelTrainResponse,
)

from app.services.training import celery_app, run_full_training_pipeline

logger = logging.getLogger(__name__)

# --- DYNAMIC PATH GENERATION ---
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
    # Dataset analysis / Copilot profiler
    # ------------------------------------------------------------------
    @staticmethod
    async def analyze_dataset(dataset_id: str, user: User) -> DatasetAnalysisResponse:
        """Run a lightweight Pandas profile on an already-uploaded CSV.
        
        Returns structured column stats and two Copilot suggestions:
        - classification_suggestion: best categorical target + algorithm
        - regression_suggestion:     best numeric target + algorithm
        """
        dataset_path = os.path.join(
            STORAGE_BASE, "datasets", str(user.id), f"{dataset_id}.csv"
        )
        if not os.path.isfile(dataset_path):
            raise ResourceNotFoundError("Dataset not found for analysis")

        df = pd.read_csv(dataset_path)
        row_count = len(df)
        col_count = len(df.columns)

        # --- Build per-column profiles ---
        column_profiles: list[ColumnProfile] = []
        for col in df.columns:
            series = df[col]
            unique = int(series.nunique())
            null_pct = round(float(series.isna().mean() * 100), 2)
            cardinality_ratio = round(unique / row_count, 4) if row_count > 0 else 0.0
            dtype_str = str(series.dtype)
            sample_vals = series.dropna().head(3).tolist()
            column_profiles.append(ColumnProfile(
                name=col,
                dtype=dtype_str,
                unique=unique,
                null_pct=null_pct,
                cardinality_ratio=cardinality_ratio,
                sample_values=sample_vals,
            ))

        # --- Classification suggestion ---
        # Find the best categorical column: object dtype, low-enough cardinality (2–200 unique),
        # not a known metadata field, and fewest nulls.
        NON_PREDICTIVE = {
            "unnamed: 0", "track_id", "track_name", "album_name",
            "artists", "id", "index", "row_id", "song_id", "user_id",
        }
        classification_suggestion: SuggestionBlock | None = None
        best_cls_col = None
        best_cls_score = float("inf")
        for col in df.columns:
            if col.lower().strip() in NON_PREDICTIVE:
                continue
            series = df[col]
            uniq = series.nunique()
            if (series.dtype == "object" or series.dtype.name == "category") and 2 <= uniq <= 200:
                score = series.isna().sum()  # Prefer columns with fewer nulls
                if score < best_cls_score:
                    best_cls_score = score
                    best_cls_col = col
        if best_cls_col:
            uniq_count = int(df[best_cls_col].nunique())
            null_p = round(float(df[best_cls_col].isna().mean() * 100), 1)
            classification_suggestion = SuggestionBlock(
                target=best_cls_col,
                algorithm="random_forest",
                rationale=(
                    f"Categorical column with {uniq_count} unique classes "
                    f"and {null_p}% nulls. Random Forest handles multi-class "
                    f"targets without one-hot encoding overhead."
                ),
            )

        # --- Regression suggestion ---
        # Find the numeric column with the highest variance (most signal),
        # excluding near-constant columns and index-like columns.
        regression_suggestion: SuggestionBlock | None = None
        best_reg_col = None
        best_variance = -1.0
        for col in df.columns:
            if col.lower().strip() in NON_PREDICTIVE:
                continue
            series = df[col]
            if pd.api.types.is_numeric_dtype(series) and series.nunique() > 20:
                var = float(series.var())
                if var > best_variance:
                    best_variance = var
                    best_reg_col = col
        if best_reg_col:
            std_val = round(float(df[best_reg_col].std()), 2)
            regression_suggestion = SuggestionBlock(
                target=best_reg_col,
                algorithm="xgboost",
                rationale=(
                    f"Numeric column with the highest variance (\u03c3={std_val}). "
                    f"XGBoost is optimal for tabular regression with mixed "
                    f"feature types and handles missing values natively."
                ),
            )

        logger.info(
            f"Dataset analyzed: user={user.id}, dataset_id={dataset_id}, "
            f"rows={row_count}, cls_target={best_cls_col}, reg_target={best_reg_col}"
        )
        return DatasetAnalysisResponse(
            row_count=row_count,
            col_count=col_count,
            columns=column_profiles,
            classification_suggestion=classification_suggestion,
            regression_suggestion=regression_suggestion,
        )

 # ------------------------------------------------------------------
    # Model training (Asynchronous)
    # ------------------------------------------------------------------
    @staticmethod
    async def train(
        db: AsyncSession, data: ModelTrainRequest, user: User
    ) -> ModelTrainResponse:
        """Trigger an asynchronous Celery task to train the model."""
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
        
        # CRITICAL: Commit the record BEFORE triggering the background worker
        # so the worker can find the ID in the database when it finishes.
        await db.commit()
        await db.refresh(model)

        # Dispatch to the Celery ml_training queue.
        # Payload contract: worker receives dataset_id (not an absolute path) and
        # resolves the full path internally from storage_base. This decouples the
        # API server's filesystem layout from the worker container's mount point.
        async_result = run_full_training_pipeline.apply_async(
            kwargs=dict(
                model_id_str=str(model.id),
                dataset_id=data.dataset_id,
                target_column=data.target_column,
                algorithm=data.algorithm,
                model_save_path=model_file_path,
                training_params=data.training_params or {},
                user_id_str=str(user.id),
                model_name=data.name,
                next_version=next_version,
                storage_base=STORAGE_BASE,
            ),
            queue="ml_training",
        )

        # Persist the Celery task ID so operators can poll AsyncResult externally
        from sqlalchemy import update as sa_update
        from ml_platform_core.models.ml_model import MLModel as _MLModel
        await db.execute(
            sa_update(_MLModel)
            .where(_MLModel.id == model.id)
            .values(celery_task_id=async_result.id)
        )
        await db.commit()

        logger.info(f"Handed off training job for {model.name} v{next_version} to Celery Worker.")

        # Return instantly to the frontend (50ms response time)
        return ModelTrainResponse(
            model_id=model.id,
            name=model.name,
            version=model.version,
            algorithm=model.algorithm,
            status=model.status, # This will currently be "training"
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