"""Prediction service — load model, run inference, store results."""

import logging
import os
import time
import uuid
import json
import hashlib
import io
import joblib
from typing import Any
from uuid import UUID
import pandas as pd
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from prometheus_client import Counter, Histogram
from supabase import create_client

# --- FASTAPI & DB IMPORTS ADDED FOR BACKGROUND TASKS ---
from fastapi import BackgroundTasks
from ml_platform_core.database import async_session_factory 
# -------------------------------------------------------

# --- PROMETHEUS METRICS DEFINITIONS ---
INFERENCE_REQUESTS = Counter(
    "inference_requests_total",
    "Total number of inference requests",
    ["model_id", "status", "type"]
)
INFERENCE_LATENCY = Histogram(
    "inference_latency_seconds",
    "Inference latency in seconds",
    ["model_id", "type"],
    buckets=[0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0]
)
MODEL_PROBABILITIES = Histogram(
    "model_prediction_probability",
    "Model prediction probabilities (confidence)",
    ["model_id", "class_index"],
    buckets=[0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
)
# --------------------------------------

from app.core.redis_client import redis_cache
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

MAX_BATCH_SIZE = 100


class PredictionService:
    """Stateless service for inference operations."""
    
    @staticmethod
    async def _save_batch_to_ledger_background(
        model_id: UUID, 
        user_id: UUID, 
        inputs: list[dict], 
        predictions: list[BatchPredictionItem], 
        latency_ms: float
    ):
        """Silently saves successful predictions to PostgreSQL in the background."""
        try:
            async with async_session_factory() as session:
                prediction_records = []
                for idx, item in enumerate(predictions):
                    if item.error is None:
                        record = Prediction(
                            user_id=user_id,
                            model_id=model_id,
                            input_data=inputs[idx],
                            result=item.result,
                            latency_ms=latency_ms,
                            status="completed"
                        )
                        prediction_records.append(record)

                if prediction_records:
                    session.add_all(prediction_records)
                    await session.commit()
                    logger.info(f"[LEDGER] Background Task: Successfully wrote {len(prediction_records)} records to Postgres.")
                    
        except Exception as e:
            logger.error(f"[LEDGER ERROR] Background Task Failed: {str(e)}", exc_info=True)

    @staticmethod
    async def predict(
        db: AsyncSession,
        data: PredictionRequest,
        user: User,
    ) -> PredictionResponse:
        """Load model, run inference, measure latency, persist result."""

        # --- TIER 2 CACHE: CHECK REDIS FIRST (SINGLE) ---
        request_dict = data.model_dump() if hasattr(data, "model_dump") else data.dict()
        request_hash = hashlib.sha256(json.dumps(request_dict, sort_keys=True, default=str).encode()).hexdigest()
        cache_key = f"predict:{data.model_id}:{request_hash}"

        if redis_cache.client:
            try:
                cached_result = await redis_cache.client.get(cache_key)
                if cached_result:
                    logger.info("[TIER 2 HIT - REDIS] Bypassing ML Model")
                    cached_data = json.loads(cached_result)
                    
                    INFERENCE_REQUESTS.labels(model_id=str(data.model_id), status="cache_hit", type="single").inc()
                    
                    return PredictionResponse(**cached_data)
            except Exception as e:
                logger.warning(f"Redis fetch failed, falling back to ML model: {e}")
        # ------------------------------------------------

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

        start_time = time.perf_counter()

        try:
            # --- SUPABASE DOWNLOAD LOGIC ---
            if not model.file_path:
                raise ResourceNotFoundError("Model file path missing from DB")

            url: str = os.environ.get("SUPABASE_URL")
            key: str = os.environ.get("SUPABASE_KEY")
            supabase = create_client(url, key)

            # Download raw bytes from Supabase
            file_bytes = supabase.storage.from_("models").download(model.file_path)
            
            # Load Scikit-Learn model directly from memory (bypassing local cache)
            model_artifact = joblib.load(io.BytesIO(file_bytes))
            # -----------------------------------

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

            # --- PROBABILITY DICTIONARY MAPPING FIX ---
            probabilities = None
            try:
                proba = pipeline.predict_proba(df)
                raw_classes = pipeline.classes_
                class_labels = target_encoder.inverse_transform(raw_classes) if target_encoder else raw_classes
                # Create dictionary mapping label to probability
                probabilities = {str(label): float(val) for label, val in zip(class_labels, proba[0])}
            except Exception:
                probabilities = None
            # ------------------------------------------

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

            INFERENCE_LATENCY.labels(model_id=str(data.model_id), type="single").observe(latency_ms / 1000.0)
            INFERENCE_REQUESTS.labels(model_id=str(data.model_id), status="failed", type="single").inc()

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

        INFERENCE_LATENCY.labels(model_id=str(data.model_id), type="single").observe(latency_ms / 1000.0)
        INFERENCE_REQUESTS.labels(model_id=str(data.model_id), status="completed", type="single").inc()
        
        if probabilities:
            # Ensure we only log the numeric values to prometheus
            for idx, prob in enumerate(probabilities.values()):
                MODEL_PROBABILITIES.labels(model_id=str(data.model_id), class_index=str(idx)).observe(prob)

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

        response = PredictionResponse(
            prediction_id=prediction_record.id,
            result=pred_value,
            probabilities=probabilities,
            latency_ms=latency_ms,
        )

        # --- TIER 2 CACHE: SAVE TO REDIS (SINGLE) ---
        if redis_cache.client:
            try:
                response_json = response.model_dump_json() if hasattr(response, "model_dump_json") else response.json()
                await redis_cache.client.setex(cache_key, 3600, response_json)
                logger.info("[TIER 2 STORE - REDIS] Saved prediction for 1 hour")
            except Exception as e:
                logger.warning(f"Redis save failed: {e}")
        # --------------------------------------------

        return response

    @staticmethod
    async def list_predictions(db: AsyncSession, user: User) -> list[Prediction]:
        """Fetch all predictions for the current logged-in user."""
        result = await db.execute(
            select(Prediction)
            .where(Prediction.user_id == user.id)
            .order_by(Prediction.created_at.desc())
        )
        return list(result.scalars().all())

    @staticmethod
    async def get_prediction(
        db: AsyncSession, prediction_id: UUID, user: User
    ) -> Prediction:
        """Fetch a specific prediction ensuring it belongs to the user."""
        result = await db.execute(
            select(Prediction)
            .where(Prediction.id == prediction_id, Prediction.user_id == user.id)
        )
        prediction = result.scalar_one_or_none()
        if prediction is None:
            raise ResourceNotFoundError("Prediction not found")
        return prediction

    @staticmethod
    async def batch_predict(
        db: AsyncSession,
        user: User,
        request: BatchPredictionRequest,
        background_tasks: BackgroundTasks = None
    ) -> BatchPredictionResponse:

        if len(request.input_data) > MAX_BATCH_SIZE:
            raise DataValidationError(
                f"Batch size cannot exceed {MAX_BATCH_SIZE}"
            )

        # --- TIER 2 CACHE: CHECK REDIS FIRST (BATCH) ---
        request_dict = request.model_dump() if hasattr(request, "model_dump") else request.dict()
        request_hash = hashlib.sha256(json.dumps(request_dict, sort_keys=True, default=str).encode()).hexdigest()
        cache_key = f"batch_predict:{request.model_id}:{request_hash}"

        if redis_cache.client:
            try:
                cached_result = await redis_cache.client.get(cache_key)
                if cached_result:
                    logger.info(f"[TIER 2 HIT - REDIS] Bypassing ML Model for Batch of {len(request.input_data)}")
                    cached_data = json.loads(cached_result)
                    
                    INFERENCE_REQUESTS.labels(model_id=str(request.model_id), status="cache_hit", type="batch").inc(len(request.input_data))
                    return BatchPredictionResponse(**cached_data)
            except Exception as e:
                logger.warning(f"Redis fetch failed for batch, falling back to ML model: {e}")
        # -----------------------------------------------

        start_time = time.perf_counter()

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

        # --- SUPABASE DOWNLOAD LOGIC ---
        if not model.file_path:
            raise ResourceNotFoundError("Model file path missing from DB")

        try:
            url: str = os.environ.get("SUPABASE_URL")
            key: str = os.environ.get("SUPABASE_KEY")
            supabase = create_client(url, key)

            file_bytes = supabase.storage.from_("models").download(model.file_path)
            model_artifact = joblib.load(io.BytesIO(file_bytes))
        except Exception as e:
            raise ResourceNotFoundError(f"Cloud storage error: {str(e)}")
        # -----------------------------------

        pipeline = model_artifact["pipeline"]
        feature_columns: list[str] = model_artifact["feature_columns"]
        label_encoders: dict = model_artifact.get("label_encoders", {})
        target_encoder = model_artifact.get("target_encoder")

        predictions: list[BatchPredictionItem] = [None] * len(request.input_data)

        valid_rows = []
        valid_indices = []

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

        if valid_rows:
            df = pd.DataFrame(valid_rows)[feature_columns]

            for col, le in label_encoders.items():
                if col in df.columns:
                    df[col] = le.transform(df[col].astype(str))

            try:
                raw_predictions = pipeline.predict(df)

                # --- PROBABILITY DICTIONARY MAPPING FIX (BATCH) ---
                probabilities = None
                class_labels = None
                try:
                    probabilities = pipeline.predict_proba(df)
                    raw_classes = pipeline.classes_
                    class_labels = target_encoder.inverse_transform(raw_classes) if target_encoder else raw_classes
                except Exception:
                    probabilities = None
                    class_labels = None
                # --------------------------------------------------

                for i, idx in enumerate(valid_indices):
                    pred_value: Any = raw_predictions[i]
                    if hasattr(pred_value, "item"):
                        pred_value = pred_value.item()
                    if target_encoder is not None:
                        pred_value = target_encoder.inverse_transform(
                            [int(pred_value)]
                        )[0]

                    proba = None
                    if probabilities is not None and class_labels is not None:
                        proba = {str(label): float(val) for label, val in zip(class_labels, probabilities[i])}

                    predictions[idx] = BatchPredictionItem(
                        result=pred_value,
                        probabilities=proba,
                        error=None,
                    )
                    successful += 1

            except Exception as exc:
                for idx in valid_indices:
                    predictions[idx] = BatchPredictionItem(
                        result=None,
                        probabilities=None,
                        error=str(exc),
                    )
                failed += len(valid_indices)
                successful = 0

        latency_ms = round((time.perf_counter() - start_time) * 1000, 2)

        INFERENCE_LATENCY.labels(model_id=str(request.model_id), type="batch").observe(latency_ms / 1000.0)
        
        if successful > 0:
            INFERENCE_REQUESTS.labels(model_id=str(request.model_id), status="completed", type="batch").inc(successful)
        if failed > 0:
            INFERENCE_REQUESTS.labels(model_id=str(request.model_id), status="failed", type="batch").inc(failed)

        for item in predictions:
            if item and item.probabilities:
                for idx, prob in enumerate(item.probabilities.values()):
                    MODEL_PROBABILITIES.labels(model_id=str(request.model_id), class_index=str(idx)).observe(prob)

        logger.info(
            f"Vectorized batch prediction completed: "
            f"model={model.name} v{model.version}, "
            f"batch_size={len(request.input_data)}, "
            f"latency={latency_ms}ms"
        )

        response = BatchPredictionResponse(
            model_id=request.model_id,
            predictions=predictions,
            total_predictions=len(request.input_data),
            successful_predictions=successful,
            failed_predictions=failed,
            latency_ms=latency_ms,
        )

        # --- TIER 2 CACHE: SAVE TO REDIS (BATCH) ---
        if redis_cache.client:
            try:
                response_json = response.model_dump_json() if hasattr(response, "model_dump_json") else response.json()
                await redis_cache.client.setex(cache_key, 3600, response_json)
                logger.info("[TIER 2 STORE - REDIS] Saved batch prediction for 1 hour")
            except Exception as e:
                logger.warning(f"Redis batch save failed: {e}")
        # -------------------------------------------

        if background_tasks:
            background_tasks.add_task(
                PredictionService._save_batch_to_ledger_background,
                request.model_id,
                user.id,
                request.input_data,
                predictions,
                latency_ms
            )
        else:
            logger.warning("[LEDGER] No background_tasks object provided. Skipping ledger write.")

        return response


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