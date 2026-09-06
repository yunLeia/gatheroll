from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi import APIRouter
from sqlalchemy import select

from gatheroll_api.domain import JoinPolicy, ParticipantStatus
from gatheroll_api.models import Participant
from gatheroll_api.schemas import (
    ErrorResponse,
    ParticipantCreate,
    ParticipantDecision,
    ParticipantJoined,
    ParticipantResponse,
)
from gatheroll_api.security import (
    EventDep,
    HostDep,
    ParticipantDep,
    SessionDep,
    api_error,
    hash_token,
    new_token,
)

router = APIRouter(
    prefix="/events/{share_token}/participants",
    tags=["participants"],
    responses={401: {"model": ErrorResponse}, 403: {"model": ErrorResponse}},
)


@router.post("", status_code=201, response_model=ParticipantJoined)
def join_event(
    data: ParticipantCreate, event: EventDep, session: SessionDep
) -> ParticipantJoined:
    token = new_token()
    now = datetime.now(UTC)
    approved = event.join_policy == JoinPolicy.OPEN
    participant = Participant(
        id=uuid4(),
        event_id=event.id,
        display_name=data.display_name,
        participant_token_hash=hash_token(token),
        joined_at=now,
        status=ParticipantStatus.APPROVED if approved else ParticipantStatus.PENDING,
        approved_at=now if approved else None,
    )
    session.add(participant)
    session.commit()
    session.refresh(participant)
    return ParticipantJoined(
        participant=ParticipantResponse.model_validate(participant),
        participant_token=token,
    )


@router.get("/me", response_model=ParticipantResponse)
def my_status(participant: ParticipantDep) -> Participant:
    # Pending and rejected people may inspect their status, not access future photos.
    return participant


@router.get("", response_model=list[ParticipantResponse])
def list_participants(event: HostDep, session: SessionDep) -> list[Participant]:
    return list(
        session.scalars(
            select(Participant)
            .where(
                Participant.event_id == event.id,
            )
            .order_by(Participant.joined_at, Participant.id)
        )
    )


@router.patch(
    "/{participant_id}",
    response_model=ParticipantResponse,
    responses={404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}},
)
def decide_participant(
    participant_id: UUID,
    data: ParticipantDecision,
    event: HostDep,
    session: SessionDep,
) -> Participant:
    participant = session.scalar(
        select(Participant)
        .where(
            Participant.id == participant_id,
            Participant.event_id == event.id,
        )
        .with_for_update()
    )
    if participant is None:
        raise api_error(
            404, "participant_not_found", "This participant could not be found."
        )
    if participant.status == data.status:
        return participant
    if participant.status != ParticipantStatus.PENDING:
        raise api_error(
            409, "decision_already_made", "This request already has a final decision."
        )
    participant.status = data.status
    participant.approved_at = (
        datetime.now(UTC) if data.status == ParticipantStatus.APPROVED else None
    )
    session.commit()
    session.refresh(participant)
    return participant
