from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select

from gatheroll_api.config import get_settings
from gatheroll_api.domain import ParticipantStatus, PhotoStatus
from gatheroll_api.models import Participant, Photo
from gatheroll_api.photo_schemas import (
    ACCEPTED_TYPES,
    PhotoLimits,
    PhotoPage,
    PhotoPreview,
    PhotoResponse,
    UploadAuthorization,
    UploadBatch,
)
from gatheroll_api.security import ParticipantDep, SessionDep, api_error
from gatheroll_api.storage import Storage, get_storage

router = APIRouter(prefix="/events/{share_token}/photos", tags=["private photos"])
StorageDep = Annotated[Storage, Depends(get_storage)]


def require_approved(participant: ParticipantDep) -> Participant:
    if participant.status != ParticipantStatus.APPROVED:
        raise api_error(
            403, "approval_required", "Only approved participants can add photos."
        )
    return participant


ApprovedDep = Annotated[Participant, Depends(require_approved)]


def thumbnail_key(photo: Photo) -> str:
    return f"events/{photo.event_id}/photos/{photo.id}/thumb"


@router.get("/limits", response_model=PhotoLimits)
def limits(participant: ApprovedDep) -> PhotoLimits:
    settings = get_settings()
    return PhotoLimits(
        batch_limit=settings.photo_batch_limit,
        max_bytes=settings.photo_max_bytes,
        thumbnail_max_bytes=settings.photo_thumbnail_max_bytes,
        accepted_types=ACCEPTED_TYPES,
    )


@router.post("/uploads", response_model=list[UploadAuthorization])
def initialize(
    data: UploadBatch,
    participant: ApprovedDep,
    session: SessionDep,
    storage: StorageDep,
) -> list[UploadAuthorization]:
    settings = get_settings()
    if len(data.photos) > settings.photo_batch_limit:
        raise api_error(422, "batch_too_large", "Select fewer photos in one batch.")
    if len({p.client_id for p in data.photos}) != len(data.photos):
        raise api_error(
            422, "duplicate_client_id", "Each selected photo needs a unique identity."
        )
    for item in data.photos:
        if item.content_type not in ACCEPTED_TYPES:
            raise api_error(
                422, "unsupported_type", "This image format is not supported."
            )
        if item.file_size_bytes > settings.photo_max_bytes or (
            item.thumbnail_size_bytes is not None
            and item.thumbnail_size_bytes > settings.photo_thumbnail_max_bytes
        ):
            raise api_error(
                422, "file_too_large", "This photo exceeds the upload size limit."
            )
    # Serialize init/retry for this identity: lost responses do not duplicate rows.
    session.execute(
        select(Participant).where(Participant.id == participant.id).with_for_update()
    )
    existing = {
        p.client_id: p
        for p in session.scalars(
            select(Photo).where(
                Photo.participant_id == participant.id,
                Photo.client_id.in_([p.client_id for p in data.photos]),
            )
        )
    }
    count = (
        session.scalar(
            select(func.count())
            .select_from(Photo)
            .where(Photo.participant_id == participant.id)
        )
        or 0
    )
    if count + len(data.photos) - len(existing) > settings.photo_participant_limit:
        raise api_error(
            409, "photo_quota", "This participant has reached the demo photo limit."
        )
    result = []
    for item in data.photos:
        photo = existing.get(item.client_id)
        if photo is not None:
            if any(
                getattr(photo, key) != value for key, value in item.model_dump().items()
            ):
                raise api_error(
                    409,
                    "retry_mismatch",
                    "A retry must describe the same selected file.",
                )
        else:
            photo_id = uuid4()
            photo = Photo(
                id=photo_id,
                event_id=participant.event_id,
                participant_id=participant.id,
                status=PhotoStatus.PENDING_UPLOAD,
                original_key=f"events/{participant.event_id}/photos/{photo_id}/original",
                created_at=datetime.now(UTC),
                **item.model_dump(),
            )
            session.add(photo)
        pending = photo.status == PhotoStatus.PENDING_UPLOAD
        result.append(
            UploadAuthorization(
                id=photo.id,
                client_id=photo.client_id,
                status=photo.status,
                original=storage.create_upload_url(
                    photo.original_key, photo.content_type, photo.file_size_bytes
                )
                if pending
                else None,
                thumbnail=storage.create_upload_url(
                    thumbnail_key(photo), "image/jpeg", photo.thumbnail_size_bytes
                )
                if pending and photo.thumbnail_size_bytes is not None
                else None,
                expires_in_seconds=settings.photo_put_ttl_seconds,
            )
        )
    session.commit()
    return result


@router.post("/{photo_id}/complete", response_model=PhotoResponse)
def complete(
    photo_id: UUID, participant: ApprovedDep, session: SessionDep, storage: StorageDep
) -> Photo:
    photo = session.scalar(
        select(Photo)
        .where(
            Photo.id == photo_id,
            Photo.event_id == participant.event_id,
            Photo.participant_id == participant.id,
        )
        .with_for_update()
    )
    if photo is None:
        raise api_error(404, "photo_not_found", "This photo could not be found.")
    if photo.status == PhotoStatus.UPLOADED_PRIVATE:
        return photo
    if photo.status != PhotoStatus.PENDING_UPLOAD:
        raise api_error(409, "invalid_photo_state", "This photo cannot be completed.")
    storage.verify_object(photo.original_key, photo.content_type, photo.file_size_bytes)
    if photo.thumbnail_size_bytes is not None:
        key = thumbnail_key(photo)
        storage.verify_object(key, "image/jpeg", photo.thumbnail_size_bytes)
        photo.thumbnail_key = key
    photo.status = PhotoStatus.UPLOADED_PRIVATE
    photo.uploaded_at = datetime.now(UTC)
    session.commit()
    session.refresh(photo)
    return photo


@router.get("", response_model=PhotoPage)
def my_photos(
    participant: ApprovedDep,
    session: SessionDep,
    storage: StorageDep,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> PhotoPage:
    page_size = 50
    rows = list(
        session.scalars(
            select(Photo)
            .where(
                Photo.event_id == participant.event_id,
                Photo.participant_id == participant.id,
                Photo.status == PhotoStatus.UPLOADED_PRIVATE,
            )
            .order_by(Photo.created_at, Photo.id)
            .offset(offset)
            .limit(page_size + 1)
        )
    )
    # Never return original links here: thumbnails only, with a format fallback.
    return PhotoPage(
        photos=[
            PhotoPreview(
                **PhotoResponse.model_validate(photo).model_dump(),
                preview_url=storage.create_download_url(photo.thumbnail_key)
                if photo.thumbnail_key
                else None,
                preview_expires_in_seconds=get_settings().photo_get_ttl_seconds,
            )
            for photo in rows[:page_size]
        ],
        next_offset=offset + page_size if len(rows) > page_size else None,
    )
