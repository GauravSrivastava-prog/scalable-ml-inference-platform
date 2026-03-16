"""Prediction service — load model, run inference, store results."""

import logging
import os
import time
import uuid
from typing import Any

import pandas as pd
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache_instance import model_cache
from ml_platform_core.schemas.prediction import (
    BatchPredictionRequest,
    BatchPredictionResponse,
    BatchPredictionItem,
    PredictionRequest,
    PredictionResponse,
)
from ml_platform_core.exceptions import DataValidationError, ResourceNotFoundError
from ml_platform_core.models.ml_model import MLModel
from ml_platform_core.models.prediction import Prediction
from ml_platform_core.models.user import User

logger = logging.getLogger(__name__)

STORAGE_BASE = "/app/storage"
MAX_BATCH_SIZE = 100


class PredictionService:
    """Stateless service for inference operations."""

    @staticmethod
    async def predict(
        db: AsyncSession,
        data: PredictionRequest,
        user: User,
    ) -> PredictionResponse:
        """Load model, run inference, measure latency, persist result."""

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

        model_path = os.path.join(STORAGE_BASE, model.file_path)

        if not os.path.isfile(model_path):
            raise ResourceNotFoundError("Model file not found on disk")

        start_time = time.perf_counter()

        try:
            model_artifact = await model_cache.get_model(model_path)

            pipeline = model_artifact["pipeline"]
            feature_columns: list[str] = model_artifact["feature_columns"]
            label_encoders: dict = model_artifact.get("label_encoders", {})
            target_encoder = model_artifact.get("target_encoder")

            _validate_input_features(data.input_data, feature_columns)

            df = pd.DataFrame([data.input_data])[feature_columns]

            for col, le in label_encoders.items():
                if col in df.columns:
                    df[col] = le.transform(df[col].astype(str))

            raw_prediction = pipeline.predict(df)
            pred_value: Any = raw_prediction[0]

            probabilities = None
            try:
                proba = pipeline.predict_proba(df)
                probabilities = proba[0].tolist()
            except Exception:
                probabilities = None

            if hasattr(pred_value, "item"):
                pred_value = pred_value.item()

            if target_encoder is not None:
                pred_value = target_encoder.inverse_transform(
                    [int(pred_value)]
                )[0]

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
        db: AsyncSession,
        user: User,
    ) -> list[Prediction]:
        """List predictions owned by the user."""

        result = await db.execute(
            select(Prediction)
            .where(Prediction.user_id == user.id)
            .order_by(Prediction.created_at.desc())
        )

        return list(result.scalars().all())

    @staticmethod
    async def get_prediction(
        db: AsyncSession,
        prediction_id: uuid.UUID,
        user: User,
    ) -> Prediction:
        """Get a single prediction."""

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

    @staticmethod
    async def batch_predict(
        db: AsyncSession,
        user: User,
        request: BatchPredictionRequest
    ) -> BatchPredictionResponse:

        if len(request.input_data) > MAX_BATCH_SIZE:
            raise DataValidationError(
                f"Batch size cannot exceed {MAX_BATCH_SIZE}"
            )

        start_time = time.perf_counter()

        # Fetch model
        result = await db.execute(
            select(MLModel).where(
                MLModel.id == request.model_id,
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

        model_path = os.path.join(STORAGE_BASE, model.file_path)

        if not os.path.isfile(model_path):
            raise ResourceNotFoundError("Model file not found on disk")

        model_artifact = await model_cache.get_model(model_path)

        pipeline = model_artifact["pipeline"]
        feature_columns: list[str] = model_artifact["feature_columns"]
        label_encoders: dict = model_artifact.get("label_encoders", {})
        target_encoder = model_artifact.get("target_encoder")

        predictions: list[BatchPredictionItem] = [None] * len(request.input_data)

        valid_rows = []
        valid_indices = []

        # Step 1 — Validate inputs
        for idx, row in enumerate(request.input_data):

            try:
                _validate_input_features(row, feature_columns)

                valid_rows.append(row)
                valid_indices.append(idx)

            except Exception as exc:

                predictions[idx] = BatchPredictionItem(
                    result=None,
                    probabilities=None,
                    error=str(exc),
                )

        successful = 0
        failed = len(request.input_data) - len(valid_rows)

        # Step 2 — Run vectorized inference
        if valid_rows:

            df = pd.DataFrame(valid_rows)[feature_columns]

            # Apply label encoders
            for col, le in label_encoders.items():
                if col in df.columns:
                    df[col] = le.transform(df[col].astype(str))

            try:

                raw_predictions = pipeline.predict(df)

                probabilities = None
                try:
                    probabilities = pipeline.predict_proba(df)
                except Exception:
                    probabilities = None

                for i, idx in enumerate(valid_indices):

                    pred_value: Any = raw_predictions[i]

                    if hasattr(pred_value, "item"):
                        pred_value = pred_value.item()

                    if target_encoder is not None:
                        pred_value = target_encoder.inverse_transform(
                            [int(pred_value)]
                        )[0]

                    proba = None
                    if probabilities is not None:
                        proba = probabilities[i].tolist()

                    predictions[idx] = BatchPredictionItem(
                        result=pred_value,
                        probabilities=proba,
                        error=None,
                    )

                    successful += 1

            except Exception as exc:

                # catastrophic failure
                for idx in valid_indices:
                    predictions[idx] = BatchPredictionItem(
                        result=None,
                        probabilities=None,
                        error=str(exc),
                    )

                failed += len(valid_indices)
                successful = 0

        latency_ms = round((time.perf_counter() - start_time) * 1000, 2)

        logger.info(
            f"Vectorized batch prediction completed: "
            f"model={model.name} v{model.version}, "
            f"batch_size={len(request.input_data)}, "
            f"latency={latency_ms}ms"
        )

        return BatchPredictionResponse(
            model_id=request.model_id,
            predictions=predictions,
            total_predictions=len(request.input_data),
            successful_predictions=successful,
            failed_predictions=failed,
            latency_ms=latency_ms,
        )

def _validate_input_features(
    input_data: dict[str, Any],
    feature_columns: list[str],
) -> None:
    """Ensure required features exist in input."""

    missing = [col for col in feature_columns if col not in input_data]

    if missing:
        raise DataValidationError(
            f"Missing features in input_data: {missing}. "
            f"Required: {feature_columns}"
        )