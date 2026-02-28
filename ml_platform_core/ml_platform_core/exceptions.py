"""Custom exception classes and FastAPI exception handler."""

from fastapi import Request
from fastapi.responses import JSONResponse


class MLPlatformError(Exception):
    """Base exception for the ML Platform."""

    def __init__(self, message: str, status_code: int = 500):
        self.message = message
        self.status_code = status_code
        super().__init__(self.message)


class ResourceNotFoundError(MLPlatformError):
    """Raised when a requested resource does not exist or is not accessible."""

    def __init__(self, message: str = "Resource not found"):
        super().__init__(message, status_code=404)


class ConflictError(MLPlatformError):
    """Raised when a resource already exists (e.g. duplicate email)."""

    def __init__(self, message: str = "Resource already exists"):
        super().__init__(message, status_code=409)


class DataValidationError(MLPlatformError):
    """Raised for business-logic validation failures."""

    def __init__(self, message: str = "Validation error"):
        super().__init__(message, status_code=422)


class FileTooLargeError(MLPlatformError):
    """Raised when an uploaded file exceeds the size limit."""

    def __init__(self, message: str = "File too large"):
        super().__init__(message, status_code=413)


class UnsupportedMediaTypeError(MLPlatformError):
    """Raised when an uploaded file has an unsupported type."""

    def __init__(self, message: str = "Unsupported media type"):
        super().__init__(message, status_code=415)


class TrainingError(MLPlatformError):
    """Raised when model training fails."""

    def __init__(self, message: str = "Model training failed"):
        super().__init__(message, status_code=500)


# ---------------------------------------------------------------------------
# FastAPI exception handler — register on every service app
# ---------------------------------------------------------------------------

async def ml_platform_exception_handler(
    request: Request, exc: MLPlatformError
) -> JSONResponse:
    """Convert MLPlatformError subclasses into structured JSON responses."""
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.message},
    )
