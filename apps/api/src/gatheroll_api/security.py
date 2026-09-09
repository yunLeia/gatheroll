import hashlib
import re
import secrets
from dataclasses import dataclass
from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from gatheroll_api.database import get_session
from gatheroll_api.domain import ParticipantStatus
from gatheroll_api.models import Event, Participant

SessionDep = Annotated[Session, Depends(get_session)]
bearer = HTTPBearer(auto_error=False)


def new_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def api_error(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message})


def get_event(share_token: str, session: SessionDep) -> Event:
    event = session.scalar(select(Event).where(Event.share_token == share_token))
    if event is None:
        raise api_error(404, "event_not_found", "This event could not be found.")
    return event


EventDep = Annotated[Event, Depends(get_event)]


def get_bearer_token(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> str:
    if credentials is None or not re.fullmatch(
        r"[A-Za-z0-9_-]{43}", credentials.credentials
    ):
        raise api_error(401, "invalid_credential", "A valid credential is required.")
    return credentials.credentials


TokenDep = Annotated[str, Depends(get_bearer_token)]


def require_host(event: EventDep, token: TokenDep) -> Event:
    if event.manage_token_hash is None or not secrets.compare_digest(
        event.manage_token_hash, hash_token(token)
    ):
        raise api_error(
            403, "host_access_denied", "This credential cannot manage this event."
        )
    return event


def require_participant(
    event: EventDep, token: TokenDep, session: SessionDep
) -> Participant:
    participant = session.scalar(
        select(Participant).where(
            Participant.event_id == event.id,
            Participant.participant_token_hash == hash_token(token),
        )
    )
    if participant is None:
        raise api_error(
            403,
            "participant_access_denied",
            "This credential cannot access this event.",
        )
    return participant


HostDep = Annotated[Event, Depends(require_host)]
ParticipantDep = Annotated[Participant, Depends(require_participant)]


@dataclass
class AlbumAccess:
    event: Event
    # The requester's own participant identity, for filters like "not mine" --
    # never exposed in a response body. None for a host with no claimed
    # participant identity yet (nothing to exclude in that case).
    participant_id: UUID | None


def require_album_access(
    event: EventDep, token: TokenDep, session: SessionDep
) -> AlbumAccess:
    if event.manage_token_hash is not None and secrets.compare_digest(
        event.manage_token_hash, hash_token(token)
    ):
        host_participant = session.scalar(
            select(Participant).where(
                Participant.event_id == event.id, Participant.is_host.is_(True)
            )
        )
        return AlbumAccess(
            event=event,
            participant_id=host_participant.id if host_participant else None,
        )
    participant = require_participant(event, token, session)
    if participant.status != ParticipantStatus.APPROVED:
        raise api_error(
            403, "approval_required", "Join approval is required to view photos."
        )
    return AlbumAccess(event=event, participant_id=participant.id)
