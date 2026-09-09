# Upload Preferences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an approved participant set two lightweight, event-scoped upload
preferences (`include_selfies`, `include_screenshots`) between photo preview
and upload confirmation, persisted server-side, with no AI/classification
behavior implied.

**Architecture:** Two new boolean columns on `participants` (preferences are
participant+event scoped, not a global profile — Gatheroll has no accounts).
A new self-scoped `PATCH /events/{share_token}/participants/me/preferences`
endpoint, authorized the same way `GET .../me` already is. On the frontend, a
new `PreferencesPanel` is inserted into the existing `IntakePanel` flow
between "photos selected" and "Upload N privately", gated by local state so
it is shown once per browser session per participant, not once per batch.

**Tech Stack:** FastAPI + SQLAlchemy + Alembic + pytest (backend, PostgreSQL
test DB); Next.js + TypeScript + Tailwind + Node test runner (frontend).

**Spec:** The relevant slice of the user's full-feature prompt is reproduced
here; only sections 1–3 (upload preferences) are in scope for this plan.
Sections 4+ (shared album, multi-label, download-all) are separate plans.

> Change the flow to: approved participant → Add Photos → select → preview →
> upload preferences → confirm upload → private upload. Two participant-level
> preferences: `include_selfies` (default true), `include_screenshots`
> (default false). User can change them before upload. AI does not exist yet:
> persist the preferences, expose them in the UI, do not auto-remove photos
> based on them. Avoid copy implying removal happens now; use neutral copy
> such as "Save your preferences for how Gatheroll should organize this
> event." Preferences belong to participant + event, not a global profile —
> use the simplest schema that fits the current codebase.

## Global Constraints

- No AI/classification behavior may be implied by any copy or code in this
  plan — preferences are stored and displayed only.
- Preferences are participant+event scoped. No global/account-level settings
  framework.
- Keep the UX lightweight: two toggles, one "Continue" action, concise copy.
- Follow existing backend conventions exactly (see `participants.py`,
  `security.py`, `schemas.py`) — self-scoped auth via `ParticipantDep`, no new
  auth pattern.
- Follow existing frontend conventions exactly (see `lib/api.ts`,
  `features/photos/intake-panel.tsx`, `components/ui/*`) — no new dependency,
  no new global state framework.
- Web quality gates: `npm run lint`, `npm run typecheck`, `npm test`,
  `npm run build`. Backend quality gates: `ruff check .`, `mypy src tests`,
  `pytest` against a dedicated `gatheroll_test` PostgreSQL database.
- Update `docs/STATUS.md`, `README.md`, and add an ADR + Korean learning note,
  per this repo's working agreement (`AGENTS.md`).

---

## Task 1: Backend — preference columns, self-update endpoint, tests

**Files:**
- Create: `apps/api/migrations/versions/0005_participant_preferences.py`
- Modify: `apps/api/src/gatheroll_api/models.py`
- Modify: `apps/api/src/gatheroll_api/schemas.py`
- Modify: `apps/api/src/gatheroll_api/participants.py`
- Create: `apps/api/tests/test_preferences.py`

**Interfaces:**
- Consumes: `ParticipantDep` (self-auth, any status) and `SessionDep` from
  `gatheroll_api.security`; `api_error` not needed here (no new error codes).
  Test helpers `create`, `auth`, `join` from `tests/test_access.py`.
- Produces: `Participant.include_selfies: bool`, `Participant.include_screenshots: bool`
  (model + DB); `ParticipantPreferencesUpdate` schema (request body);
  `ParticipantResponse` gains `include_selfies`/`include_screenshots` fields
  (used by every existing participant response, including `/me` and the host
  list — later plans read these too); new route
  `PATCH /events/{share_token}/participants/me/preferences` returning
  `ParticipantResponse`.

- [ ] **Step 1: Write the migration**

```python
# apps/api/migrations/versions/0005_participant_preferences.py
"""Add participant-scoped upload preferences (include_selfies, include_screenshots)."""

import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "participants",
        sa.Column(
            "include_selfies", sa.Boolean(), nullable=False, server_default=sa.true()
        ),
    )
    op.add_column(
        "participants",
        sa.Column(
            "include_screenshots",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("participants", "include_screenshots")
    op.drop_column("participants", "include_selfies")
```

This is purely additive (new nullable-never columns with server defaults);
unlike migration 0004 it does not discard information, so a normal reversible
`downgrade()` is correct here — do not copy 0004's forward-only pattern.

- [ ] **Step 2: Apply the migration to the local dev DB and the dedicated test DB**

Run:
```bash
cd apps/api
alembic upgrade head
DATABASE_URL=postgresql+psycopg://gatheroll:gatheroll@localhost:5432/gatheroll_test alembic upgrade head
```
Expected: both report the new head revision `0005`, no errors. If
`gatheroll_test` does not exist yet, create it first (see README "Quality
checks").

- [ ] **Step 3: Add the columns to the `Participant` model**

In `apps/api/src/gatheroll_api/models.py`, add `true` and `false` to the
existing `sqlalchemy` import block:

```python
from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    String,
    UniqueConstraint,
    false,
    true,
)
```

Add two columns to `Participant`, directly after `approved_at`:

```python
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    include_selfies: Mapped[bool] = mapped_column(server_default=true())
    include_screenshots: Mapped[bool] = mapped_column(server_default=false())
    event: Mapped[Event] = relationship(back_populates="participants")
```

- [ ] **Step 4: Run `alembic check` to confirm the model matches the migrated schema**

Run:
```bash
cd apps/api
DATABASE_URL=postgresql+psycopg://gatheroll:gatheroll@localhost:5432/gatheroll_test alembic check
```
Expected: `No new upgrade operations detected.`

- [ ] **Step 5: Write the failing tests**

```python
# apps/api/tests/test_preferences.py
from fastapi.testclient import TestClient

from tests.test_access import auth, create, join

PATH = "{root}/participants/me/preferences"


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
```

- [ ] **Step 6: Run the tests to verify they fail**

Run:
```bash
cd apps/api
TEST_DATABASE_URL=postgresql+psycopg://gatheroll:gatheroll@localhost:5432/gatheroll_test pytest tests/test_preferences.py -v
```
Expected: `test_defaults_are_selfies_on_screenshots_off` and
`test_participant_can_update_own_preferences_and_it_persists` FAIL with a
`KeyError`/`assert None is True` (field missing from the response); the
preference-update tests FAIL with 404 (route does not exist yet).

- [ ] **Step 7: Add the schemas**

In `apps/api/src/gatheroll_api/schemas.py`, extend `ParticipantResponse` and
add `ParticipantPreferencesUpdate` right after it:

```python
class ParticipantResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    display_name: str
    status: ParticipantStatus
    joined_at: datetime
    approved_at: datetime | None
    include_selfies: bool
    include_screenshots: bool


class ParticipantPreferencesUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    include_selfies: bool
    include_screenshots: bool
```

- [ ] **Step 8: Set explicit defaults at join time and add the endpoint**

In `apps/api/src/gatheroll_api/participants.py`, add the new schema to the
existing import and set explicit values in `join_event` (explicit, matching
how `status`/`joined_at` are already set explicitly rather than relying only
on DB defaults):

```python
from gatheroll_api.schemas import (
    ErrorResponse,
    ParticipantCreate,
    ParticipantDecision,
    ParticipantJoined,
    ParticipantPreferencesUpdate,
    ParticipantResponse,
)
```

```python
    participant = Participant(
        id=uuid4(),
        event_id=event.id,
        display_name=data.display_name,
        participant_token_hash=hash_token(token),
        joined_at=now,
        status=ParticipantStatus.APPROVED if approved else ParticipantStatus.PENDING,
        approved_at=now if approved else None,
        include_selfies=True,
        include_screenshots=False,
    )
```

Add the new route at the end of the file:

```python
@router.patch("/me/preferences", response_model=ParticipantResponse)
def update_my_preferences(
    data: ParticipantPreferencesUpdate,
    participant: ParticipantDep,
    session: SessionDep,
) -> Participant:
    participant.include_selfies = data.include_selfies
    participant.include_screenshots = data.include_screenshots
    session.commit()
    session.refresh(participant)
    return participant
```

- [ ] **Step 9: Run the tests to verify they pass**

Run:
```bash
cd apps/api
TEST_DATABASE_URL=postgresql+psycopg://gatheroll:gatheroll@localhost:5432/gatheroll_test pytest tests/test_preferences.py -v
```
Expected: all 6 tests PASS.

- [ ] **Step 10: Run the full backend quality gate**

Run:
```bash
cd apps/api
ruff check .
mypy src tests
DATABASE_URL=postgresql+psycopg://gatheroll:gatheroll@localhost:5432/gatheroll_test alembic upgrade head
TEST_DATABASE_URL=postgresql+psycopg://gatheroll:gatheroll@localhost:5432/gatheroll_test pytest
```
Expected: Ruff clean, mypy clean, migrations at head, all tests pass
(existing `test_access.py`/`test_photos.py`/etc. plus the 6 new tests).

- [ ] **Step 11: Commit**

```bash
git add apps/api/migrations/versions/0005_participant_preferences.py \
  apps/api/src/gatheroll_api/models.py \
  apps/api/src/gatheroll_api/schemas.py \
  apps/api/src/gatheroll_api/participants.py \
  apps/api/tests/test_preferences.py
git commit -m "Add participant-scoped upload preferences (selfies, screenshots)"
```

---

## Task 2: Frontend — preferences panel wired into the intake flow

**Files:**
- Modify: `apps/web/lib/api.ts`
- Create: `apps/web/features/photos/preferences-panel.tsx`
- Modify: `apps/web/features/photos/intake-panel.tsx`
- Modify: `apps/web/features/participants/join-panel.tsx`

**Interfaces:**
- Consumes: `Participant.include_selfies`/`include_screenshots` (Task 1's API
  response, now also present on the frontend `Participant` type once
  extended); `Button` from `@/components/ui/button`; `cn` from `@/lib/cn`.
- Produces: `ParticipantPreferences` type; `api.updatePreferences(share,
  token, prefs): Promise<Participant>`; `<PreferencesPanel initial busy
  onContinue>` component; `IntakePanel` gains `participant` and
  `onPreferencesUpdated` props consumed by `JoinPanel`.

- [ ] **Step 1: Extend the API client**

In `apps/web/lib/api.ts`, add fields to the existing `Participant` type and a
new `ParticipantPreferences` type near the other type declarations:

```ts
export type Participant = {
  id: string;
  display_name: string;
  status: ParticipantStatus;
  joined_at: string;
  approved_at: string | null;
  include_selfies: boolean;
  include_screenshots: boolean;
};

export type ParticipantPreferences = {
  include_selfies: boolean;
  include_screenshots: boolean;
};
```

Add a method to the exported `api` object (after `decide`):

```ts
  updatePreferences: (
    share: string,
    token: string,
    prefs: ParticipantPreferences,
  ) =>
    request<Participant>(
      `${eventPath(share)}/participants/me/preferences`,
      { method: "PATCH", token, body: prefs },
    ),
```

- [ ] **Step 2: Build the preferences panel**

```tsx
// apps/web/features/photos/preferences-panel.tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { ParticipantPreferences } from "@/lib/api";

function PreferenceRow({
  title,
  description,
  checked,
  onToggle,
}: {
  title: string;
  description: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onToggle}
      className="flex min-h-11 w-full items-center justify-between gap-4 text-left"
    >
      <span>
        <span className="block font-medium">{title}</span>
        <span className="block text-sm text-muted-foreground">
          {description}
        </span>
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "relative h-7 w-12 flex-none rounded-full border border-border transition-colors",
          checked ? "bg-primary" : "bg-transparent",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-foreground transition-transform",
            checked && "translate-x-[20px] bg-primary-foreground",
          )}
        />
      </span>
    </button>
  );
}

export function PreferencesPanel({
  initial,
  busy,
  onContinue,
}: {
  initial: ParticipantPreferences;
  busy: boolean;
  onContinue: (prefs: ParticipantPreferences) => void;
}) {
  const [includeSelfies, setIncludeSelfies] = useState(initial.include_selfies);
  const [includeScreenshots, setIncludeScreenshots] = useState(
    initial.include_screenshots,
  );
  return (
    <section
      className="space-y-5 rounded-lg border border-border bg-card p-5"
      aria-label="Upload preferences"
    >
      <div>
        <h3 className="font-semibold">What should we include?</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Save your preferences for how Gatheroll should organize this event.
        </p>
      </div>
      <PreferenceRow
        title="Selfies"
        description="Include selfies from this event"
        checked={includeSelfies}
        onToggle={() => setIncludeSelfies((v) => !v)}
      />
      <PreferenceRow
        title="Screenshots"
        description="Include screenshots"
        checked={includeScreenshots}
        onToggle={() => setIncludeScreenshots((v) => !v)}
      />
      <Button
        size="lg"
        disabled={busy}
        onClick={() =>
          onContinue({
            include_selfies: includeSelfies,
            include_screenshots: includeScreenshots,
          })
        }
      >
        {busy ? "Saving…" : "Continue"}
      </Button>
    </section>
  );
}
```

- [ ] **Step 3: Wire it into `IntakePanel`**

In `apps/web/features/photos/intake-panel.tsx`:

Add imports:
```ts
import { api, type Participant, type ParticipantPreferences } from "@/lib/api";
import { PreferencesPanel } from "./preferences-panel";
```

Change the component signature to accept the participant and a callback:
```ts
export function IntakePanel({
  share,
  token,
  participant,
  onPreferencesUpdated,
}: {
  share: string;
  token: string;
  participant: Participant;
  onPreferencesUpdated: (participant: Participant) => void;
}) {
```

Add state next to the other `useState` calls:
```ts
  const [preferencesConfirmed, setPreferencesConfirmed] = useState(false);
  const [savingPreferences, setSavingPreferences] = useState(false);
```

Add a handler next to `upload`/`loadMore`:
```ts
  async function savePreferences(prefs: ParticipantPreferences) {
    setSavingPreferences(true);
    setError("");
    try {
      const updated = await api.updatePreferences(share, token, prefs);
      onPreferencesUpdated(updated);
      setPreferencesConfirmed(true);
    } catch {
      setError("We couldn’t save your preferences. Try again.");
    } finally {
      if (alive.current) setSavingPreferences(false);
    }
  }
```

Replace the existing sticky upload-button block:
```tsx
          {selected > 0 && (
            <div className="sticky bottom-0 bg-background py-3 pb-[max(12px,env(safe-area-inset-bottom))]">
              <Button size="lg" disabled={busy} onClick={upload}>
                {busy
                  ? "Working…"
                  : failed === selected
                    ? `Retry ${failed}`
                    : `Upload ${selected} privately`}
              </Button>
            </div>
          )}
```
with a gate on `preferencesConfirmed`:
```tsx
          {selected > 0 && !preferencesConfirmed && (
            <PreferencesPanel
              initial={{
                include_selfies: participant.include_selfies,
                include_screenshots: participant.include_screenshots,
              }}
              busy={savingPreferences}
              onContinue={savePreferences}
            />
          )}
          {selected > 0 && preferencesConfirmed && (
            <div className="sticky bottom-0 bg-background py-3 pb-[max(12px,env(safe-area-inset-bottom))]">
              <Button size="lg" disabled={busy} onClick={upload}>
                {busy
                  ? "Working…"
                  : failed === selected
                    ? `Retry ${failed}`
                    : `Upload ${selected} privately`}
              </Button>
            </div>
          )}
```

`preferencesConfirmed` intentionally does not reset when more files are
added later in the same page load — the spec scopes preferences to
participant+event, not per-batch, and re-asking on every batch would violate
"keep this lightweight."

- [ ] **Step 4: Pass the participant through from `JoinPanel`**

In `apps/web/features/participants/join-panel.tsx`, narrow the render guard
so `participant` is non-null for TypeScript and pass the two new props:

```tsx
      {participant && participant.status === "approved" && token && !invalid && (
        <IntakePanel
          key={share}
          share={share}
          token={token}
          participant={participant}
          onPreferencesUpdated={setParticipant}
        />
      )}
```

- [ ] **Step 5: Manual verification in the browser**

Run:
```bash
cd apps/web
npm run dev
```
With the API running locally (`uvicorn gatheroll_api.main:app --reload` from
`apps/api`, migrated to head): create an event, join as a participant (or use
an open-join event to skip approval), select at least one photo, and confirm
the "What should we include?" panel appears with Selfies on / Screenshots
off, that toggling and tapping Continue reveals the normal "Upload N
privately" button, and that a second batch selected afterward skips straight
to the upload button. Check at 375px, 390px, and 430px viewport widths — the
panel must not overflow horizontally and both rows must be comfortably
tappable.

- [ ] **Step 6: Run the frontend quality gate**

Run:
```bash
cd apps/web
npm run lint
npm run typecheck
npm test
npm run build
```
Expected: all four pass with no new failures.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/api.ts \
  apps/web/features/photos/preferences-panel.tsx \
  apps/web/features/photos/intake-panel.tsx \
  apps/web/features/participants/join-panel.tsx
git commit -m "Add upload-preferences step to the participant photo intake flow"
```

---

## Task 3: Documentation

**Files:**
- Create: `docs/adr/006-participant-scoped-upload-preferences.md`
- Create: `docs/learning/005-upload-preferences.md`
- Modify: `docs/STATUS.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing new — this task only records what Tasks 1–2 built.
- Produces: nothing consumed by later tasks; this is the terminal task of
  this plan.

- [ ] **Step 1: Write the ADR**

Create `docs/adr/006-participant-scoped-upload-preferences.md` covering: the
decision to store `include_selfies`/`include_screenshots` directly on
`participants` rather than a generic settings/profile table (no accounts
exist; preferences have exactly one owner shape today); that AI does not
exist yet and the columns are inert until a future classification/decision
engine reads them; that the endpoint is self-scoped (`.../me/preferences`,
no participant ID in the path) so "one participant cannot update another's"
is true by construction, not by an authorization check that could be gotten
wrong; and that pending participants may set preferences too, since doing so
carries no privacy/security weight.

- [ ] **Step 2: Write the Korean learning note**

Create `docs/learning/005-upload-preferences.md` explaining, tied to the
actual files touched: why preferences live on `participants` and not a new
table (1:1 today, YAGNI on a generic settings framework); why the endpoint
takes no ID and instead reuses the bearer-token self-identity pattern from
`GET .../me`; why the frontend gates on local `preferencesConfirmed` state
instead of re-asking every batch; and why the copy avoids implying that
selfie/screenshot removal happens now.

- [ ] **Step 3: Update `docs/STATUS.md`**

Add a new bullet under `## Implemented` describing the preferences slice
(columns, endpoint, defaults, frontend step, gating behavior), and update
`## Verified` with the actual test/lint/build results captured while running
Tasks 1–2's quality gates. Update `## Next step` to point at the next plan
(multi-label + shared album shell) instead of the now-completed preferences
work.

- [ ] **Step 4: Update `README.md`**

Add a row to the "Roles and access contracts" table:

```
| PATCH /events/{share}/participants/me/preferences | Participant Bearer token | Updated own `{include_selfies, include_screenshots}` |
```

Add one sentence to the `participants` schema paragraph noting the two new
non-null boolean columns and their defaults (`true`/`false`), and one
sentence near "Private photo intake" clarifying that preferences are stored
but not yet enforced by any automatic filtering.

- [ ] **Step 5: Commit**

```bash
git add docs/adr/006-participant-scoped-upload-preferences.md \
  docs/learning/005-upload-preferences.md docs/STATUS.md README.md
git commit -m "Document the upload-preferences slice (ADR, learning note, STATUS, README)"
```
