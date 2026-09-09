from datetime import date, datetime
from uuid import UUID

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
    false,
    text,
    true,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from gatheroll_api.domain import JoinPolicy, ParticipantStatus, PhotoStatus


class Base(DeclarativeBase):
    pass


class Event(Base):
    __tablename__ = "events"
    __table_args__ = (
        CheckConstraint("length(trim(title)) > 0", name="event_title_not_blank"),
        CheckConstraint("latitude BETWEEN -90 AND 90", name="event_latitude_range"),
        CheckConstraint("longitude BETWEEN -180 AND 180", name="event_longitude_range"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    event_date: Mapped[date | None] = mapped_column(Date)
    # Historical context only; retained without backfill or relevance/auth semantics.
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    location_name: Mapped[str | None] = mapped_column(String(300))
    latitude: Mapped[float | None]
    longitude: Mapped[float | None]
    share_token: Mapped[str] = mapped_column(String(43), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    join_policy: Mapped[JoinPolicy] = mapped_column(
        Enum(
            JoinPolicy,
            values_callable=lambda values: [v.value for v in values],
            native_enum=False,
            create_constraint=True,
            name="event_join_policy",
        ),
        server_default="approval_required",
    )
    # NULL only for legacy events created before capability authorization existed.
    manage_token_hash: Mapped[str | None] = mapped_column(String(64))
    participants: Mapped[list["Participant"]] = relationship(back_populates="event")


class Participant(Base):
    __tablename__ = "participants"
    __table_args__ = (
        CheckConstraint(
            "length(trim(display_name)) > 0", name="participant_name_not_blank"
        ),
        CheckConstraint(
            "(status = 'approved' AND approved_at IS NOT NULL) OR "
            "(status != 'approved' AND approved_at IS NULL)",
            name="participant_approval_timestamp",
        ),
        Index(
            "participant_one_host_per_event",
            "event_id",
            unique=True,
            postgresql_where=text("is_host"),
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True)
    event_id: Mapped[UUID] = mapped_column(ForeignKey("events.id"), index=True)
    display_name: Mapped[str] = mapped_column(String(80))
    status: Mapped[ParticipantStatus] = mapped_column(
        Enum(
            ParticipantStatus,
            values_callable=lambda values: [v.value for v in values],
            native_enum=False,
            create_constraint=True,
            name="participant_status",
        )
    )
    participant_token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    include_selfies: Mapped[bool] = mapped_column(server_default=true())
    include_screenshots: Mapped[bool] = mapped_column(server_default=false())
    # At most one per event; enforced by a partial unique index (see migration 0007).
    is_host: Mapped[bool] = mapped_column(server_default=false())
    event: Mapped[Event] = relationship(back_populates="participants")


class Photo(Base):
    __tablename__ = "photos"
    __table_args__ = (
        UniqueConstraint("participant_id", "client_id", name="photo_client_identity"),
        CheckConstraint("file_size_bytes > 0", name="photo_size_positive"),
        CheckConstraint(
            "thumbnail_size_bytes > 0", name="photo_thumbnail_size_positive"
        ),
        CheckConstraint("width > 0 AND height > 0", name="photo_dimensions_positive"),
        CheckConstraint("latitude BETWEEN -90 AND 90", name="photo_latitude_range"),
        CheckConstraint("longitude BETWEEN -180 AND 180", name="photo_longitude_range"),
        CheckConstraint(
            "(status = 'uploaded_private' AND uploaded_at IS NOT NULL) OR "
            "(status = 'pending_upload' AND uploaded_at IS NULL)",
            name="photo_upload_timestamp",
        ),
        CheckConstraint(
            "thumbnail_key IS NULL OR "
            "(thumbnail_size_bytes IS NOT NULL AND status = 'uploaded_private')",
            name="photo_thumbnail_complete",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True)
    # RESTRICT/default NO ACTION: removing DB parents must not orphan private bytes.
    event_id: Mapped[UUID] = mapped_column(ForeignKey("events.id"), index=True)
    participant_id: Mapped[UUID] = mapped_column(
        ForeignKey("participants.id"), index=True
    )
    client_id: Mapped[UUID]
    status: Mapped[PhotoStatus] = mapped_column(
        Enum(
            PhotoStatus,
            values_callable=lambda values: [v.value for v in values],
            native_enum=False,
            create_constraint=True,
            name="photo_status",
        )
    )
    original_key: Mapped[str] = mapped_column(String(200), unique=True)
    thumbnail_key: Mapped[str | None] = mapped_column(String(200))
    thumbnail_size_bytes: Mapped[int | None]
    original_filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(40))
    file_size_bytes: Mapped[int] = mapped_column(BigInteger)
    captured_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    latitude: Mapped[float | None]
    longitude: Mapped[float | None]
    width: Mapped[int | None]
    height: Mapped[int | None]
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    uploaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
