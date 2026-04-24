import uuid
from sqlalchemy import Integer, ForeignKey
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from ml_platform_core.database import Base

class UserAnalytics(Base):
    __tablename__ = "user_analytics"

    user_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True), 
        ForeignKey("users.id", ondelete="CASCADE"), 
        primary_key=True
    )
    total_cache_hits: Mapped[int] = mapped_column(Integer, default=0)
    
    # Explicit relationship following your codebase standards
    user: Mapped["User"] = relationship("User", back_populates="analytics")