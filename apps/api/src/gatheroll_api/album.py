"""Event album: hosts and approved participants share the same read access."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select

from gatheroll_api.config import get_settings
from gatheroll_api.domain import PhotoStatus
from gatheroll_api.models import Photo
from gatheroll_api.photo_schemas import PhotoPage, PhotoPreview, PhotoResponse
from gatheroll_api.photos import StorageDep
from gatheroll_api.security import (
    AlbumAccess,
    SessionDep,
    api_error,
    require_album_access,
)

router = APIRouter(prefix="/events/{share_token}/album", tags=["shared album"])
AlbumDep = Annotated[AlbumAccess, Depends(require_album_access)]


class OriginalLink(BaseModel):
    url: str
    expires_in_seconds: int


@router.get("", response_model=PhotoPage)
def list_album(
    access: AlbumDep,
    session: SessionDep,
    storage: StorageDep,
    offset: Annotated[int, Query(ge=0)] = 0,
    exclude_mine: bool = False,
) -> PhotoPage:
    conditions = [
        Photo.event_id == access.event.id,
        Photo.status == PhotoStatus.UPLOADED_PRIVATE,
    ]
    if exclude_mine and access.participant_id is not None:
        conditions.append(Photo.participant_id != access.participant_id)
    rows = list(
        session.scalars(
            select(Photo)
            .where(*conditions)
            .order_by(Photo.created_at, Photo.id)
            .offset(offset)
            .limit(51)
        )
    )
    return PhotoPage(
        photos=[
            PhotoPreview(
                **PhotoResponse.model_validate(photo).model_dump(),
                preview_url=storage.create_download_url(photo.thumbnail_key)
                if photo.thumbnail_key
                else None,
                preview_expires_in_seconds=get_settings().photo_get_ttl_seconds,
            )
            for photo in rows[:50]
        ],
        next_offset=offset + 50 if len(rows) > 50 else None,
    )


@router.get("/{photo_id}/original", response_model=OriginalLink)
def original(
    photo_id: UUID,
    access: AlbumDep,
    session: SessionDep,
    storage: StorageDep,
    download: bool = False,
) -> OriginalLink:
    photo = session.scalar(
        select(Photo).where(
            Photo.id == photo_id,
            Photo.event_id == access.event.id,
            Photo.status == PhotoStatus.UPLOADED_PRIVATE,
        )
    )
    if photo is None:
        raise api_error(404, "photo_not_found", "This photo could not be found.")
    return OriginalLink(
        url=storage.create_original_url(
            photo.original_key, photo.original_filename, download=download
        ),
        expires_in_seconds=get_settings().photo_get_ttl_seconds,
    )
