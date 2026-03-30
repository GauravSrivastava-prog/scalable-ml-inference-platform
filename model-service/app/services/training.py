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


logger = logging.getLogger(__name__)

# Algorithm registry keyed by task type
CLASSIFICATION_ALGORITHMS: dict[str, type] = {
    "random_forest": RandomForestClassifier,
    "logistic_regression": LogisticRegression,
    "gradient_boosting": GradientBoostingClassifier,
}

REGRESSION_ALGORITHMS: dict[str, type] = {
    "random_forest": RandomForestRegressor,
    "linear_regression": LinearRegression,
    "gradient_boosting": GradientBoostingRegressor,
}


def _detect_task_type(y: pd.Series) -> str:
    """Auto-detect classification vs regression from the target column."""
    if y.dtype == "object" or y.dtype.name == "category":
        return "classification"
    if y.nunique() <= 20:
        return "classification"
    return "regression"

def expected_calibration_error(y_true, y_prob, n_bins: int = 10) -> float:
    """
    Proper Expected Calibration Error (ECE) for binary classification.
    """
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
    """Train a scikit-learn model, evaluate, serialize, and return metrics.

    Args:
        dataset_path: Absolute path to the CSV dataset.
        target_column: Name of the target column.
        algorithm: Algorithm key (random_forest, logistic_regression, etc.).
        model_save_path: Where to save the serialized model artifact.
        training_params: Optional hyperparameters passed to the estimator.

    Returns:
        Dictionary of evaluation metrics.

    Raises:
        ValueError: On algorithm/data incompatibility.
    """
    logger.info(f"Loading dataset from {dataset_path}")
    df = pd.read_csv(dataset_path)

    X = df.drop(columns=[target_column])
    y = df[target_column]

    task_type = _detect_task_type(y)
    logger.info(f"Detected task type: {task_type} for algorithm: {algorithm}")

    # Validate algorithm compatibility with task type
    if task_type == "classification":
        if algorithm not in CLASSIFICATION_ALGORITHMS:
            raise ValueError(
                f"Algorithm '{algorithm}' is not available for classification. "
                f"Available: {list(CLASSIFICATION_ALGORITHMS.keys())}"
            )
        estimator_class = CLASSIFICATION_ALGORITHMS[algorithm]
    else:
        if algorithm not in REGRESSION_ALGORITHMS:
            raise ValueError(
                f"Algorithm '{algorithm}' is not available for regression. "
                f"Available: {list(REGRESSION_ALGORITHMS.keys())}"
            )
        estimator_class = REGRESSION_ALGORITHMS[algorithm]

    # Encode categorical features
    label_encoders: dict[str, LabelEncoder] = {}
    X_processed = X.copy()
    for col in X_processed.select_dtypes(include=["object"]).columns:
        le = LabelEncoder()
        X_processed[col] = le.fit_transform(X_processed[col].astype(str))
        label_encoders[col] = le

    # Encode categorical target for classification
    target_encoder: LabelEncoder | None = None
    if task_type == "classification" and y.dtype == "object":
        target_encoder = LabelEncoder()
        y = pd.Series(target_encoder.fit_transform(y), name=target_column)

    # Train / test split
    X_train, X_test, y_train, y_test = train_test_split(
        X_processed, y, test_size=0.2, random_state=42
    )

    # Build pipeline
    params = training_params or {}
    pipeline = Pipeline([
        ("scaler", StandardScaler()),
        ("model", estimator_class(**params)),
    ])

    logger.info(f"Training {algorithm} ({task_type}) ...")
    pipeline.fit(X_train, y_train)

    # Evaluate
    y_pred = pipeline.predict(X_test)
    # Get prediction probabilities
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
        
        # Only calculate advanced probability metrics for BINARY classification to prevent matrix shape errors
        if hasattr(pipeline, "predict_proba") and len(np.unique(y)) == 2:
            y_prob = pipeline.predict_proba(X_test)[:, 1]
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

    # Serialize model artifact (pipeline + metadata for prediction)
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
    # We grab the first 3 rows of the raw X dataframe, fill NaNs so JSON doesn't crash, and convert to dict
    metrics["sample_data"] = X.head(3).fillna("").to_dict(orient="records")
    logger.info(f"Model saved to {model_save_path} | metrics: {metrics}")
    return metrics
