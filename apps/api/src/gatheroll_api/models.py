from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, Enum, ForeignKey, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from gatheroll_api.domain import JoinPolicy, ParticipantStatus


class Base(DeclarativeBase):
    pass


class Event(Base):
    __tablename__ = "events"
    __table_args__ = (
        CheckConstraint("ends_at > starts_at", name="event_time_order"),
        CheckConstraint("length(trim(title)) > 0", name="event_title_not_blank"),
        CheckConstraint("latitude BETWEEN -90 AND 90", name="event_latitude_range"),
        CheckConstraint("longitude BETWEEN -180 AND 180", name="event_longitude_range"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
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
    event: Mapped[Event] = relationship(back_populates="participants")
