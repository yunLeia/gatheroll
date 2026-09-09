"""Add is_host to participants so the event host can share/upload photos too.

At most one host participant per event, enforced by a partial unique index
rather than a nullable FK on events (avoids a circular events<->participants
reference). Existing participants default to is_host=false; legacy events get
no retroactive host participant here (created lazily by the host/participant
endpoint on first use).
"""

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "participants",
        sa.Column("is_host", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_index(
        "participant_one_host_per_event",
        "participants",
        ["event_id"],
        unique=True,
        postgresql_where=sa.text("is_host"),
    )


def downgrade() -> None:
    op.drop_index("participant_one_host_per_event", table_name="participants")
    op.drop_column("participants", "is_host")
