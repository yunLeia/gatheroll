"""Concrete private R2 signing/HEAD operations; never transport image bodies.

Settings and this client are process-cached: restart the API after editing .env.
"""

from functools import lru_cache
from typing import TYPE_CHECKING

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from gatheroll_api.config import Settings, get_settings
from gatheroll_api.photo_schemas import UploadTarget
from gatheroll_api.security import api_error

if TYPE_CHECKING:
    from mypy_boto3_s3 import S3Client


class Storage:
    def __init__(self, settings: Settings) -> None:
        if not all(
            (
                settings.r2_access_key_id,
                settings.r2_secret_access_key,
                settings.r2_bucket_name,
                settings.r2_endpoint or settings.r2_account_id,
            )
        ):
            raise api_error(
                503, "storage_not_configured", "Photo storage is not configured yet."
            )
        self.settings = settings
        self.client: S3Client = boto3.client(
            "s3",
            region_name="auto",
            endpoint_url=settings.r2_endpoint
            or f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=settings.r2_access_key_id,
            aws_secret_access_key=settings.r2_secret_access_key,
            config=Config(
                signature_version="s3v4",
                connect_timeout=5,
                read_timeout=10,
                retries={"max_attempts": 1},
                request_checksum_calculation="when_required",
                response_checksum_validation="when_required",
            ),
        )

    def create_upload_url(self, key: str, content_type: str, size: int) -> UploadTarget:
        # The browser sets Content-Length from Blob.size; JS cannot set it manually.
        url = self.client.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": self.settings.r2_bucket_name,
                "Key": key,
                "ContentType": content_type,
                "ContentLength": size,
            },
            ExpiresIn=self.settings.photo_put_ttl_seconds,
        )
        return UploadTarget(url=url, headers={"Content-Type": content_type})

    def create_download_url(self, key: str) -> str:
        return self.client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.settings.r2_bucket_name, "Key": key},
            ExpiresIn=self.settings.photo_get_ttl_seconds,
        )

    def verify_object(self, key: str, content_type: str, size: int) -> None:
        try:
            obj = self.client.head_object(Bucket=self.settings.r2_bucket_name, Key=key)
        except ClientError as exc:
            if exc.response["Error"].get("Code") in ("404", "NoSuchKey", "NotFound"):
                raise api_error(
                    409, "upload_missing", "Upload has not reached storage yet."
                ) from None
            raise api_error(
                503, "storage_unavailable", "Storage is temporarily unavailable."
            ) from None
        except BotoCoreError:
            raise api_error(
                503, "storage_unavailable", "Storage is temporarily unavailable."
            ) from None
        if obj["ContentLength"] != size or obj.get("ContentType") != content_type:
            raise api_error(
                409,
                "upload_mismatch",
                "Stored file does not match its upload authorization.",
            )


@lru_cache
def get_storage() -> Storage:
    return Storage(get_settings())
