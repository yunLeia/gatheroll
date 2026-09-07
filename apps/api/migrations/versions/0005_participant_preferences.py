# apps/api/migrations/versions/0005_participant_preferences.py
"""Add participant-scoped upload preferences (include_selfies, include_screenshots)."""

import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "participants",
        sa.Column(
            "include_selfies", sa.Boolean(), nullable=False, server_default=sa.true()
        ),
    )
    op.add_column(
        "participants",
        sa.Column(
            "include_screenshots",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("participants", "include_screenshots")
    op.drop_column("participants", "include_selfies")
