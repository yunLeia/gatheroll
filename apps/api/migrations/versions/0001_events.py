"""Create the events table."""

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "events",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("location_name", sa.String(300)),
        sa.Column("latitude", sa.Float()),
        sa.Column("longitude", sa.Float()),
        sa.Column("share_token", sa.String(43), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("share_token"),
        sa.CheckConstraint("ends_at > starts_at", name="event_time_order"),
        sa.CheckConstraint("length(trim(title)) > 0", name="event_title_not_blank"),
        sa.CheckConstraint("latitude BETWEEN -90 AND 90", name="event_latitude_range"),
        sa.CheckConstraint(
            "longitude BETWEEN -180 AND 180", name="event_longitude_range"
        ),
    )


def downgrade() -> None:
    op.drop_table("events")
