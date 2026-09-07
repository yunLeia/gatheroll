from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration loaded from GATHEROLL_* environment variables."""

    environment: str = "development"
    web_origin: str = "http://localhost:3000"
    database_url: str = Field(
        default="postgresql+psycopg://gatheroll:gatheroll@localhost:5432/gatheroll",
        validation_alias="DATABASE_URL",
    )
    retention_days: int = Field(default=30, ge=1, le=365)
    r2_account_id: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket_name: str = ""
    r2_endpoint: str = ""
    photo_batch_limit: int = Field(default=50, ge=1, le=100)
    photo_max_bytes: int = Field(default=25 * 1024 * 1024, ge=1)
    photo_thumbnail_max_bytes: int = Field(default=256 * 1024, ge=1)
    photo_participant_limit: int = Field(default=500, ge=1)
    photo_put_ttl_seconds: int = Field(default=900, ge=60, le=3600)
    photo_get_ttl_seconds: int = Field(default=300, ge=60, le=900)

    model_config = SettingsConfigDict(
        env_prefix="GATHEROLL_",
        env_file=".env",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
