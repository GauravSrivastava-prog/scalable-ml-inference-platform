"""Prediction service request / response schemas."""

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class Prediction(Base):
    __tablename__ = "predictions"
    
    __mapper_args__ = {
        "confirm_deleted_rows": False
    }

class PredictionRequest(BaseModel):
    model_id: UUID
    input_data: dict[str, Any]


class PredictionResponse(BaseModel):
    prediction_id: UUID
    result: Any
    latency_ms: float
    probabilities: list[float] | None = None


class PredictionDetailResponse(BaseModel):
    id: UUID
    model_id: UUID
    input_data: dict[str, Any]
    result: Any
    latency_ms: float
    status: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class PredictionListResponse(BaseModel):
    id: UUID
    model_id: UUID
    result: Any
    latency_ms: float
    status: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

class BatchPredictionRequest(BaseModel):
    model_id: UUID
    input_data: list[dict[str, Any]]


class BatchPredictionItem(BaseModel):
    result: Any | None = None
    probabilities: list[float] | None = None
    error: str | None = None


class BatchPredictionResponse(BaseModel):
    model_id: UUID
    predictions: list[BatchPredictionItem]
    total_predictions: int
    successful_predictions: int
    failed_predictions: int
    latency_ms: float