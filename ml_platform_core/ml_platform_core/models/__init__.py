"""SQLAlchemy ORM models — import all models here so Alembic can discover them."""

from ml_platform_core.database import Base
from ml_platform_core.models.user import User
from ml_platform_core.models.ml_model import MLModel
from ml_platform_core.models.prediction import Prediction

__all__ = ["Base", "User", "MLModel", "Prediction"]
