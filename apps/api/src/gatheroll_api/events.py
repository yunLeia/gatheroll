import secrets
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal, Self
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from gatheroll_api.config import get_settings
from gatheroll_api.database import get_session
from gatheroll_api.models import Event

router = APIRouter(prefix="/events", tags=["events"])


class EventCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    title: str = Field(min_length=1, max_length=200)
    starts_at: AwareDatetime
    ends_at: AwareDatetime
    location_name: str | None = Field(default=None, max_length=300)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)

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
    created_at: datetime
    expires_at: datetime


class EventNotFound(BaseModel):
    code: Literal["event_not_found"] = "event_not_found"
    message: str = "This event could not be found."


@router.post("", response_model=EventResponse, status_code=201)
def create_event(
    data: EventCreate, session: Annotated[Session, Depends(get_session)]
) -> Event:
    event = Event(
        **data.model_dump(),
        id=uuid4(),
        share_token=secrets.token_urlsafe(32),
        created_at=datetime.now(UTC),
        expires_at=data.ends_at + timedelta(days=get_settings().retention_days),
    )
    session.add(event)
    session.commit()
    session.refresh(event)
    return event


@router.get(
    "/{share_token}",
    response_model=EventResponse,
    responses={404: {"model": EventNotFound}},
)
def get_event(
    share_token: str, session: Annotated[Session, Depends(get_session)]
) -> Event | JSONResponse:
    event = session.scalar(select(Event).where(Event.share_token == share_token))
    if event is None:
        return JSONResponse(status_code=404, content=EventNotFound().model_dump())
    return event
