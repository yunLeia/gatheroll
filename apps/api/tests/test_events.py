from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session
from test_access import auth, create, join

from gatheroll_api.models import Event


def payload() -> dict[str, str]:
    return {
        "title": " Jenny's Birthday ",
        "event_date": "2026-09-12",
        "location_name": "Brooklyn",
    }


def test_create_and_fetch_persisted_event(client: TestClient) -> None:
    response = client.post("/events", json=payload())
    assert response.status_code == 201
    data = response.json()["event"]
    assert data["title"] == "Jenny's Birthday"
    assert data["event_date"] == "2026-09-12"
    assert "starts_at" not in data and "ends_at" not in data
    assert datetime.fromisoformat(data["expires_at"]) - datetime.fromisoformat(
        data["created_at"]
    ) == timedelta(days=30)
    assert client.get(f"/events/{data['share_token']}").json() == data


@pytest.mark.parametrize(
    "context",
    [
        {},
        {"event_date": None, "location_name": None},
        {"event_date": "2026-09-06"},
        {"location_name": "Brooklyn"},
    ],
)
def test_optional_event_context(client: TestClient, context: dict[str, object]) -> None:
    response = client.post("/events", json={"title": "Gathering", **context})
    assert response.status_code == 201
    event = response.json()["event"]
    assert event["event_date"] == context.get("event_date")
    assert event["location_name"] == context.get("location_name")
    assert client.get(f"/events/{event['share_token']}").json() == event


@pytest.mark.parametrize("policy", ["open", "approval_required"])
def test_legacy_times_never_authorize_or_block_participation(
    client: TestClient, db_session: Session, policy: str
) -> None:
    share, host = create(client, policy)
    event = db_session.scalar(select(Event).where(Event.share_token == share))
    assert event is not None
    # Retained legacy values, deliberately in the distant past; no event-time gate.
    event.starts_at = datetime.fromisoformat("2000-01-01T00:00:00+00:00")
    event.ends_at = datetime.fromisoformat("2000-01-01T01:00:00+00:00")
    db_session.flush()
    public = client.get(f"/events/{share}").json()
    assert public["event_date"] is None  # Do not invent a date from legacy timestamps.
    assert "starts_at" not in public and "ends_at" not in public
    assert client.get(f"/events/{share}/manage", headers=auth(host)).status_code == 200
    participant, token = join(client, share)
    if policy == "approval_required":
        assert (
            client.patch(
                f"/events/{share}/participants/{participant}",
                headers=auth(host),
                json={"status": "approved"},
            ).status_code
            == 200
        )
    assert (
        client.get(f"/events/{share}/participants/me", headers=auth(token)).json()[
            "status"
        ]
        == "approved"
    )


@pytest.mark.parametrize(
    "changes",
    [
        {"title": "   "},
        {"ends_at": "2026-09-12T18:00:00-04:00"},  # Retired API fields rejected.
        {"starts_at": "2026-09-12T19:00:00Z"},
        {"event_date": "2026-02-30"},
        {"event_date": "2026-09-12T00:00:00Z"},
        {"event_date": 0},
        {"latitude": 91},
        {"longitude": -181},
    ],
)
def test_invalid_event(client: TestClient, changes: dict[str, object]) -> None:
    assert client.post("/events", json={**payload(), **changes}).status_code == 422


def test_unknown_event(client: TestClient) -> None:
    response = client.get("/events/unknown")
    assert response.status_code == 404
    assert response.json()["code"] == "event_not_found"


def test_tokens_are_unique_and_not_ids(client: TestClient) -> None:
    events = [client.post("/events", json=payload()).json()["event"] for _ in range(12)]
    tokens = {event["share_token"] for event in events}
    assert len(tokens) == 12
    assert all(len(token) == 43 for token in tokens)
    assert all(event["share_token"] != event["id"] for event in events)


def test_browser_can_post(client: TestClient) -> None:
    response = client.options(
        "/events",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:3000"
