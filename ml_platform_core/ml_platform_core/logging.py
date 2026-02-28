"""Structured logging configuration for all services."""

import logging
import sys


def setup_logging(service_name: str, level: str = "INFO") -> logging.Logger:
    """Configure structured logging and return a named logger.

    Args:
        service_name: Name used as the logger's namespace.
        level: Log level string (DEBUG, INFO, WARNING, ERROR, CRITICAL).

    Returns:
        Configured Logger instance for the service.
    """
    log_level = getattr(logging, level.upper(), logging.INFO)

    logging.basicConfig(
        level=log_level,
        format="%(asctime)s | %(name)s | %(levelname)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        stream=sys.stdout,
        force=True,
    )

    # Reduce noise from third-party libraries
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)

    return logging.getLogger(service_name)
