from unittest.mock import Mock
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from test_access import auth, create, join
from test_photos import storage  # noqa: F401

from gatheroll_api.models import Participant


def claim_host(client: TestClient, share: str, host: str) -> tuple[str, str]:
    response = client.post(f"/events/{share}/participants/host", headers=auth(host))
    assert response.status_code == 200, response.text
    result = response.json()
    assert "participant_token_hash" not in result["participant"]
    return result["participant"]["id"], result["participant_token"]


def test_host_can_claim_a_participant_identity(
    client: TestClient, db_session: Session
) -> None:
    share, host = create(client)
    pid, token = claim_host(client, share, host)
    row = db_session.scalar(select(Participant).where(Participant.id == pid))
    assert row is not None and row.is_host is True
    me = client.get(f"/events/{share}/participants/me", headers=auth(token))
    assert me.status_code == 200
    result = me.json()
    assert result["id"] == pid
    assert result["status"] == "approved" and result["approved_at"] is not None


def test_host_participant_can_use_photo_endpoints(
    client: TestClient, storage: Mock  # noqa: F811
) -> None:
    share, host = create(client)
    _, token = claim_host(client, share, host)
    response = client.get(f"/events/{share}/photos/limits", headers=auth(token))
    assert response.status_code == 200
    response = client.post(
        f"/events/{share}/photos/uploads",
        headers=auth(token),
        json={
            "photos": [
                {
                    "client_id": str(uuid4()),
                    "original_filename": "host-photo.jpg",
                    "content_type": "image/jpeg",
                    "file_size_bytes": 100,
                }
            ]
        },
    )
    assert response.status_code == 200, response.text


def test_host_participant_hidden_from_participant_list(client: TestClient) -> None:
    share, host = create(client)
    claim_host(client, share, host)
    gid, _ = join(client, share)
    people = client.get(f"/events/{share}/participants", headers=auth(host)).json()
    assert [p["id"] for p in people] == [gid]


def test_host_participant_claim_is_idempotent_but_rotates_token(
    client: TestClient,
) -> None:
    share, host = create(client)
    pid_a, token_a = claim_host(client, share, host)
    pid_b, token_b = claim_host(client, share, host)
    assert pid_a == pid_b
    assert token_a != token_b
    me = f"/events/{share}/participants/me"
    assert client.get(me, headers=auth(token_a)).status_code == 403
    assert client.get(me, headers=auth(token_b)).status_code == 200


def test_host_participant_claim_requires_host_credential(client: TestClient) -> None:
    share, host = create(client)
    _, guest = join(client, share)
    assert client.post(f"/events/{share}/participants/host").status_code == 401
    assert (
        client.post(
            f"/events/{share}/participants/host", headers=auth(guest)
        ).status_code
        == 403
    )
    other_share, other_host = create(client)
    assert (
        client.post(
            f"/events/{share}/participants/host", headers=auth(other_host)
        ).status_code
        == 403
    )
