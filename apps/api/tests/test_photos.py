from datetime import UTC, datetime
from typing import Any
from unittest.mock import Mock
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from test_access import auth, create, join

from gatheroll_api.config import get_settings
from gatheroll_api.domain import PhotoStatus
from gatheroll_api.main import app
from gatheroll_api.models import Photo
from gatheroll_api.photo_schemas import UploadTarget
from gatheroll_api.security import api_error
from gatheroll_api.storage import Storage, get_storage


@pytest.fixture
def storage() -> Mock:
    fake = Mock(spec=Storage)
    fake.create_upload_url.side_effect = lambda key, mime, size: UploadTarget(
        url=f"https://storage.example/{key}?signed=temporary",
        headers={"Content-Type": mime},
    )
    fake.create_download_url.return_value = "https://storage.example/private?temporary"
    app.dependency_overrides[get_storage] = lambda: fake
    return fake


def item(**changes: Any) -> dict[str, Any]:
    return {
        "client_id": str(uuid4()),
        "original_filename": "IMG_1234.HEIC",
        "content_type": "image/heic",
        "file_size_bytes": 100,
        **changes,
    }


def context(client: TestClient) -> tuple[str, str, str]:
    share, host = create(client, "open")
    _, guest = join(client, share)
    return f"/events/{share}/photos", host, guest


def initialize(
    client: TestClient,
    root: str,
    token: str,
    photos: list[dict[str, Any]] | None = None,
) -> Any:
    response = client.post(
        f"{root}/uploads", headers=auth(token), json={"photos": photos or [item()]}
    )
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.parametrize("state", ["pending", "rejected"])
def test_unapproved_cannot_upload(
    client: TestClient, storage: Mock, state: str
) -> None:
    share, host = create(client)
    pid, guest = join(client, share)
    if state == "rejected":
        client.patch(
            f"/events/{share}/participants/{pid}",
            headers=auth(host),
            json={"status": "rejected"},
        )
    root = f"/events/{share}/photos"
    assert (
        client.post(
            f"{root}/uploads", headers=auth(guest), json={"photos": [item()]}
        ).status_code
        == 403
    )
    assert client.get(root, headers=auth(guest)).status_code == 403
    assert (
        client.post(f"{root}/{uuid4()}/complete", headers=auth(guest)).status_code
        == 403
    )
    storage.create_upload_url.assert_not_called()


def test_event_role_and_ownership_boundaries(client: TestClient, storage: Mock) -> None:
    root, host, guest = context(client)
    other_root, _, other_guest = context(client)
    for token in [host, other_guest]:
        assert (
            client.post(
                f"{root}/uploads", headers=auth(token), json={"photos": [item()]}
            ).status_code
            == 403
        )
        assert client.get(root, headers=auth(token)).status_code == 403
    assert client.post(f"{root}/uploads", json={"photos": [item()]}).status_code == 401
    pid = initialize(client, root, guest)[0]["id"]
    _, same_event_guest = join(client, root.split("/")[2], "Another")
    for path, token in [(root, same_event_guest), (other_root, other_guest)]:
        assert (
            client.post(f"{path}/{pid}/complete", headers=auth(token)).status_code
            == 404
        )
    assert client.post(f"{root}/{pid}/complete").status_code == 401


@pytest.mark.parametrize(
    "changes",
    [
        {"content_type": "text/html"},
        {"content_type": "image/svg+xml"},
        {"file_size_bytes": 26 * 1024 * 1024},
        {"file_size_bytes": 0},
        {"thumbnail_size_bytes": 300000},
        {"original_key": "arbitrary"},
        {"event_id": str(uuid4())},
        {"participant_id": str(uuid4())},
        {"latitude": 91},
        {"captured_at": "2026-09-01T10:00:00"},
    ],
)
def test_validation(client: TestClient, storage: Mock, changes: dict[str, Any]) -> None:
    root, _, guest = context(client)
    assert (
        client.post(
            f"{root}/uploads", headers=auth(guest), json={"photos": [item(**changes)]}
        ).status_code
        == 422
    )
    storage.create_upload_url.assert_not_called()


def test_batch_limits_and_duplicate_ids(client: TestClient, storage: Mock) -> None:
    root, _, guest = context(client)
    repeated = item()
    for photos in [[], [item() for _ in range(51)], [repeated, repeated]]:
        assert (
            client.post(
                f"{root}/uploads", headers=auth(guest), json={"photos": photos}
            ).status_code
            == 422
        )


def test_keys_and_idempotent_init(
    client: TestClient, storage: Mock, db_session: Session
) -> None:
    root, _, guest = context(client)
    data = [item(original_filename="../../Leia.HEIC", thumbnail_size_bytes=42), item()]
    result = initialize(client, root, guest, data)
    retry = initialize(client, root, guest, data)
    assert [p["id"] for p in result] == [p["id"] for p in retry]
    assert db_session.scalar(select(func.count()).select_from(Photo)) == 2
    row = db_session.get(Photo, UUID(result[0]["id"]))
    assert (
        row is not None and row.status == "pending_upload" and row.uploaded_at is None
    )
    assert row.thumbnail_key is None
    assert row.original_key == f"events/{row.event_id}/photos/{row.id}/original"
    assert "Leia" not in row.original_key
    assert result[0]["thumbnail"]["headers"] == {"Content-Type": "image/jpeg"}
    changed = [{**data[0], "file_size_bytes": 101}]
    assert (
        client.post(
            f"{root}/uploads", headers=auth(guest), json={"photos": changed}
        ).status_code
        == 409
    )


def test_completion_is_verified_private_and_idempotent(
    client: TestClient,
    storage: Mock,
    db_session: Session,
) -> None:
    root, host, guest = context(client)
    data = [item(thumbnail_size_bytes=42)]
    photo = initialize(client, root, guest, data)[0]
    path = f"{root}/{photo['id']}/complete"
    assert client.get(root, headers=auth(guest)).json()["photos"] == []
    complete = client.post(path, headers=auth(guest))
    assert (
        complete.status_code == 200 and complete.json()["status"] == "uploaded_private"
    )
    assert complete.json()["uploaded_at"] is not None
    assert "original_key" not in complete.json()
    assert storage.verify_object.call_count == 2
    assert client.post(path, headers=auth(guest)).json() == complete.json()
    assert storage.verify_object.call_count == 2
    retry = initialize(client, root, guest, data)[0]
    assert retry["original"] is None and retry["thumbnail"] is None
    listing = client.get(root, headers=auth(guest)).json()["photos"]
    assert len(listing) == 1 and listing[0]["preview_url"] is not None
    assert not {"original_key", "thumbnail_key", "participant_id"}.intersection(
        listing[0]
    )
    _, another = join(client, root.split("/")[2])
    assert client.get(root, headers=auth(another)).json()["photos"] == []
    assert client.get(root, headers=auth(host)).status_code == 403
    assert "photos" not in client.get(root.removesuffix("/photos")).json()
    db_session.expire_all()
    assert (
        client.get(root, headers=auth(guest)).json()["photos"][0]["id"] == photo["id"]
    )


def test_missing_upload_stays_pending_and_can_retry(
    client: TestClient, storage: Mock
) -> None:
    root, _, guest = context(client)
    photo = initialize(client, root, guest)[0]
    storage.verify_object.side_effect = api_error(409, "upload_missing", "Missing")
    path = f"{root}/{photo['id']}/complete"
    assert client.post(path, headers=auth(guest)).status_code == 409
    assert client.get(root, headers=auth(guest)).json()["photos"] == []
    storage.verify_object.side_effect = None
    assert client.post(path, headers=auth(guest)).status_code == 200
    assert (
        client.get(root, headers=auth(guest)).json()["photos"][0]["preview_url"] is None
    )


def test_database_timestamp_invariant(
    client: TestClient, storage: Mock, db_session: Session
) -> None:
    root, _, guest = context(client)
    photo = initialize(client, root, guest)[0]
    with pytest.raises(IntegrityError), db_session.begin_nested():
        db_session.execute(
            text("UPDATE photos SET status = 'uploaded_private' WHERE id = :id"),
            {"id": photo["id"]},
        )
    with pytest.raises(IntegrityError), db_session.begin_nested():
        db_session.execute(
            text("UPDATE photos SET status = 'shared' WHERE id = :id"),
            {"id": photo["id"]},
        )


def test_limits_require_participant(client: TestClient, storage: Mock) -> None:
    root, _, guest = context(client)
    assert client.get(f"{root}/limits").status_code == 401
    assert client.get(f"{root}/limits", headers=auth(guest)).json()["batch_limit"] == 50


def test_quota_counts_pending_but_allows_existing_retry(
    client: TestClient,
    storage: Mock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(get_settings(), "photo_participant_limit", 1)
    root, _, guest = context(client)
    data = [item()]
    original = initialize(client, root, guest, data)
    assert initialize(client, root, guest, data)[0]["id"] == original[0]["id"]
    response = client.post(
        f"{root}/uploads", headers=auth(guest), json={"photos": [item()]}
    )
    assert response.status_code == 409
    assert response.json()["code"] == "photo_quota"


def test_own_listing_is_paged_without_duplicates(
    client: TestClient,
    storage: Mock,
    db_session: Session,
) -> None:
    root, _, guest = context(client)
    initialize(client, root, guest, [item() for _ in range(50)])
    initialize(client, root, guest)
    # The completion contract is covered above; seed confirmed state for pagination.
    for photo in db_session.scalars(select(Photo)):
        photo.status = PhotoStatus.UPLOADED_PRIVATE
        photo.uploaded_at = datetime.now(UTC)
    db_session.commit()
    first = client.get(root, headers=auth(guest)).json()
    second = client.get(
        f"{root}?offset={first['next_offset']}", headers=auth(guest)
    ).json()
    assert len(first["photos"]) == 50 and first["next_offset"] == 50
    assert len(second["photos"]) == 1 and second["next_offset"] is None
    assert len({p["id"] for p in first["photos"] + second["photos"]}) == 51
