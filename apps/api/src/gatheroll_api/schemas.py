from datetime import datetime
from typing import Literal, Self
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

from gatheroll_api.domain import JoinPolicy, ParticipantStatus


class EventCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    title: str = Field(min_length=1, max_length=200)
    starts_at: AwareDatetime
    ends_at: AwareDatetime
    location_name: str | None = Field(default=None, max_length=300)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    join_policy: JoinPolicy = JoinPolicy.APPROVAL_REQUIRED

    @model_validator(mode="after")
    def validate_window(self) -> Self:
        if self.ends_at <= self.starts_at:
            raise ValueError("End time must be after start time")
        return self


class EventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    title: str
    starts_at: datetime
    ends_at: datetime
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
