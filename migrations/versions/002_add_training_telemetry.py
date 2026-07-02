"""Add status_detail and celery_task_id to ml_models

Adds two nullable columns that power granular training telemetry:
  - status_detail: free-text checkpoint label (PREPROCESSING, FITTING, etc.)
  - celery_task_id: the Celery async result ID, enabling external polling

Revision ID: 002_add_training_telemetry
Revises: 001_initial_schema
Create Date: 2026-06-14
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "002_add_training_telemetry"
down_revision: Union[str, None] = "001_initial_schema"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # status_detail: human-readable in-progress checkpoint (e.g. "FITTING")
    op.add_column(
        "ml_models",
        sa.Column("status_detail", sa.Text(), nullable=True),
    )
    # celery_task_id: UUID-like string returned by .delay() — used for polling
    op.add_column(
        "ml_models",
        sa.Column("celery_task_id", sa.String(255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("ml_models", "celery_task_id")
    op.drop_column("ml_models", "status_detail")
