"""Auth request / response schemas."""

from datetime import datetime
from uuid import UUID
from typing import List
from pydantic import BaseModel, ConfigDict, EmailStr, Field


class UserRegisterRequest(BaseModel):
    email: EmailStr
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=8, max_length=128)


class UserRegisterResponse(BaseModel):
    id: UUID
    email: str
    username: str

    model_config = ConfigDict(from_attributes=True)


class UserLoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class TokenRefreshRequest(BaseModel):
    refresh_token: str


class TokenRefreshResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    id: UUID
    email: str
    username: str
    is_active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

class AlgorithmUsage(BaseModel):
    algorithm: str
    count: int

class UserStatsResponse(BaseModel):
    total_predictions: int
    successful_predictions: int
    cache_hits: int
    avg_latency_ms: float
    compute_time_saved_ms: float
    total_data_rows_processed: int
    total_models_trained: int
    algorithm_usage: List[AlgorithmUsage]
    member_since: datetime