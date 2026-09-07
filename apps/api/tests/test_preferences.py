from fastapi.testclient import TestClient

# `from tests.test_access import auth, create, join` fails under pytest's
# rootless import mode here (no `tests/__init__.py`, so `tests` is not an
# importable package: ModuleNotFoundError: No module named 'tests'). Inlined
# per the fallback in the task brief rather than restructuring the package.


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


def test_defaults_are_selfies_on_screenshots_off(client: TestClient) -> None:
    share, _ = create(client)
    _, token = join(client, share)
    result = client.get(f"/events/{share}/participants/me", headers=auth(token)).json()
    assert result["include_selfies"] is True
    assert result["include_screenshots"] is False


def test_participant_can_update_own_preferences_and_it_persists(
    client: TestClient,
) -> None:
    share, _ = create(client)
    _, token = join(client, share)
    path = f"/events/{share}/participants/me/preferences"
    response = client.patch(
        path,
        json={"include_selfies": False, "include_screenshots": True},
        headers=auth(token),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["include_selfies"] is False
    assert body["include_screenshots"] is True
    refetched = client.get(
        f"/events/{share}/participants/me", headers=auth(token)
    ).json()
    assert refetched["include_selfies"] is False
    assert refetched["include_screenshots"] is True


def test_preferences_require_both_fields_and_reject_unknown_fields(
    client: TestClient,
) -> None:
    share, _ = create(client)
    _, token = join(client, share)
    path = f"/events/{share}/participants/me/preferences"
    assert (
        client.patch(
            path, json={"include_selfies": True}, headers=auth(token)
        ).status_code
        == 422
    )
    assert (
        client.patch(
            path,
            json={
                "include_selfies": True,
                "include_screenshots": False,
                "extra": 1,
            },
            headers=auth(token),
        ).status_code
        == 422
    )


def test_pending_participant_can_still_set_preferences(client: TestClient) -> None:
    # Preferences carry no privacy/security weight; gating them on approval
    # would only add friction without protecting anything.
    share, _ = create(client, "approval_required")
    _, token = join(client, share)
    response = client.patch(
        f"/events/{share}/participants/me/preferences",
        json={"include_selfies": False, "include_screenshots": False},
        headers=auth(token),
    )
    assert response.status_code == 200


def test_approved_participant_can_update_own_preferences(client: TestClient) -> None:
    # The frontend only ever calls this endpoint as an approved participant;
    # the other tests above exercise the pending path.
    share, _ = create(client, "open")
    _, token = join(client, share)
    response = client.patch(
        f"/events/{share}/participants/me/preferences",
        json={"include_selfies": False, "include_screenshots": True},
        headers=auth(token),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "approved"
    assert body["include_selfies"] is False
    assert body["include_screenshots"] is True


def test_one_participant_cannot_update_another_participants_preferences(
    client: TestClient,
) -> None:
    share, host = create(client)
    _, a_token = join(client, share, "A")
    _, b_token = join(client, share, "B")
    path = f"/events/{share}/participants/me/preferences"
    body = {"include_selfies": False, "include_screenshots": True}
    for token in [host, "x" * 43]:
        assert client.patch(path, json=body, headers=auth(token)).status_code == 403
    assert client.patch(path, json=body).status_code == 401
    client.patch(path, json=body, headers=auth(b_token))
    a_state = client.get(
        f"/events/{share}/participants/me", headers=auth(a_token)
    ).json()
    assert a_state["include_selfies"] is True
    assert a_state["include_screenshots"] is False


def test_existing_photo_intake_still_works(client: TestClient) -> None:
    # Smoke check that ParticipantResponse growing two fields did not break
    # the approved-participant photo endpoints tested fully in test_photos.py.
    share, _ = create(client)
    _, token = join(client, share)
    response = client.get(
        f"/events/{share}/photos/limits", headers=auth(token)
    )
    assert response.status_code == 403  # not yet approved; endpoint still reachable
