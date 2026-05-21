"""Predictions router — run inference, list/get predictions."""

import os
from uuid import UUID
import httpx
import logging
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from ml_platform_core.schemas.prediction import BatchPredictionRequest, BatchPredictionResponse
from ml_platform_core.dependencies import get_current_user, get_db
from ml_platform_core.models.user import User
from ml_platform_core.schemas.prediction import (
    PredictionDetailResponse,
    PredictionListResponse,
    PredictionRequest,
    PredictionResponse,
)

from app.services.prediction_service import PredictionService

logger = logging.getLogger(__name__)

router = APIRouter()

# -------------------------------------------------------------------
# 1. STATIC ROUTES (Must go at the top so they don't get swallowed)
# -------------------------------------------------------------------
@router.get("/telemetry/live")
async def get_live_telemetry(db: AsyncSession = Depends(get_db)):
    """Returns formatted metrics for the UI.
    Strategy: Try Prometheus first (Docker/local), fall back to direct DB/Redis (Render prod)."""
    
    base_url = os.getenv("PROMETHEUS_URL", "http://prometheus:9090").rstrip("/")
    prometheus_url = f"{base_url}/api/v1/query"
    
    telemetry = {
        "cache_hit_rate": 0.0,
        "p95_latency_ms": 0.0,
        "total_predictions": 0,
        "current_rps": 0.0,
        "system_healthy": True
    }

    prometheus_ok = False

    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            # 1. Get Total Predictions
            res_total = await client.get(prometheus_url, params={'query': 'sum(inference_requests_total)'})
            if res_total.status_code == 200 and res_total.json()['data']['result']:
                telemetry["total_predictions"] = int(float(res_total.json()['data']['result'][0]['value'][1]))

            # 2. Get P95 Latency (in ms)
            res_lat = await client.get(prometheus_url, params={'query': 'histogram_quantile(0.95, sum(rate(inference_latency_seconds_bucket[5m])) by (le)) * 1000'})
            if res_lat.status_code == 200 and res_lat.json()['data']['result']:
                val = res_lat.json()['data']['result'][0]['value'][1]
                telemetry["p95_latency_ms"] = round(float(val), 2) if val != 'NaN' else 0.0

            # 3. Get Current Traffic (Requests Per Second)
            res_rps = await client.get(prometheus_url, params={'query': 'sum(rate(http_requests_total[1m]))'})
            if res_rps.status_code == 200 and res_rps.json()['data']['result']:
                telemetry["current_rps"] = round(float(res_rps.json()['data']['result'][0]['value'][1]), 2)

            # 4. Get Cache Hit Rate
            res_cache = await client.get(prometheus_url, params={'query': '(sum(inference_requests_total{status="cache_hit"}) / sum(inference_requests_total)) * 100'})
            if res_cache.status_code == 200 and res_cache.json()['data']['result']:
                val = res_cache.json()['data']['result'][0]['value'][1]
                telemetry["cache_hit_rate"] = round(float(val), 1) if val != 'NaN' else 0.0

        if telemetry["total_predictions"] > 0 or telemetry["current_rps"] > 0:
            prometheus_ok = True

    except Exception as e:
        logger.warning(f"Prometheus proxy failed (falling back to DB): {e}")

    # ── DATABASE FALLBACK ─────────────────────────────────────────────
    if not prometheus_ok:
        try:
            from sqlalchemy import func, text as sa_text, select
            from ml_platform_core.models.prediction import Prediction
            from app.core.redis_client import redis_cache

            # Total completed predictions
            total_result = await db.execute(
                select(func.count()).select_from(Prediction).where(Prediction.status == "completed")
            )
            telemetry["total_predictions"] = total_result.scalar() or 0

            # P95 latency (ms)
            p95_result = await db.execute(
                sa_text(
                    "SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) "
                    "FROM predictions WHERE status = 'completed' AND latency_ms IS NOT NULL"
                )
            )
            p95_val = p95_result.scalar()
            telemetry["p95_latency_ms"] = round(float(p95_val), 2) if p95_val is not None else 0.0

            # Current RPS
            rps_result = await db.execute(
                sa_text(
                    "SELECT COUNT(*) FROM predictions "
                    "WHERE created_at > NOW() - INTERVAL '60 seconds'"
                )
            )
            recent_count = rps_result.scalar() or 0
            telemetry["current_rps"] = round(recent_count / 60.0, 2)

            # Cache hit rate from Redis
            if redis_cache.client:
                try:
                    total_cache_hits = 0
                    async for key in redis_cache.client.scan_iter("user_stats:*", count=100):
                        hits_raw = await redis_cache.client.hget(key, "pending_cache_hits")
                        total_cache_hits += int(hits_raw) if hits_raw else 0
                    
                    total_all = telemetry["total_predictions"] + total_cache_hits
                    if total_all > 0:
                        telemetry["cache_hit_rate"] = round((total_cache_hits / total_all) * 100, 1)
                except Exception as redis_err:
                    logger.warning(f"Redis cache hit rate lookup failed: {redis_err}")

            telemetry["system_healthy"] = True
            logger.info("[TELEMETRY] Served metrics from PostgreSQL/Redis fallback.")

        except Exception as db_err:
            logger.error(f"Database telemetry fallback failed: {db_err}")
            telemetry["system_healthy"] = False

    return telemetry


@router.post("/batch", response_model=BatchPredictionResponse)
async def batch_predict(
    request: BatchPredictionRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await PredictionService.batch_predict(
        db=db,
        user=current_user,
        request=request,
        background_tasks=background_tasks
    )


# -------------------------------------------------------------------
# 2. DYNAMIC ROUTES (Must go at the bottom)
# -------------------------------------------------------------------
@router.post(
    "/predict",
    response_model=PredictionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def predict(
    body: PredictionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Run synchronous inference on a trained model."""
    return await PredictionService.predict(db, body, current_user)


@router.get("/", response_model=list[PredictionListResponse])
async def list_predictions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all predictions for the current user."""
    return await PredictionService.list_predictions(db, current_user)


@router.get("/{prediction_id}", response_model=PredictionDetailResponse)
async def get_prediction(
    prediction_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a specific prediction (ownership-scoped)."""
    return await PredictionService.get_prediction(db, prediction_id, current_user)