from datetime import UTC, datetime
from unittest.mock import Mock
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from test_access import auth, create, join
from test_photos import context, initialize, item, storage  # noqa: F401

from gatheroll_api.domain import PhotoStatus
from gatheroll_api.models import Photo


def test_album_shared_by_both_roles(client: TestClient, storage: Mock) -> None:  # noqa: F811
    root, host, uploader = context(client)
    _, viewer = join(client, root.split("/")[2], "Viewer")
    photo = initialize(client, root, uploader, [item(thumbnail_size_bytes=20)])[0]
    album = root.removesuffix("/photos") + "/album"
    assert client.get(album, headers=auth(viewer)).json()["photos"] == []
    assert (
        client.post(
            f"{root}/{photo['id']}/complete", headers=auth(uploader)
        ).status_code
        == 200
    )
    storage.create_original_url.return_value = "https://storage.example/original?signed"
    for token in [host, uploader, viewer]:
        response = client.get(album, headers=auth(token))
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        rows = response.json()["photos"]
        assert [p["id"] for p in rows] == [photo["id"]]
        assert rows[0]["preview_url"] is not None
        assert (
            not {"original_key", "latitude", "longitude", "participant_id"}
            & rows[0].keys()
        )
        for download in [False, True]:
            link = client.get(
                f"{album}/{photo['id']}/original",
                headers=auth(token),
                params={"download": download},
            )
            assert link.status_code == 200
            assert link.json()["expires_in_seconds"] > 0
            assert storage.create_original_url.call_args.kwargs == {
                "download": download
            }
    # Personal contribution list and mutation ownership remain separate.
    assert client.get(root, headers=auth(viewer)).json()["photos"] == []
    assert (
        client.post(f"{root}/{photo['id']}/complete", headers=auth(viewer)).status_code
        == 404
    )


@pytest.mark.parametrize("state", ["pending", "rejected"])
def test_album_denies_unapproved_and_outside_credentials(
    client: TestClient,
    storage: Mock,  # noqa: F811
    state: str,  # noqa: F811
) -> None:
    share, host = create(client)
    pid, guest = join(client, share)
    if state == "rejected":
        client.patch(
            f"/events/{share}/participants/{pid}",
            headers=auth(host),
            json={"status": "rejected"},
        )
    other_share, other_host = create(client, "open")
    _, outsider = join(client, other_share)
    for path in [f"/events/{share}/album", f"/events/{share}/album/{uuid4()}/original"]:
        assert client.get(path).status_code == 401
        for token in [guest, outsider, other_host, share]:
            assert client.get(path, headers=auth(token)).status_code in (401, 403)
    storage.create_download_url.assert_not_called()
    storage.create_original_url.assert_not_called()


def test_original_hides_pending_missing_and_other_event(
    client: TestClient,
    storage: Mock,  # noqa: F811
) -> None:
    root, host, guest = context(client)
    pending = initialize(client, root, guest)[0]["id"]
    other_root, _, other_guest = context(client)
    foreign = initialize(client, other_root, other_guest)[0]["id"]
    client.post(f"{other_root}/{foreign}/complete", headers=auth(other_guest))
    album = root.removesuffix("/photos") + "/album"
    for photo_id in [pending, foreign, str(uuid4())]:
        assert (
            client.get(f"{album}/{photo_id}/original", headers=auth(host)).status_code
            == 404
        )
    storage.create_original_url.assert_not_called()


def test_album_exclude_mine_filters_only_the_requesters_own_photos(
    client: TestClient, storage: Mock  # noqa: F811
) -> None:
    root, host, a = context(client)
    share = root.split("/")[2]
    _, b = join(client, share, "B")
    photo_a = initialize(client, root, a)[0]
    photo_b = initialize(client, root, b)[0]
    client.post(f"{root}/{photo_a['id']}/complete", headers=auth(a))
    client.post(f"{root}/{photo_b['id']}/complete", headers=auth(b))
    album = root.removesuffix("/photos") + "/album"
    a_view = client.get(album, headers=auth(a), params={"exclude_mine": True}).json()
    assert [p["id"] for p in a_view["photos"]] == [photo_b["id"]]
    b_view = client.get(album, headers=auth(b), params={"exclude_mine": True}).json()
    assert [p["id"] for p in b_view["photos"]] == [photo_a["id"]]
    # No filtering by default, and none applied for a host with no claimed
    # participant identity -- there is nothing of "theirs" to exclude yet.
    everyone = client.get(album, headers=auth(a)).json()
    assert {p["id"] for p in everyone["photos"]} == {photo_a["id"], photo_b["id"]}
    host_view = client.get(
        album, headers=auth(host), params={"exclude_mine": True}
    ).json()
    assert {p["id"] for p in host_view["photos"]} == {photo_a["id"], photo_b["id"]}


def test_album_exclude_mine_applies_to_the_hosts_own_uploads_too(
    client: TestClient, storage: Mock  # noqa: F811
) -> None:
    root, host, guest = context(client)
    share = root.split("/")[2]
    claimed = client.post(
        f"/events/{share}/participants/host", headers=auth(host)
    ).json()
    host_token = claimed["participant_token"]
    host_photo = initialize(client, root, host_token)[0]
    guest_photo = initialize(client, root, guest)[0]
    client.post(f"{root}/{host_photo['id']}/complete", headers=auth(host_token))
    client.post(f"{root}/{guest_photo['id']}/complete", headers=auth(guest))
    album = root.removesuffix("/photos") + "/album"
    host_view = client.get(
        album, headers=auth(host), params={"exclude_mine": True}
    ).json()
    assert [p["id"] for p in host_view["photos"]] == [guest_photo["id"]]


def test_album_pagination_includes_existing_uploads(
    client: TestClient,
    storage: Mock,  # noqa: F811
    db_session: Session,  # noqa: F811
) -> None:
    root, host, guest = context(client)
    _, second = join(client, root.split("/")[2], "Second")
    initialize(client, root, guest, [item() for _ in range(50)])
    initialize(client, root, second)
    for photo in db_session.scalars(select(Photo)):
        photo.status = PhotoStatus.UPLOADED_PRIVATE
        photo.uploaded_at = datetime.now(UTC)
    db_session.commit()
    album = root.removesuffix("/photos") + "/album"
    page = client.get(album, headers=auth(host)).json()
    rest = client.get(
        album, headers=auth(second), params={"offset": page["next_offset"]}
    ).json()
    assert len(page["photos"]) == 50 and page["next_offset"] == 50
    assert len(rest["photos"]) == 1 and rest["next_offset"] is None
    ids = [p["id"] for p in page["photos"] + rest["photos"]]
    assert len(set(ids)) == 51
    # No thumbnail is valid (e.g. an undecodable HEIC); original still addressable.
    assert rest["photos"][0]["preview_url"] is None
    row = db_session.get(Photo, UUID(ids[0]))
    assert row is not None
    assert (
        client.get(album, headers=auth(host), params={"offset": -1}).status_code == 422
    )
