"""Merge optional event context (0004) and upload preferences (0005).

Both branch from 0003: 0004 was authored concurrently in another session and
0005 avoided claiming its revision id to prevent a collision. No schema
changes; this only joins the two independent heads into one.
"""

import sqlalchemy as sa  # noqa: F401
from alembic import op  # noqa: F401

revision = "0006"
down_revision = ("0004", "0005")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
