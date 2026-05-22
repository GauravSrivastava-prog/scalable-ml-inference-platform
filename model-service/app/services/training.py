"""scikit-learn training pipeline — fit, evaluate, serialize."""

import logging
import os
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
import asyncio
from sqlalchemy import update
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool
from supabase import create_client
from ml_platform_core.models.ml_model import MLModel

logger = logging.getLogger(__name__)
# --- NEW CELERY SETUP ---
# Grab the Upstash Redis URL from your .env file
redis_url = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

# FIX: Celery requires explicit SSL config for Upstash (rediss://)
if redis_url.startswith("rediss://") and "ssl_cert_reqs" not in redis_url:
    redis_url += "?ssl_cert_reqs=CERT_NONE"

celery_app = Celery(
    'training_tasks',
    broker=redis_url,
    backend=redis_url  # This allows Celery to save the task status/result back to Redis
)
# ------------------------
# Algorithm registry keyed by task type
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

@celery_app.task(name="train_model_background")
def train_model(
    dataset_path: str,
    target_column: str,
    algorithm: str,
    model_save_path: str,
    training_params: dict[str, Any] | None = None,
) -> dict[str, Any]:
    
    logger.info(f"Loading dataset from {dataset_path}")
    df = pd.read_csv(dataset_path)

    X = df.drop(columns=[target_column])
    y = df[target_column]

    # ── INTELLIGENT COLUMN PRUNER ──────────────────────────────────────
    # Drop non-predictive metadata columns that cause tree bloat and data leakage.
    # Columns are matched case-insensitively against a known metadata blocklist,
    # OR dynamically detected as near-unique string identifiers (cardinality > 95%).
    NON_PREDICTIVE_METADATA = {
        "unnamed: 0", "track_id", "track_name", "album_name",
        "artists", "id", "index", "row_id", "song_id", "user_id",
    }
    pruned_columns: list[str] = []
    for col in list(X.columns):
        # Rule 1: Drop known metadata strings (case-insensitive exact match)
        if col.lower().strip() in NON_PREDICTIVE_METADATA:
            X = X.drop(columns=[col])
            pruned_columns.append(col)
            logger.info(f"[PRUNER] Dropped metadata column: '{col}' (blocklist match)")
            continue
        # Rule 2: Drop any object column where >95% of values are unique
        # This catches arbitrary ID / free-text columns not in the blocklist.
        if X[col].dtype == "object" and len(X) > 0 and X[col].nunique() / len(X) > 0.95:
            X = X.drop(columns=[col])
            pruned_columns.append(col)
            logger.info(f"[PRUNER] Dropped high-cardinality column: '{col}' ({X[col].nunique() if col in X.columns else 'N/A'} unique values)")
            continue
    if pruned_columns:
        logger.info(f"[PRUNER] Total dropped: {len(pruned_columns)} columns → {pruned_columns}")
    # ──────────────────────────────────────────────────────────────────

    task_type = _detect_task_type(y)
    logger.info(f"Detected task type: {task_type} for algorithm: {algorithm}")

    if task_type == "classification":
        if algorithm not in CLASSIFICATION_ALGORITHMS:
            raise ValueError(f"Algorithm '{algorithm}' is not available for classification.")
        estimator_class = CLASSIFICATION_ALGORITHMS[algorithm]
    else:
        if algorithm not in REGRESSION_ALGORITHMS:
            raise ValueError(f"Algorithm '{algorithm}' is not available for regression.")
        estimator_class = REGRESSION_ALGORITHMS[algorithm]

    # --- THE BULLETPROOF ENCODER FIX ---
    label_encoders: dict[str, LabelEncoder] = {}
    X_processed = X.copy()
    
    # We now explicitly exclude numbers and booleans, catching ALL text formats
    for col in X_processed.select_dtypes(exclude=["number", "bool"]).columns:
        le = LabelEncoder()
        X_processed[col] = le.fit_transform(X_processed[col].astype(str))
        label_encoders[col] = le

    target_encoder: LabelEncoder | None = None
    if task_type == "classification" and not pd.api.types.is_numeric_dtype(y):
        target_encoder = LabelEncoder()
        y = pd.Series(target_encoder.fit_transform(y.astype(str)), name=target_column)
    # -----------------------------------

    X_train, X_test, y_train, y_test = train_test_split(
        X_processed, y, test_size=0.2, random_state=42
    )

    params = training_params or {}

    # ── STRUCTURAL GUARDS (tree-based models) ─────────────────────────
    # Apply safe defaults to prevent unbounded tree growth which causes
    # .joblib artifact size to explode beyond the 50MB Supabase free-tier.
    # setdefault() only applies if the user didn't pass an explicit value.
    if algorithm in ("random_forest", "gradient_boosting", "decision_tree"):
        params.setdefault("max_depth", 12)
        params.setdefault("min_samples_leaf", 5)
    if algorithm == "random_forest":
        params.setdefault("n_estimators", 100)
    # ──────────────────────────────────────────────────────────────────

    pipeline = Pipeline([
        ("scaler", StandardScaler()),
        ("model", estimator_class(**params)),
    ])

    logger.info(f"Training {algorithm} ({task_type}) ...")
    pipeline.fit(X_train, y_train)

    y_pred = pipeline.predict(X_test)
    
    if hasattr(pipeline, "predict_proba"):
        y_prob = pipeline.predict_proba(X_test)[:, 1]
    else:
        y_prob = None

    if task_type == "classification":
        metrics: dict[str, Any] = {
            "task_type": "classification",
            "accuracy": round(float(accuracy_score(y_test, y_pred)), 4),
            "f1_score": round(float(f1_score(y_test, y_pred, average="weighted")), 4),
            "train_size": len(X_train),
            "test_size": len(X_test),
        }
        
        if hasattr(pipeline, "predict_proba") and len(np.unique(y)) == 2:
            metrics["log_loss"] = round(float(log_loss(y_test, y_prob)), 4)
            metrics["brier_score"] = round(float(brier_score_loss(y_test, y_prob)), 4)
            metrics["ece"] = round(float(expected_calibration_error(y_test.to_numpy(), y_prob)), 4)
    else:
        metrics = {
            "task_type": "regression",
            "mse": round(float(mean_squared_error(y_test, y_pred)), 4),
            "r2_score": round(float(r2_score(y_test, y_pred)), 4),
            "train_size": len(X_train),
            "test_size": len(X_test),
        }

    # ==========================================
    # PHASE 1: EXTRACT FEATURE IMPORTANCES
    # ==========================================
    model_step = pipeline.named_steps["model"]
    feature_names = list(X.columns)
    
    try:
        if hasattr(model_step, "feature_importances_"):
            # Tree-based models (Random Forest, XGBoost)
            weights = model_step.feature_importances_
        elif hasattr(model_step, "coef_"):
            # Linear models (Logistic/Linear Regression)
            # coef_ can be multi-dimensional for multi-class, so we take the mean of the absolute values
            coef = np.abs(model_step.coef_)
            weights = np.mean(coef, axis=0) if coef.ndim > 1 else np.squeeze(coef)
        else:
            weights = np.zeros(len(feature_names))
            
        # Ensure dimensions match before saving
        if len(weights) == len(feature_names):
            importance_dict = {feature_names[i]: float(weights[i]) for i in range(len(feature_names))}
            # Sort by highest importance descending
            metrics["feature_importances"] = dict(sorted(importance_dict.items(), key=lambda item: item[1], reverse=True))
        else:
            metrics["feature_importances"] = {}
    except Exception as e:
        logger.warning(f"Failed to extract feature importances: {e}")
        metrics["feature_importances"] = {}

    # ==========================================
    # PHASE 1: EXTRACT CLASS LABELS (For UI Donut Chart)
    # ==========================================
    if task_type == "classification":
        if target_encoder is not None:
            metrics["class_labels"] = [str(c) for c in target_encoder.classes_]
        else:
            # If no target_encoder was used, grab unique values directly from the original dataframe
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
    metrics["pruned_columns"] = pruned_columns  # For Feature Pruning Log in Canvas

    logger.info(f"Model saved to {model_save_path} | metrics: {metrics}")
    return metrics

@celery_app.task(name="run_full_training_pipeline")
def run_full_training_pipeline(
    model_id_str: str, 
    dataset_path: str, 
    target_column: str, 
    algorithm: str, 
    model_save_path: str, 
    training_params: dict, 
    user_id_str: str, 
    model_name: str, 
    next_version: int
):
    # --- ISOLATED DATABASE UPDATER ---
    async def _update_db(final_status: str, final_metrics: dict = None, final_path: str = None):
        db_url = os.environ.get("DATABASE_URL")
        # Ensure it uses the asyncpg driver
        if db_url and db_url.startswith("postgresql://"):
            db_url = db_url.replace("postgresql://", "postgresql+asyncpg://")
        
        # Create a fresh engine that DOES NOT pool connections (safe for Celery & asyncio.run)
        engine = create_async_engine(db_url, poolclass=NullPool)
        
        try:
            async with engine.begin() as conn:
                if final_status == "ready":
                    await conn.execute(
                        update(MLModel)
                        .where(MLModel.id == model_id_str)
                        .values(status="ready", metrics=final_metrics, file_path=final_path)
                    )
                else:
                    await conn.execute(
                        update(MLModel)
                        .where(MLModel.id == model_id_str)
                        .values(status="failed")
                    )
        finally:
            # Safely tear down the engine before the asyncio loop closes
            await engine.dispose()
    # ---------------------------------

    try:
        # 1. Run the Heavy ML Math
        metrics = train_model(
            dataset_path=dataset_path,
            target_column=target_column,
            algorithm=algorithm,
            model_save_path=model_save_path,
            training_params=training_params
        )

        # 2. Upload to Supabase (Background Network I/O)
        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_KEY")
        cloud_path = f"{user_id_str}/{model_name}/v{next_version}.joblib"
        
        if url and key:
            supabase = create_client(url, key)
            with open(model_save_path, "rb") as f:
                supabase.storage.from_("models").upload(
                    file=f,
                    path=cloud_path,
                    file_options={"content-type": "application/octet-stream"}
                )
            logger.info(f"Worker uploaded to Supabase: {cloud_path}")
        else:
            cloud_path = model_save_path  # Local fallback

        # 3. Update Postgres using the isolated async function
        asyncio.run(_update_db("ready", metrics, cloud_path))

    except Exception as exc:
        logger.error(f"Worker Training Failed: {str(exc)}")
        # If it fails, securely update Postgres to "failed"
        asyncio.run(_update_db("failed"))