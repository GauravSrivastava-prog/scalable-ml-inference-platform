"""Model Service — FastAPI application factory."""

from fastapi import FastAPI
from sqlalchemy import text
from prometheus_fastapi_instrumentator import Instrumentator
from ml_platform_core.config import get_settings
from ml_platform_core.database import async_session_factory
from ml_platform_core.exceptions import MLPlatformError, ml_platform_exception_handler
from ml_platform_core.logging import setup_logging
from fastapi.middleware.cors import CORSMiddleware
from app.routers.models import router as models_router

settings = get_settings()
logger = setup_logging("model-service", settings.log_level)


def create_app() -> FastAPI:
    application = FastAPI(
        title="Inference Studio - Model Service",
        description="Train. Serve. Scale.",
        version="1.0.0",
        docs_url="/docs",
        redoc_url="/redoc"
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:5173", 
            "https://scalable-ml-inference-platform-6j5m.vercel.app"
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    application.add_exception_handler(MLPlatformError, ml_platform_exception_handler)
    
    # ✅ FIX 1: Clean prefix (No trailing slash!)
    application.include_router(models_router, prefix="/api/v1/models", tags=["models"])

    # ✅ FIX 2: Middleware to bridge the gap with Nginx
    @application.middleware("http")
    async def fix_nginx_trailing_slash(request, call_next):
        path = request.url.path
        # If Nginx sends /api/v1/models/, we internally treat it as /api/v1/models
        if path.endswith("/") and path.startswith("/api/v1/models") and len(path) > 15:
            request.scope["path"] = path.rstrip("/")
        return await call_next(request)

    @application.get("/health", tags=["health"])
    async def health_check():
        # ... (keep your existing health check code here) ...
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
