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

    model_config = SettingsConfigDict(
        env_prefix="GATHEROLL_",
        env_file=".env",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
