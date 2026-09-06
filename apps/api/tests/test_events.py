import os
from collections.abc import Iterator
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from gatheroll_api.database import get_session, postgres_url
from gatheroll_api.main import app


@pytest.fixture
def client() -> Iterator[TestClient]:
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.fail("Set TEST_DATABASE_URL to a migrated, dedicated PostgreSQL test DB")
    engine = create_engine(postgres_url(url))
    with engine.connect() as connection:
        transaction = connection.begin()
        with Session(connection, join_transaction_mode="create_savepoint") as session:
            app.dependency_overrides[get_session] = lambda: session
            try:
                with TestClient(app) as test_client:
                    yield test_client
            finally:
                app.dependency_overrides.clear()
        transaction.rollback()
    engine.dispose()


def payload() -> dict[str, str]:
    return {
        "title": " Jenny's Birthday ",
        "starts_at": "2026-09-12T19:00:00-04:00",
        "ends_at": "2026-09-12T23:30:00-04:00",
        "location_name": "Brooklyn",
    }


def test_create_and_fetch_persisted_event(client: TestClient) -> None:
    response = client.post("/events", json=payload())
    assert response.status_code == 201
    data = response.json()
    assert data["title"] == "Jenny's Birthday"
    assert datetime.fromisoformat(data["expires_at"]) - datetime.fromisoformat(
        data["ends_at"]
    ) == timedelta(days=30)
    assert client.get(f"/events/{data['share_token']}").json() == data


@pytest.mark.parametrize(
    "changes",
    [
        {"title": "   "},
        {"ends_at": "2026-09-12T18:00:00-04:00"},
        {"ends_at": "2026-09-12T19:00:00-04:00"},
        {"starts_at": "2026-09-12T19:00:00"},
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
    events = [client.post("/events", json=payload()).json() for _ in range(12)]
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
