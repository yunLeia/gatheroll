from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from gatheroll_api.models import Event, Participant
from gatheroll_api.security import hash_token


def create(client: TestClient, policy: str | None = None) -> tuple[str, str]:
    data = {
        "title": "Access test",
    }
    if policy is not None:
        data["join_policy"] = policy
    response = client.post("/events", json=data)
    assert response.status_code == 201
    result = response.json()
    assert "no-store" in response.headers["cache-control"]
    return result["event"]["share_token"], result["manage_token"]


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def join(client: TestClient, share: str, name: str = "Leia") -> tuple[str, str]:
    response = client.post(f"/events/{share}/participants", json={"display_name": name})
    assert response.status_code == 201
    result = response.json()
    assert "participant_token_hash" not in result["participant"]
    assert "no-store" in response.headers["cache-control"]
    return result["participant"]["id"], result["participant_token"]


@pytest.mark.parametrize(
    "policy,expected", [(None, "approval_required"), ("open", "open")]
)
def test_event_policy_and_secret_separation(
    client: TestClient,
    db_session: Session,
    policy: str | None,
    expected: str,
) -> None:
    share, token = create(client, policy)
    public = client.get(f"/events/{share}").json()
    assert public["join_policy"] == expected
    assert not {"manage_token", "manage_token_hash", "participants"}.intersection(
        public
    )
    event = db_session.scalar(select(Event).where(Event.share_token == share))
    assert event is not None
    assert len(token) == 43 and token != share
    assert event.manage_token_hash == hash_token(token)
    assert event.manage_token_hash != token
    assert client.get(f"/events/{share}/manage", headers=auth(token)).json() == public


@pytest.mark.parametrize(
    "policy,status", [("open", "approved"), ("approval_required", "pending")]
)
def test_join_policy_and_restoration(
    client: TestClient,
    db_session: Session,
    policy: str,
    status: str,
) -> None:
    share, _ = create(client, policy)
    pid, token = join(client, share)
    response = client.get(f"/events/{share}/participants/me", headers=auth(token))
    assert response.status_code == 200
    result = response.json()
    assert result["id"] == pid and result["status"] == status
    assert (result["approved_at"] is not None) == (status == "approved")
    assert not {"participant_token", "participant_token_hash"}.intersection(result)
    row = db_session.get(Participant, UUID(pid))
    assert row is not None and row.participant_token_hash == hash_token(token)
    assert row.participant_token_hash != token


@pytest.mark.parametrize(
    "body",
    [
        {"display_name": "  "},
        {"display_name": "a" * 81},
        {"display_name": "Leia", "status": "approved"},
    ],
)
def test_invalid_join_and_client_cannot_self_approve(
    client: TestClient, body: dict[str, str]
) -> None:
    share, _ = create(client)
    assert client.post(f"/events/{share}/participants", json=body).status_code == 422


def test_duplicate_names_are_different_identities(client: TestClient) -> None:
    share, _ = create(client)
    first = join(client, share)
    second = join(client, share)
    assert first[0] != second[0] and first[1] != second[1]


@pytest.mark.parametrize("decision", ["approved", "rejected"])
def test_host_decision_persists_and_is_idempotent(
    client: TestClient,
    db_session: Session,
    decision: str,
) -> None:
    share, host = create(client)
    pid, guest = join(client, share)
    path = f"/events/{share}/participants"
    people = client.get(path, headers=auth(host))
    assert people.status_code == 200 and len(people.json()) == 1
    assert "participant_token_hash" not in people.json()[0]
    response = client.patch(
        f"{path}/{pid}", json={"status": decision}, headers=auth(host)
    )
    assert response.status_code == 200
    assert response.json()["status"] == decision
    assert (
        client.patch(
            f"{path}/{pid}", json={"status": decision}, headers=auth(host)
        ).json()
        == response.json()
    )
    db_session.expire_all()
    current = client.get(f"{path}/me", headers=auth(guest)).json()
    assert current["status"] == decision
    assert (current["approved_at"] is not None) == (decision == "approved")
    opposite = "rejected" if decision == "approved" else "approved"
    assert (
        client.patch(
            f"{path}/{pid}", json={"status": opposite}, headers=auth(host)
        ).status_code
        == 409
    )


def test_capabilities_are_event_and_role_scoped(client: TestClient) -> None:
    share, host = create(client)
    other_share, other_host = create(client)
    pid, guest = join(client, share)
    _, other_guest = join(client, other_share)
    root = f"/events/{share}/participants"
    for token in [guest, other_host, other_guest, share, "x" * 43]:
        assert client.get(root, headers=auth(token)).status_code == 403
        assert (
            client.get(f"/events/{share}/manage", headers=auth(token)).status_code
            == 403
        )
        assert (
            client.patch(
                f"{root}/{pid}", json={"status": "approved"}, headers=auth(token)
            ).status_code
            == 403
        )
    assert client.get(root).status_code == 401
    assert client.patch(f"{root}/{pid}", json={"status": "approved"}).status_code == 401
    for token in [host, other_guest, other_host, "x" * 43]:
        assert client.get(f"{root}/me", headers=auth(token)).status_code == 403
    assert client.get(f"{root}/me").status_code == 401
    assert client.get(f"{root}/me?token={guest}").status_code == 401
    # Even a legitimate host cannot mutate a participant from another event.
    assert (
        client.patch(
            f"/events/{other_share}/participants/{pid}",
            json={"status": "approved"},
            headers=auth(other_host),
        ).status_code
        == 404
    )


def test_same_event_participants_only_see_themselves(client: TestClient) -> None:
    share, _ = create(client)
    first, a = join(client, share, "A")
    second, b = join(client, share, "B")
    root = f"/events/{share}/participants"
    assert client.get(f"{root}/me", headers=auth(a)).json()["id"] == first
    assert client.get(f"{root}/me", headers=auth(b)).json()["id"] == second
    assert client.get(f"{root}/{second}", headers=auth(a)).status_code in (404, 405)


def test_legacy_event_has_no_claimable_host(
    client: TestClient, db_session: Session
) -> None:
    share, host = create(client)
    row = db_session.scalar(select(Event).where(Event.share_token == share))
    assert row is not None
    row.manage_token_hash = None
    db_session.commit()
    assert client.get(f"/events/{share}").status_code == 200
    assert client.get(f"/events/{share}/manage", headers=auth(host)).status_code == 403


def test_database_prevents_inconsistent_status(
    client: TestClient, db_session: Session
) -> None:
    share, _ = create(client)
    pid, _ = join(client, share)
    with pytest.raises(IntegrityError), db_session.begin_nested():
        db_session.execute(
            text("UPDATE participants SET approved_at = now() WHERE id = :id"),
            {"id": pid},
        )


def test_host_cors_preflight(client: TestClient) -> None:
    response = client.options(
        "/events/test/participants/test",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "PATCH",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    assert response.status_code == 200
    assert "PATCH" in response.headers["access-control-allow-methods"]
