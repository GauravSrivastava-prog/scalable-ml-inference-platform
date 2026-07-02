"""
Telemetry router — direct PostgreSQL aggregations.

Replaces the Prometheus scrape pipeline which is unavailable on cloud
deployments. All metrics are computed from real-time DB queries.
"""

from __future__ import annotations

import logging
from fastapi import APIRouter, Depends
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ml_platform_core.dependencies import get_db
from ml_platform_core.models.prediction import Prediction
from ml_platform_core.models.ml_model import MLModel

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/postgres")
async def get_postgres_telemetry(db: AsyncSession = Depends(get_db)):
    """
    Return real-time system telemetry aggregated directly from PostgreSQL.

    This endpoint is always available — no external monitoring stack required.
    It replaces the Prometheus-based mission-control endpoint which fails on
    deployments where Prometheus is not co-located with the prediction service.

    Response contract (matches SystemPulse dashboard bindings):
        total_predictions   : int   — total rows in predictions table
        avg_latency_ms      : float — mean latency across all completed predictions
        active_models       : int   — models with status == "ready"
        cluster_status      : str   — always "ONLINE" when this endpoint responds
        p95_sparkline       : list  — last 30 individual latency_ms values (oldest→newest)
        success_rate        : float — pct of predictions with status == "completed"
    """
    try:
        # ── Total predictions ──────────────────────────────────────────────
        total_result = await db.execute(
            select(func.count()).select_from(Prediction)
        )
        total_predictions: int = total_result.scalar() or 0

        # ── Average latency (ms) across ALL completed predictions ──────────
        avg_result = await db.execute(
            select(func.avg(Prediction.latency_ms))
            .where(Prediction.latency_ms.isnot(None))
        )
        avg_latency_raw = avg_result.scalar()
        avg_latency_ms: float = round(float(avg_latency_raw), 2) if avg_latency_raw else 0.0

        # ── Active (ready) models ──────────────────────────────────────────
        model_result = await db.execute(
            select(func.count()).select_from(MLModel).where(MLModel.status == "ready")
        )
        active_models: int = model_result.scalar() or 0

        # ── Success rate ───────────────────────────────────────────────────
        completed_result = await db.execute(
            select(func.count()).where(Prediction.status == "completed")
        )
        completed: int = completed_result.scalar() or 0
        success_rate: float = (
            round((completed / total_predictions) * 100, 1) if total_predictions > 0 else 0.0
        )

        # ── P95 sparkline: last 30 latency samples (oldest → newest) ──────
        sparkline_result = await db.execute(
            select(Prediction.latency_ms)
            .where(Prediction.latency_ms.isnot(None))
            .order_by(Prediction.created_at.desc())
            .limit(30)
        )
        sparkline_raw = sparkline_result.scalars().all()
        # Reverse: DB returns newest-first; EKG chart needs oldest-first
        p95_sparkline = [round(float(v), 1) for v in reversed(sparkline_raw)]

        # Pad to at least 10 points so the chart always renders
        if len(p95_sparkline) < 10:
            p95_sparkline = ([0.0] * (10 - len(p95_sparkline))) + p95_sparkline

        return {
            "total_predictions": total_predictions,
            "avg_latency_ms": avg_latency_ms,
            "active_models": active_models,
            "cluster_status": "ONLINE",
            "p95_sparkline": p95_sparkline,
            "success_rate": success_rate,
        }

    except Exception as exc:
        logger.error("[TELEMETRY] PostgreSQL aggregation failed: %s", exc, exc_info=True)
        # Return safe defaults so the frontend never crashes
        return {
            "total_predictions": 0,
            "avg_latency_ms": 0.0,
            "active_models": 0,
            "cluster_status": "DEGRADED",
            "p95_sparkline": [0.0] * 10,
            "success_rate": 0.0,
        }
