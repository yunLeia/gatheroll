"""Preserve historical times; new events need no exact boundaries."""

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("events", sa.Column("event_date", sa.Date(), nullable=True))
    op.alter_column(
        "events", "starts_at", existing_type=sa.DateTime(timezone=True), nullable=True
    )
    op.alter_column(
        "events", "ends_at", existing_type=sa.DateTime(timezone=True), nullable=True
    )
    op.drop_constraint("event_time_order", "events", type_="check")
    # No timestamp/date conversion: original host timezone is not stored.
    # Existing event, participant, photo, token and expires_at values remain untouched.


def downgrade() -> None:
    # Restoring NOT NULL would need invented times for new events. Do not do that,
    # or silently erase explicit dates. This product migration is forward-only.
    raise RuntimeError(
        "0004 is forward-only; restore a reviewed backup or use a forward migration"
    )
