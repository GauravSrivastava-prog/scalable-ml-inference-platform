"""Model service request / response schemas."""

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class DatasetUploadResponse(BaseModel):
    dataset_id: str
    filename: str
    rows: int
    columns: list[str]


class ModelTrainRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    dataset_id: str
    algorithm: str = Field(..., pattern=r"^(random_forest|logistic_regression|linear_regression|gradient_boosting|decision_tree|xgboost)$")
    target_column: str
    training_params: dict[str, Any] | None = None


class ModelTrainResponse(BaseModel):
    model_id: UUID
    name: str
    version: int
    status: str

    model_config = ConfigDict(from_attributes=True)


class ModelResponse(BaseModel):
    id: UUID
    name: str
    version: int
    algorithm: str
    status: str
    metrics: dict[str, Any] | None = None
    training_params: dict[str, Any] | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ModelListResponse(BaseModel):
    id: UUID
    name: str
    version: int
    algorithm: str
    status: str
    metrics: dict[str, Any] | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
