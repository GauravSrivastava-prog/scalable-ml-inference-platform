"""scikit-learn training pipeline — fit, evaluate, serialize.

Enterprise MLOps Refactor (Phase 2):
  - Queue segregation: ml_training (heavy) / ml_inference (fast)
  - Granular state telemetry: PENDING → PREPROCESSING → FITTING → UPLOADING → ready/failed
  - OOM protection: max_tasks_per_child=50 via worker startup command
  - Exponential retry backoff: tenacity wraps all DB writes (5 attempts, 2s–60s)
  - Task timeouts: soft=1800s (30 min), hard=2100s (35 min)
  - Dead-letter routing: tasks exhausting retries → ml_dead_letter queue
  - Payload contract: worker receives dataset_id + storage_base, resolves path internally
"""

import logging
import os
import asyncio
from typing import Any

import joblib
import pandas as pd
from sklearn.ensemble import (
    GradientBoostingClassifier,
    GradientBoostingRegressor,
    RandomForestClassifier,
    RandomForestRegressor,
)
from sklearn.linear_model import LinearRegression, LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    f1_score,
    mean_squared_error,
    r2_score,
    log_loss,
    brier_score_loss,
)
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import LabelEncoder, StandardScaler
from sklearn.tree import DecisionTreeClassifier, DecisionTreeRegressor
import xgboost as xgb
from celery import Celery
from celery.exceptions import SoftTimeLimitExceeded
from sqlalchemy import update
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool
from tenacity import (
    retry,
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
    before_sleep_log,
)
from supabase import create_client
from ml_platform_core.models.ml_model import MLModel

import json
import redis as _redis_sync  # synchronous client — safe inside Celery worker context

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Celery Application — Enterprise Configuration
# ---------------------------------------------------------------------------
redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

# Upstash Redis requires explicit SSL config for rediss:// scheme
if redis_url.startswith("rediss://") and "ssl_cert_reqs" not in redis_url:
    redis_url += "?ssl_cert_reqs=CERT_NONE"

celery_app = Celery(
    "ml_platform_tasks",
    broker=redis_url,
    backend=redis_url,
)

celery_app.conf.update(
    # ── Queue Segregation ────────────────────────────────────────────────────
    # ml_training  → heavy, slow tasks (model fitting, artifact upload)
    # ml_inference → fast, batch prediction tasks (reserved for async dispatch)
    # ml_dead_letter → receives tasks that have exhausted all retry attempts
    task_routes={
        "run_full_training_pipeline": {"queue": "ml_training"},
        "run_batch_inference":        {"queue": "ml_inference"},
        "handle_dead_letter":         {"queue": "ml_dead_letter"},
    },
    # ── OOM Protection ───────────────────────────────────────────────────────
    # Recycle each worker process after 50 tasks. Prevents memory leakage
    # from large joblib objects (Random Forest / XGBoost forests) accumulating
    # inside long-lived worker processes.
    worker_max_tasks_per_child=50,
    # ── Task Timeouts ─────────────────────────────────────────────────────────
    # soft_time_limit: raises SoftTimeLimitExceeded (catchable) after 30 min
    # time_limit: OS SIGKILL after 35 min — no zombie workers ever
    task_soft_time_limit=1800,
    task_time_limit=2100,
    # ── Reliability ───────────────────────────────────────────────────────────
    # acks_late: task is acknowledged AFTER completion (not before).
    #   If the worker dies mid-training, the broker re-queues the task.
    task_acks_late=True,
    # reject_on_worker_lost: when a worker is hard-killed (OOM, SIGKILL),
    #   the task is rejected back to the queue rather than silently lost.
    task_reject_on_worker_lost=True,
    # Suppress Celery 6.0 deprecation warning — we explicitly want retry on startup
    # for the Upstash Redis connection (transient DNS / TLS handshake delays).
    broker_connection_retry_on_startup=True,
    # Serialisation
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
)

# ---------------------------------------------------------------------------
# Algorithm Registries
# ---------------------------------------------------------------------------
CLASSIFICATION_ALGORITHMS: dict[str, type] = {
    "random_forest": RandomForestClassifier,
    "logistic_regression": LogisticRegression,
    "gradient_boosting": GradientBoostingClassifier,
    "decision_tree": DecisionTreeClassifier,
    "xgboost": xgb.XGBClassifier,
}

REGRESSION_ALGORITHMS: dict[str, type] = {
    "random_forest": RandomForestRegressor,
    "linear_regression": LinearRegression,
    "gradient_boosting": GradientBoostingRegressor,
    "decision_tree": DecisionTreeRegressor,
    "xgboost": xgb.XGBRegressor,
}


# ---------------------------------------------------------------------------
# Internal Helpers
# ---------------------------------------------------------------------------

def _detect_task_type(y: pd.Series) -> str:
    """Auto-detect classification vs regression from the target column."""
    if y.dtype == "object" or y.dtype.name == "category" or y.dtype.name == "string":
        return "classification"
    if y.nunique() <= 20:
        return "classification"
    return "regression"


def expected_calibration_error(y_true, y_prob, n_bins: int = 10) -> float:
    """Proper Expected Calibration Error (ECE) for binary classification."""
    bins = np.linspace(0.0, 1.0, n_bins + 1)
    bin_ids = np.clip(np.digitize(y_prob, bins) - 1, 0, n_bins - 1)
    ece = 0.0
    total_samples = len(y_true)
    for i in range(n_bins):
        mask = bin_ids == i
        if np.any(mask):
            bin_confidence = np.mean(y_prob[mask])
            bin_accuracy = np.mean(y_true[mask])
            ece += np.abs(bin_accuracy - bin_confidence) * (np.sum(mask) / total_samples)
    return float(ece)


def _get_async_engine():
    """Build a fresh NullPool async engine — safe for use inside asyncio.run()."""
    db_url = os.environ.get("DATABASE_URL", "")
    if db_url.startswith("postgresql://"):
        db_url = db_url.replace("postgresql://", "postgresql+asyncpg://")
    return create_async_engine(db_url, poolclass=NullPool)


# ---------------------------------------------------------------------------
# DB Write with Exponential Retry Backoff
# ---------------------------------------------------------------------------

@retry(
    retry=retry_if_exception_type(Exception),
    wait=wait_exponential(multiplier=1, min=2, max=60),
    stop=stop_after_attempt(5),
    before_sleep=before_sleep_log(logger, logging.WARNING),
    reraise=True,
)
async def _write_state(
    model_id_str: str,
    *,
    status: str,
    status_detail: str | None = None,
    metrics: dict | None = None,
    file_path: str | None = None,
) -> None:
    """
    Atomically write a state transition to PostgreSQL.

    Wrapped in tenacity: up to 5 attempts with 2s → 4s → 8s → 16s → 60s backoff.
    This survives transient Neon Cloud / pgbouncer hiccups without marking a
    successfully-trained model as failed.
    """
    engine = _get_async_engine()
    try:
        async with engine.begin() as conn:
            values: dict[str, Any] = {
                "status": status,
                "status_detail": status_detail,
            }
            if metrics is not None:
                values["metrics"] = metrics
            if file_path is not None:
                values["file_path"] = file_path
            await conn.execute(
                update(MLModel)
                .where(MLModel.id == model_id_str)
                .values(**values)
            )
    finally:
        await engine.dispose()


def _checkpoint(model_id_str: str, status: str, detail: str | None = None) -> None:
    """
    Synchronous convenience wrapper — calls asyncio.run(_write_state(...)).

    Used inside the Celery task body to emit state transitions without
    restructuring the entire task as async.
    """
    try:
        asyncio.run(
            _write_state(model_id_str, status=status, status_detail=detail)
        )
        logger.info(f"[STATE] {model_id_str[:8]}… → status={status!r} detail={detail!r}")
    except Exception as exc:
        # DB telemetry failures must NEVER abort the training pipeline.
        # Log and continue — the training result is more valuable than the checkpoint.
        logger.error(f"[STATE ERROR] Failed to write checkpoint {detail!r}: {exc}")


def _publish_model_ready_event(model_id_str: str, local_path: str) -> None:
    """
    Publish a ``model.ready`` event to Redis so every running prediction-service
    replica can immediately pre-warm its local model cache from the shared volume.

    This function is synchronous (runs inside the Celery worker process) and uses
    the standard ``redis`` package — NOT the async redis.asyncio client.

    Failure is non-fatal: if Redis is unreachable the event is silently dropped
    and the prediction-service will load the model on its first inference request.
    """
    try:
        r = _redis_sync.from_url(
            os.environ.get("REDIS_URL", "redis://localhost:6379/0"),
            decode_responses=True,
        )
        payload = json.dumps({"model_id": model_id_str, "local_path": local_path})
        subscriber_count = r.publish("model.ready", payload)
        logger.info(
            "[PUB/SUB] Published model.ready for model %s → %d subscriber(s) notified",
            model_id_str[:8], subscriber_count,
        )
        r.close()
    except Exception as exc:
        # Publishing is best-effort — a Redis failure here must never abort training.
        logger.warning(
            "[PUB/SUB] Could not publish model.ready event (Redis unreachable?): %s", exc
        )


# ---------------------------------------------------------------------------
# Core Training Logic (plain function — not a Celery task)
# ---------------------------------------------------------------------------

def _run_training(
    dataset_path: str,
    target_column: str,
    algorithm: str,
    model_save_path: str,
    training_params: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Pure ML pipeline: load → preprocess → fit → evaluate → serialize.

    This is a plain Python function, not a Celery task. It is called from
    run_full_training_pipeline which manages all the state telemetry and
    error handling around it.
    """
    logger.info(f"Loading dataset from {dataset_path}")
    df = pd.read_csv(dataset_path)

    X = df.drop(columns=[target_column])
    y = df[target_column]

    # ── Intelligent Column Pruner ─────────────────────────────────────────
    NON_PREDICTIVE_METADATA = {
        "unnamed: 0", "track_id", "track_name", "album_name",
        "artists", "id", "index", "row_id", "song_id", "user_id",
    }
    pruned_columns: list[str] = []
    for col in list(X.columns):
        if col.lower().strip() in NON_PREDICTIVE_METADATA:
            X = X.drop(columns=[col])
            pruned_columns.append(col)
            logger.info(f"[PRUNER] Dropped metadata column: '{col}' (blocklist match)")
            continue
        if X[col].dtype == "object" and len(X) > 0 and X[col].nunique() / len(X) > 0.95:
            X = X.drop(columns=[col])
            pruned_columns.append(col)
            logger.info(f"[PRUNER] Dropped high-cardinality column: '{col}'")
            continue
    if pruned_columns:
        logger.info(f"[PRUNER] Total dropped: {len(pruned_columns)} → {pruned_columns}")
    # ─────────────────────────────────────────────────────────────────────

    task_type = _detect_task_type(y)
    logger.info(f"Detected task type: {task_type} for algorithm: {algorithm}")

    if task_type == "classification":
        if algorithm not in CLASSIFICATION_ALGORITHMS:
            raise ValueError(f"Algorithm '{algorithm}' not available for classification.")
        estimator_class = CLASSIFICATION_ALGORITHMS[algorithm]
    else:
        if algorithm not in REGRESSION_ALGORITHMS:
            raise ValueError(f"Algorithm '{algorithm}' not available for regression.")
        estimator_class = REGRESSION_ALGORITHMS[algorithm]

    # ── Bulletproof Encoder ───────────────────────────────────────────────
    label_encoders: dict[str, LabelEncoder] = {}
    X_processed = X.copy()
    for col in X_processed.select_dtypes(exclude=["number", "bool"]).columns:
        le = LabelEncoder()
        X_processed[col] = le.fit_transform(X_processed[col].astype(str))
        label_encoders[col] = le

    target_encoder: LabelEncoder | None = None
    if task_type == "classification" and not pd.api.types.is_numeric_dtype(y):
        target_encoder = LabelEncoder()
        y = pd.Series(target_encoder.fit_transform(y.astype(str)), name=target_column)
    # ─────────────────────────────────────────────────────────────────────

    X_train, X_test, y_train, y_test = train_test_split(
        X_processed, y, test_size=0.2, random_state=42
    )

    params = training_params or {}

    # ── Structural Guards (tree-based models) ────────────────────────────
    if algorithm in ("random_forest", "gradient_boosting", "decision_tree"):
        params.setdefault("max_depth", 12)
        params.setdefault("min_samples_leaf", 5)
    if algorithm == "random_forest":
        params.setdefault("n_estimators", 100)
    # ─────────────────────────────────────────────────────────────────────

    pipeline = Pipeline([
        ("scaler", StandardScaler()),
        ("model", estimator_class(**params)),
    ])

    logger.info(f"Training {algorithm} ({task_type}) ...")
    pipeline.fit(X_train, y_train)

    y_pred = pipeline.predict(X_test)

    if task_type == "classification":
        metrics: dict[str, Any] = {
            "task_type": "classification",
            "accuracy": round(float(accuracy_score(y_test, y_pred)), 4),
            "f1_score": round(float(f1_score(y_test, y_pred, average="weighted")), 4),
            "train_size": len(X_train),
            "test_size": len(X_test),
        }
        try:
            y_prob = pipeline.predict_proba(X_test)[:, 1]
            if len(np.unique(y)) == 2:
                metrics["log_loss"] = round(float(log_loss(y_test, y_prob)), 4)
                metrics["brier_score"] = round(float(brier_score_loss(y_test, y_prob)), 4)
                metrics["ece"] = round(float(expected_calibration_error(y_test.to_numpy(), y_prob)), 4)
        except Exception:
            pass
    else:
        metrics = {
            "task_type": "regression",
            "mse": round(float(mean_squared_error(y_test, y_pred)), 4),
            "r2_score": round(float(r2_score(y_test, y_pred)), 4),
            "train_size": len(X_train),
            "test_size": len(X_test),
        }

    # ── Feature Importances ───────────────────────────────────────────────
    model_step = pipeline.named_steps["model"]
    feature_names = list(X.columns)
    try:
        if hasattr(model_step, "feature_importances_"):
            weights = model_step.feature_importances_
        elif hasattr(model_step, "coef_"):
            coef = np.abs(model_step.coef_)
            weights = np.mean(coef, axis=0) if coef.ndim > 1 else np.squeeze(coef)
        else:
            weights = np.zeros(len(feature_names))

        if len(weights) == len(feature_names):
            importance_dict = {feature_names[i]: float(weights[i]) for i in range(len(feature_names))}
            metrics["feature_importances"] = dict(
                sorted(importance_dict.items(), key=lambda item: item[1], reverse=True)
            )
        else:
            metrics["feature_importances"] = {}
    except Exception as e:
        logger.warning(f"Failed to extract feature importances: {e}")
        metrics["feature_importances"] = {}
    # ─────────────────────────────────────────────────────────────────────

    if task_type == "classification":
        if target_encoder is not None:
            metrics["class_labels"] = [str(c) for c in target_encoder.classes_]
        else:
            metrics["class_labels"] = [str(c) for c in np.unique(df[target_column])]

    os.makedirs(os.path.dirname(model_save_path), exist_ok=True)
    model_artifact = {
        "pipeline": pipeline,
        "feature_columns": list(X.columns),
        "label_encoders": label_encoders,
        "target_encoder": target_encoder,
        "task_type": task_type,
    }
    joblib.dump(model_artifact, model_save_path, compress=3)

    metrics["feature_columns"] = list(X.columns)
    metrics["sample_data"] = X.head(3).fillna("").to_dict(orient="records")
    metrics["pruned_columns"] = pruned_columns

    logger.info(f"Model serialized to {model_save_path} | metrics: {metrics}")
    return metrics


# ---------------------------------------------------------------------------
# Celery Task: Full Training Pipeline (ml_training queue)
# ---------------------------------------------------------------------------

@celery_app.task(
    name="run_full_training_pipeline",
    bind=True,
    queue="ml_training",
    max_retries=3,
    default_retry_delay=30,
    acks_late=True,
    reject_on_worker_lost=True,
)
def run_full_training_pipeline(
    self,
    model_id_str: str,
    dataset_id: str,
    target_column: str,
    algorithm: str,
    model_save_path: str,
    training_params: dict,
    user_id_str: str,
    model_name: str,
    next_version: int,
    storage_base: str,
):
    """
    Orchestrates the full ML training pipeline with granular state telemetry.

    State machine:
      PENDING (set by FastAPI before .delay()) 
        → PREPROCESSING  (data loading + column pruning)
        → FITTING        (sklearn/xgboost model training)
        → UPLOADING      (Supabase artifact upload)
        → ready          (terminal: success)
        → failed         (terminal: any unrecoverable exception)

    Args:
        model_id_str:    UUID string of the MLModel DB record.
        dataset_id:      UUID string of the dataset file (no extension).
        target_column:   Name of the target/label column.
        algorithm:       e.g. "random_forest", "xgboost", "linear_regression".
        model_save_path: Absolute path inside the container to write the .joblib.
        training_params: Dict of hyperparameters passed to the estimator.
        user_id_str:     UUID string of the owning user.
        model_name:      Human-readable model name (for Supabase path).
        next_version:    Integer version for Supabase path construction.
        storage_base:    Root of the shared volume (e.g. /app/storage).
    """
    dataset_path = os.path.join(storage_base, "datasets", user_id_str, f"{dataset_id}.csv")

    try:
        # ── CHECKPOINT 1: PREPROCESSING ───────────────────────────────────
        _checkpoint(model_id_str, status="training", detail="PREPROCESSING")

        if not os.path.isfile(dataset_path):
            raise FileNotFoundError(
                f"Dataset not found at resolved path: {dataset_path}. "
                f"Check that the model-storage volume is mounted and dataset_id={dataset_id!r} is correct."
            )

        # ── CHECKPOINT 2: FITTING ─────────────────────────────────────────
        _checkpoint(model_id_str, status="training", detail="FITTING")

        metrics = _run_training(
            dataset_path=dataset_path,
            target_column=target_column,
            algorithm=algorithm,
            model_save_path=model_save_path,
            training_params=training_params,
        )

        # ── CHECKPOINT 3: UPLOADING ───────────────────────────────────────
        _checkpoint(model_id_str, status="training", detail="UPLOADING")

        # The shared Docker volume is the canonical source of truth for inference.
        # Supabase Storage is an optional archive/DR backup — prediction-service
        # replicas load from the volume, not from Supabase, so file_path must
        # always point at the volume-relative path regardless of whether the
        # Supabase upload succeeds or fails.
        relative_model_path = os.path.relpath(model_save_path, storage_base)
        final_path = relative_model_path  # Always: shared-volume relative path

        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_KEY")
        cloud_path = f"{user_id_str}/{model_name}/v{next_version}.joblib"

        if url and key:
            try:
                supabase = create_client(url, key)
                with open(model_save_path, "rb") as f:
                    supabase.storage.from_("models").upload(
                        file=f,
                        path=cloud_path,
                        file_options={"content-type": "application/octet-stream"},
                    )
                logger.info(f"[SUPABASE] Archived to Supabase: {cloud_path}")
                # NOTE: final_path intentionally NOT changed to cloud_path.
                # Supabase is archive only; volume is the live serving path.
            except Exception as upload_exc:
                # Non-fatal: model is already on the shared volume.
                logger.warning(
                    f"[SUPABASE] Archive upload failed ({type(upload_exc).__name__}: "
                    f"{upload_exc}). Inference will use local volume path."
                )
        else:
            logger.info("[SUPABASE] No credentials configured — skipping archive upload.")

        # ── TERMINAL STATE: ready ─────────────────────────────────────────
        asyncio.run(
            _write_state(
                model_id_str,
                status="ready",
                status_detail=None,      # Clear detail on terminal state
                metrics=metrics,
                file_path=final_path,   # Always the shared-volume relative path
            )
        )
        logger.info(f"[PIPELINE COMPLETE] model={model_id_str[:8]}… → ready")

        # ── CACHE WARM EVENT ──────────────────────────────────────────────
        # Notify all prediction-service replicas so they can pre-warm their
        # local LRU cache from the shared volume before the first request arrives.
        _publish_model_ready_event(
            model_id_str=model_id_str,
            local_path=final_path,
        )

    except SoftTimeLimitExceeded:
        # Worker has run for 30 min — approaching hard kill. Write failed cleanly.
        logger.error(f"[TIMEOUT] Task soft time limit exceeded for model {model_id_str[:8]}…")
        asyncio.run(
            _write_state(model_id_str, status="failed", status_detail="TIMEOUT")
        )

    except Exception as exc:
        logger.error(f"[PIPELINE FAILED] model={model_id_str[:8]}… error={exc!r}")

        # Exponential retry for transient failures (network, DB hiccup)
        # max_retries=3 → 30s, 60s, 120s wait (default_retry_delay doubles)
        try:
            raise self.retry(exc=exc, countdown=30 * (2 ** self.request.retries))
        except self.MaxRetriesExceededError:
            # All retries exhausted — write failed terminal state
            logger.error(
                f"[DEAD LETTER] model={model_id_str[:8]}… exhausted all retries. "
                f"Routing to dead-letter queue."
            )
            asyncio.run(
                _write_state(model_id_str, status="failed", status_detail="DEAD_LETTER")
            )
            # Dispatch a notification task to the DLQ for audit logging
            handle_dead_letter.apply_async(
                kwargs={
                    "model_id_str": model_id_str,
                    "error": str(exc),
                    "algorithm": algorithm,
                },
                queue="ml_dead_letter",
            )


# ---------------------------------------------------------------------------
# Celery Task: Dead-Letter Handler (ml_dead_letter queue)
# ---------------------------------------------------------------------------

@celery_app.task(name="handle_dead_letter", queue="ml_dead_letter")
def handle_dead_letter(model_id_str: str, error: str, algorithm: str) -> None:
    """
    Receives tasks that have exhausted all retry attempts.

    Responsibilities:
      - Structured audit log (captured by Docker / any log aggregator)
      - Could be extended to send Slack/PagerDuty alerts or write to a
        dead_letter_events table for ops review.
    """
    logger.critical(
        "[DEAD LETTER] Training task permanently failed. "
        f"model_id={model_id_str} algorithm={algorithm!r} error={error!r}. "
        "Manual investigation required."
    )


# ---------------------------------------------------------------------------
# Celery Task: Async Batch Inference (ml_inference queue) — reserved
# ---------------------------------------------------------------------------

@celery_app.task(
    name="run_batch_inference",
    queue="ml_inference",
    soft_time_limit=120,   # 2 min soft limit for inference tasks
    time_limit=180,        # 3 min hard kill
)
def run_batch_inference(model_file_path: str, input_rows: list[dict]) -> list[dict]:
    """
    Reserved for future async batch inference dispatch via Celery.

    Currently the prediction-service handles batch inference synchronously
    (in-process, vectorised sklearn) which is faster for small batches.
    This task exists so the ml_inference queue and inference-worker are
    wired and ready for large offline batch jobs.
    """
    logger.info(
        f"[INFERENCE WORKER] Received batch of {len(input_rows)} rows "
        f"for model: {model_file_path}"
    )
    model_artifact = joblib.load(model_file_path)
    pipeline = model_artifact["pipeline"]
    feature_columns: list[str] = model_artifact["feature_columns"]
    label_encoders: dict = model_artifact.get("label_encoders", {})
    target_encoder = model_artifact.get("target_encoder")

    df = pd.DataFrame(input_rows)[feature_columns]
    for col, le in label_encoders.items():
        if col in df.columns:
            df[col] = le.transform(df[col].astype(str))

    raw_preds = pipeline.predict(df)
    results = []
    for pred in raw_preds:
        val = pred.item() if hasattr(pred, "item") else pred
        if target_encoder is not None:
            val = target_encoder.inverse_transform([int(val)])[0]
        results.append({"result": val})

    return results