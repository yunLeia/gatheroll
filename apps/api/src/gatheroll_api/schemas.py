import re
from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from gatheroll_api.domain import JoinPolicy, ParticipantStatus


class EventCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    title: str = Field(min_length=1, max_length=200)
    event_date: date | None = None
    location_name: str | None = Field(default=None, max_length=300)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    join_policy: JoinPolicy = JoinPolicy.APPROVAL_REQUIRED

    @field_validator("event_date", mode="before")
    @classmethod
    def date_only(cls, value: object) -> object:
        if value is not None and (
            not isinstance(value, str)
            or re.fullmatch(r"\d{4}-\d{2}-\d{2}", value) is None
        ):
            raise ValueError("Use a calendar date YYYY-MM-DD, not an instant")
        return value


class EventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    title: str
    event_date: date | None
    location_name: str | None
    latitude: float | None
    longitude: float | None
    share_token: str
    join_policy: JoinPolicy
    created_at: datetime
    expires_at: datetime


class EventCreated(BaseModel):
    event: EventResponse
    manage_token: str


class ParticipantCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    display_name: str = Field(min_length=1, max_length=80)


class ParticipantResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    display_name: str
    status: ParticipantStatus
    joined_at: datetime
    approved_at: datetime | None
    include_selfies: bool
    include_screenshots: bool


class ParticipantPreferencesUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    include_selfies: bool
    include_screenshots: bool


class ParticipantJoined(BaseModel):
    participant: ParticipantResponse
    participant_token: str


class ParticipantDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal[ParticipantStatus.APPROVED, ParticipantStatus.REJECTED]


class ErrorResponse(BaseModel):
    code: str
    message: str
