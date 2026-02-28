"""Prediction service — load model, run inference, store results."""

import logging
import os
import time
import uuid
from typing import Any

import joblib
import pandas as pd
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ml_platform_core.exceptions import DataValidationError, ResourceNotFoundError
from ml_platform_core.models.ml_model import MLModel
from ml_platform_core.models.prediction import Prediction
from ml_platform_core.models.user import User
from ml_platform_core.schemas.prediction import PredictionRequest, PredictionResponse

logger = logging.getLogger(__name__)

STORAGE_BASE = "/app/storage"


class PredictionService:
    """Stateless service for inference operations."""

    @staticmethod
    async def predict(
        db: AsyncSession, data: PredictionRequest, user: User
    ) -> PredictionResponse:
        """Load model, run inference, measure latency, persist result."""
        # Fetch model — ownership scoped
        result = await db.execute(
            select(MLModel).where(
                MLModel.id == data.model_id,
                MLModel.user_id == user.id,
            )
        )
        model = result.scalar_one_or_none()
        if model is None:
            raise ResourceNotFoundError("Model not found")

        if model.status != "ready":
            raise DataValidationError(
                f"Model is not ready for inference (status: {model.status})"
            )

        # Load model artifact from shared volume
        model_path = os.path.join(STORAGE_BASE, model.file_path)
        if not os.path.isfile(model_path):
            raise ResourceNotFoundError("Model file not found on disk")

        start_time = time.perf_counter()

        try:
            model_artifact = joblib.load(model_path)
            pipeline = model_artifact["pipeline"]
            feature_columns: list[str] = model_artifact["feature_columns"]
            label_encoders: dict = model_artifact.get("label_encoders", {})
            target_encoder = model_artifact.get("target_encoder")

            # Build input DataFrame
            _validate_input_features(data.input_data, feature_columns)
            df = pd.DataFrame([data.input_data])[feature_columns]

            # Apply label encoders for categorical features
            for col, le in label_encoders.items():
                if col in df.columns:
                    df[col] = le.transform(df[col].astype(str))

            # Run prediction
            raw_prediction = pipeline.predict(df)
            pred_value: Any = raw_prediction[0]
            probabilities = None

            probabilities = None

            try:
                proba = pipeline.predict_proba(df)
                probabilities = proba[0].tolist()
            except Exception:
                probabilities = None

            # Convert numpy types to native Python for JSON serialization
            if hasattr(pred_value, "item"):
                pred_value = pred_value.item()

            # Decode target label if encoder was used
            if target_encoder is not None:
                pred_value = target_encoder.inverse_transform([int(pred_value)])[0]

        except ResourceNotFoundError:
            raise
        except DataValidationError:
            raise
        except Exception as exc:
            logger.error(f"Prediction failed: {exc}")
            latency_ms = round((time.perf_counter() - start_time) * 1000, 2)
            prediction_record = Prediction(
                user_id=user.id,
                model_id=data.model_id,
                input_data=data.input_data,
                result=None,
                latency_ms=latency_ms,
                status="failed",
            )
            db.add(prediction_record)
            await db.flush()
            raise DataValidationError(f"Prediction failed: {str(exc)}")

        latency_ms = round((time.perf_counter() - start_time) * 1000, 2)

        # Persist successful prediction
        prediction_record = Prediction(
            user_id=user.id,
            model_id=data.model_id,
            input_data=data.input_data,
            result=pred_value,
            latency_ms=latency_ms,
            status="completed",
        )
        db.add(prediction_record)
        await db.flush()
        await db.refresh(prediction_record)

        logger.info(
            f"Prediction completed: model={model.name} v{model.version}, "
            f"latency={latency_ms}ms"
        )
        return PredictionResponse(
            prediction_id=prediction_record.id,
            result=pred_value,
            probabilities=probabilities,
            latency_ms=latency_ms,
        )

    @staticmethod
    async def list_predictions(
        db: AsyncSession, user: User
    ) -> list[Prediction]:
        """List all predictions owned by the current user."""
        result = await db.execute(
            select(Prediction)
            .where(Prediction.user_id == user.id)
            .order_by(Prediction.created_at.desc())
        )
        return list(result.scalars().all())

    @staticmethod
    async def get_prediction(
        db: AsyncSession, prediction_id: uuid.UUID, user: User
    ) -> Prediction:
        """Get a single prediction, scoped to the current user."""
        result = await db.execute(
            select(Prediction).where(
                Prediction.id == prediction_id,
                Prediction.user_id == user.id,
            )
        )
        prediction = result.scalar_one_or_none()
        if prediction is None:
            raise ResourceNotFoundError("Prediction not found")
        return prediction


def _validate_input_features(
    input_data: dict[str, Any], feature_columns: list[str]
) -> None:
    """Ensure all required features are present in the input."""
    missing = [col for col in feature_columns if col not in input_data]
    if missing:
        raise DataValidationError(
            f"Missing features in input_data: {missing}. "
            f"Required: {feature_columns}"
        )
