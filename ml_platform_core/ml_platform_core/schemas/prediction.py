"""Prediction service request / response schemas."""

from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict


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
