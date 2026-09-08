"""Add participant-scoped upload preferences (include_selfies, include_screenshots).

This branches from 0003, not 0004: a concurrent, unrelated task in another session
already claims revision id "0004" for a different migration. Branching here avoids a
future duplicate-revision-id collision. Reconcile with `alembic merge` once both land
on the same branch.
"""

import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0003"
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
