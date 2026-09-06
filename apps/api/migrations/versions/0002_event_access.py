"""Add join policies, host verifiers and event-scoped participants.

Legacy events remain readable but unmanageable: no credential existed to recover.
"""

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "events",
        sa.Column(
            "join_policy",
            sa.String(17),
            nullable=False,
            server_default="approval_required",
        ),
    )
    op.create_check_constraint(
        "event_join_policy", "events", "join_policy IN ('open', 'approval_required')"
    )
    op.add_column(
        "events", sa.Column("manage_token_hash", sa.String(64), nullable=True)
    )
    op.create_table(
        "participants",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("event_id", sa.Uuid(), sa.ForeignKey("events.id"), nullable=False),
        sa.Column("display_name", sa.String(80), nullable=False),
        sa.Column("status", sa.String(8), nullable=False),
        sa.Column("participant_token_hash", sa.String(64), nullable=False),
        sa.Column("joined_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("approved_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("participant_token_hash"),
        sa.CheckConstraint(
            "status IN ('pending', 'approved', 'rejected')", name="participant_status"
        ),
        sa.CheckConstraint(
            "length(trim(display_name)) > 0", name="participant_name_not_blank"
        ),
        sa.CheckConstraint(
            "(status = 'approved' AND approved_at IS NOT NULL) OR "
            "(status != 'approved' AND approved_at IS NULL)",
            name="participant_approval_timestamp",
        ),
    )
    op.create_index("ix_participants_event_id", "participants", ["event_id"])


def downgrade() -> None:
    op.drop_index("ix_participants_event_id", table_name="participants")
    op.drop_table("participants")
    op.drop_column("events", "manage_token_hash")
    op.drop_constraint("event_join_policy", "events", type_="check")
    op.drop_column("events", "join_policy")
