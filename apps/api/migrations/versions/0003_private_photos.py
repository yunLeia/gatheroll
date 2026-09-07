"""Private photo intake, without AI or sharing states."""

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "photos",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("event_id", sa.Uuid(), sa.ForeignKey("events.id"), nullable=False),
        sa.Column(
            "participant_id",
            sa.Uuid(),
            sa.ForeignKey("participants.id"),
            nullable=False,
        ),
        sa.Column("client_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("original_key", sa.String(200), nullable=False, unique=True),
        sa.Column("thumbnail_key", sa.String(200)),
        sa.Column("thumbnail_size_bytes", sa.Integer()),
        sa.Column("original_filename", sa.String(255), nullable=False),
        sa.Column("content_type", sa.String(40), nullable=False),
        sa.Column("file_size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("captured_at", sa.DateTime(timezone=True)),
        sa.Column("latitude", sa.Float()),
        sa.Column("longitude", sa.Float()),
        sa.Column("width", sa.Integer()),
        sa.Column("height", sa.Integer()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("uploaded_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint(
            "participant_id", "client_id", name="photo_client_identity"
        ),
        sa.CheckConstraint(
            "status IN ('pending_upload', 'uploaded_private')", name="photo_status"
        ),
        sa.CheckConstraint("file_size_bytes > 0", name="photo_size_positive"),
        sa.CheckConstraint(
            "thumbnail_size_bytes > 0", name="photo_thumbnail_size_positive"
        ),
        sa.CheckConstraint(
            "width > 0 AND height > 0", name="photo_dimensions_positive"
        ),
        sa.CheckConstraint("latitude BETWEEN -90 AND 90", name="photo_latitude_range"),
        sa.CheckConstraint(
            "longitude BETWEEN -180 AND 180", name="photo_longitude_range"
        ),
        sa.CheckConstraint(
            "(status = 'uploaded_private' AND uploaded_at IS NOT NULL) OR "
            "(status = 'pending_upload' AND uploaded_at IS NULL)",
            name="photo_upload_timestamp",
        ),
        sa.CheckConstraint(
            "thumbnail_key IS NULL OR "
            "(thumbnail_size_bytes IS NOT NULL AND status = 'uploaded_private')",
            name="photo_thumbnail_complete",
        ),
    )
    op.create_index("ix_photos_event_id", "photos", ["event_id"])
    op.create_index("ix_photos_participant_id", "photos", ["participant_id"])


def downgrade() -> None:
    op.drop_table("photos")
