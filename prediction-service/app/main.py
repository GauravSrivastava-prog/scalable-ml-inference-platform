"""Prediction Service — FastAPI application factory."""

from fastapi import FastAPI
from sqlalchemy import text

from ml_platform_core.config import get_settings
from ml_platform_core.database import async_session_factory
from ml_platform_core.exceptions import MLPlatformError, ml_platform_exception_handler
from ml_platform_core.logging import setup_logging

from app.routers.predictions import router as predictions_router

settings = get_settings()
logger = setup_logging("prediction-service", settings.log_level)


def create_app() -> FastAPI:
    application = FastAPI(
        title="ML Platform — Prediction Service",
        version="1.0.0",
        docs_url="/docs",
        redoc_url="/redoc",
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

    return application


app = create_app()
