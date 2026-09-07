from unittest.mock import Mock
from urllib.parse import parse_qs, urlparse

import pytest
from botocore.exceptions import ClientError
from fastapi import HTTPException

from gatheroll_api.config import Settings
from gatheroll_api.storage import Storage


def storage() -> Storage:
    # Synthetic credentials: signing is local, and tests make no R2 network calls.
    return Storage(
        Settings(
            r2_endpoint="https://test.r2.cloudflarestorage.com",
            photo_put_ttl_seconds=900,
            r2_account_id="test",
            r2_access_key_id="test",
            r2_secret_access_key="test",
            r2_bucket_name="private-test",
        )
    )


def test_our_signing_contract() -> None:
    target = storage().create_upload_url(
        "server-controlled/original", "image/jpeg", 123
    )
    query = parse_qs(urlparse(target.url).query)
    assert query["X-Amz-Expires"] == ["900"]
    assert set(query["X-Amz-SignedHeaders"][0].split(";")) >= {
        "content-type",
        "content-length",
        "host",
    }
    assert target.headers == {"Content-Type": "image/jpeg"}


def test_no_fake_storage_when_unconfigured() -> None:
    with pytest.raises(HTTPException) as exc:
        Storage(Settings(r2_access_key_id="", r2_secret_access_key=""))
    assert exc.value.status_code == 503


@pytest.mark.parametrize("size,mime", [(124, "image/jpeg"), (123, "text/html")])
def test_completion_head_mismatch(size: int, mime: str) -> None:
    service = storage()
    service.client = Mock()
    service.client.head_object.return_value = {
        "ContentLength": size,
        "ContentType": mime,
    }
    with pytest.raises(HTTPException) as exc:
        service.verify_object("key", "image/jpeg", 123)
    assert exc.value.status_code == 409


def test_missing_head_maps_to_retryable_conflict() -> None:
    service = storage()
    service.client = Mock()
    service.client.head_object.side_effect = ClientError(
        {"Error": {"Code": "404"}}, "HeadObject"
    )
    with pytest.raises(HTTPException) as exc:
        service.verify_object("key", "image/jpeg", 123)
    assert exc.value.status_code == 409
