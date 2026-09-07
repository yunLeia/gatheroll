from datetime import datetime
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field

from gatheroll_api.domain import PhotoStatus

ACCEPTED_TYPES = (
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
)


class PhotoInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    client_id: UUID
    original_filename: str = Field(min_length=1, max_length=255)
    content_type: str
    file_size_bytes: int = Field(gt=0, strict=True)
    thumbnail_size_bytes: int | None = Field(default=None, gt=0, strict=True)
    captured_at: AwareDatetime | None = None
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    width: int | None = Field(default=None, gt=0, le=100000)
    height: int | None = Field(default=None, gt=0, le=100000)


class UploadBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    photos: list[PhotoInput] = Field(min_length=1, max_length=100)


class UploadTarget(BaseModel):
    url: str
    headers: dict[str, str]


class UploadAuthorization(BaseModel):
    id: UUID
    client_id: UUID
    status: PhotoStatus
    original: UploadTarget | None = None
    thumbnail: UploadTarget | None = None
    expires_in_seconds: int


class PhotoResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    status: PhotoStatus
    original_filename: str
    content_type: str
    file_size_bytes: int
    width: int | None
    height: int | None
    captured_at: datetime | None
    created_at: datetime
    uploaded_at: datetime | None


class PhotoPreview(PhotoResponse):
    preview_url: str | None = None
    preview_expires_in_seconds: int


class PhotoPage(BaseModel):
    photos: list[PhotoPreview]
    next_offset: int | None


class PhotoLimits(BaseModel):
    batch_limit: int
    max_bytes: int
    thumbnail_max_bytes: int
    accepted_types: tuple[str, ...]
