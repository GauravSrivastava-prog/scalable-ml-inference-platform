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

logger = logging.getLogger(__name__)

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

    os.makedirs(os.path.dirname(model_save_path), exist_ok=True)
    model_artifact = {
        "pipeline": pipeline,
        "feature_columns": list(X.columns),
        "label_encoders": label_encoders,
        "target_encoder": target_encoder,
        "task_type": task_type,
    }
    joblib.dump(model_artifact, model_save_path)
    metrics["feature_columns"] = list(X.columns)
    metrics["sample_data"] = X.head(3).fillna("").to_dict(orient="records")
    
    logger.info(f"Model saved to {model_save_path} | metrics: {metrics}")
    return metrics