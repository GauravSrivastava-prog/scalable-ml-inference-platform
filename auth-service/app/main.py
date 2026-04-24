"""Auth Service — FastAPI application factory."""

from fastapi import FastAPI
from sqlalchemy import text
from prometheus_fastapi_instrumentator import Instrumentator
from ml_platform_core.config import get_settings
from ml_platform_core.database import async_session_factory
from ml_platform_core.exceptions import MLPlatformError, ml_platform_exception_handler
from ml_platform_core.logging import setup_logging
from ml_platform_core.database import engine
from ml_platform_core.models import Base
from app.routers.auth import router as auth_router

settings = get_settings()
logger = setup_logging("auth-service", settings.log_level)


def create_app() -> FastAPI:
    application = FastAPI(
        title="Inference Studio - Auth Service",
        description="Train. Serve. Scale.",
        version="1.0.0",
        docs_url="/docs",
        redoc_url="/redoc",
    )

    application.add_exception_handler(MLPlatformError, ml_platform_exception_handler)
    application.include_router(auth_router, prefix="/api/v1/auth", tags=["auth"])

    @application.get("/health", tags=["health"])
    async def health_check():
        """Verify service and database connectivity."""
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

# 1. This creates your FastAPI application instance
app = create_app()

# 2. EMERGENCY BOOTSTRAP: Add this right below `app = create_app()`
@app.on_event("startup")
async def init_db():
    print("=== EMERGENCY BOOTSTRAP: CREATING MISSING TABLES ===")
    async with engine.begin() as conn:
        # This will scan your models and create the user_analytics table in Neon
        await conn.run_sync(Base.metadata.create_all)
    print("=== BOOTSTRAP COMPLETE ===")