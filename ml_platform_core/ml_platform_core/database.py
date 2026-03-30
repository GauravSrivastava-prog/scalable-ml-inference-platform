"""Async SQLAlchemy engine, session factory, and declarative Base."""

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from ml_platform_core.config import get_settings


class Base(DeclarativeBase):
    """Base class for all SQLAlchemy ORM models."""
    pass


_settings = get_settings()

# FIX: Expanded connection pool to prevent 500 errors during concurrent React fetches
engine = create_async_engine(
    _settings.database_url,
    echo=False,
    pool_pre_ping=True,
    pool_size=10,        # Keep 10 connections open and ready
    max_overflow=20,     # Allow up to 20 extra burst connections
    pool_timeout=30,     # Wait up to 30s before failing instead of instantly crashing
)

async_session_factory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)