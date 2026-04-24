"""Prediction Service — FastAPI application factory."""
import os
import logging
from contextlib import asynccontextmanager
import asyncio
from sqlalchemy import select, text
from fastapi import FastAPI
from prometheus_fastapi_instrumentator import Instrumentator

from app.core.redis_client import redis_cache
from app.core.cache_instance import model_cache
from ml_platform_core.models.ml_model import MLModel
from ml_platform_core.config import get_settings
from ml_platform_core.database import async_session_factory
from ml_platform_core.exceptions import MLPlatformError, ml_platform_exception_handler
from ml_platform_core.logging import setup_logging
from app.core.sync_worker import flush_telemetry_to_db
from app.routers.predictions import router as predictions_router

settings = get_settings()
logger = setup_logging("prediction-service", settings.log_level)
background_tasks = set()

async def _warm_model_cache():
    """Warm-load recently used models into the in-memory cache
    to reduce cold-start latency."""
    logger.info("Starting model cache warm-up...")

    try:
        async with async_session_factory() as session:
            result = await session.execute(
                select(MLModel)
                .where(MLModel.status == "ready")
                .order_by(MLModel.updated_at.desc())
                .limit(model_cache.max_size)
            )

            models = result.scalars().all()

            if not models:
                logger.info("No ready models found for warm-up.")
                return

            for model in models:
                try:
                    model_path = os.path.join("/app/storage", model.file_path)

                    if not os.path.isfile(model_path):
                        logger.warning(
                            f"Warm-load skipped: file missing for {model.name} v{model.version}"
                        )
                        continue

                    await model_cache.get_model(model_path)

                    logger.info(
                        f"Warm-loaded model: {model.name} v{model.version}"
                    )

                except Exception as exc:
                    logger.error(
                        f"Warm-load failed for model {model.name}: {exc}"
                    )

    except Exception as exc:
        logger.error(f"Model cache warm-up failed: {exc}")


@asynccontextmanager
async def lifespan(application: FastAPI):
    # STARTUP
    await redis_cache.connect()
    await _warm_model_cache()
    
    # Spawn the autonomous daemon worker
    sync_task = asyncio.create_task(flush_telemetry_to_db())
    background_tasks.add(sync_task)
    
    yield
    
    # SHUTDOWN
    sync_task.cancel()
    try:
        await sync_task # Block until the task acknowledges cancellation
    except asyncio.CancelledError:
        pass
        
    await redis_cache.close()


def create_app() -> FastAPI:
    application = FastAPI(
        title="Inference Studio - Prediction Service",
        description="Train. Serve. Scale.",
        version="1.0.0",
        docs_url="/docs",
        redoc_url="/redoc",
        lifespan=lifespan,
    )

    application.add_exception_handler(MLPlatformError, ml_platform_exception_handler)
    application.include_router(
        predictions_router, prefix="/api/v1/predictions", tags=["predictions"]
    )

    @application.get("/health", tags=["health"])
    async def health_check():
        try:
            async with async_session_factory() as session:
                await session.execute(text("SELECT 1"))
            return {"status": "healthy", "database": "connected"}
        except Exception as exc:
            logger.error(f"Health check failed: {exc}")
            from fastapi.responses import JSONResponse
            return JSONResponse(
                status_code=503,
                content={"status": "unhealthy", "database": "disconnected"},
            )

    Instrumentator().instrument(application).expose(application)

    return application

app = create_app()