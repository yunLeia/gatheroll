from datetime import UTC, datetime, timedelta
from uuid import uuid4

from fastapi import APIRouter

from gatheroll_api.config import get_settings
from gatheroll_api.models import Event
from gatheroll_api.schemas import (
    ErrorResponse,
    EventCreate,
    EventCreated,
    EventResponse,
)
from gatheroll_api.security import EventDep, HostDep, SessionDep, hash_token, new_token

router = APIRouter(prefix="/events", tags=["events"])


@router.post("", response_model=EventCreated, status_code=201)
def create_event(data: EventCreate, session: SessionDep) -> EventCreated:
    manage_token = new_token()
    now = datetime.now(UTC)
    event = Event(
        **data.model_dump(),
        id=uuid4(),
        share_token=new_token(),
        manage_token_hash=hash_token(manage_token),
        created_at=now,
        # Retention bookkeeping only; expiry enforcement/cleanup is not implemented.
        expires_at=now + timedelta(days=get_settings().retention_days),
    )
    session.add(event)
    session.commit()
    session.refresh(event)
    return EventCreated(
        event=EventResponse.model_validate(event), manage_token=manage_token
    )


@router.get(
    "/{share_token}",
    response_model=EventResponse,
    responses={404: {"model": ErrorResponse}},
)
def get_public_event(event: EventDep) -> Event:
    return event


@router.get(
    "/{share_token}/manage",
    response_model=EventResponse,
    responses={401: {"model": ErrorResponse}, 403: {"model": ErrorResponse}},
)
def get_managed_event(event: HostDep) -> Event:
    return event
