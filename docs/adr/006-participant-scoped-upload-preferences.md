# ADR 006 — Participant-scoped upload preferences

Date: 2026-09-07
Status: Accepted; participants now store `include_selfies` and `include_screenshots`,
surfaced in a single self-scoped preferences endpoint and frontend step.

## Context

Gatheroll will eventually recommend which explicitly selected photos belong to an
event. Different participants may have different preferences about selfies or
screenshots—for example, a participant might prefer not to include selfies they
took of themselves, or they might exclude screenshots shared in group chats.

These preferences do not yet drive any automatic filtering or removal of uploaded
photos. They are stored on the participant record and displayed in the frontend
to inform the participant's choices. A future classification/decision engine will
read and apply them.

## Decision

Each participant stores two boolean preferences directly on the `participants` row:
`include_selfies` (default `true`) and `include_screenshots` (default `false`).
There is no separate settings or profile table; the 1:1 relationship between
participant and preferences does not yet justify a generic framework.

The participant updates their own preferences via a self-scoped endpoint:
`PATCH /events/{share_token}/participants/me/preferences`. No participant ID
appears in the path. The endpoint reuses the bearer-token self-identity pattern
from `GET .../me`, making it impossible by construction for one participant to
update another's preferences (not through an authorization check that could be
gotten wrong, but through the absence of a changeable ID in the URL).

Pending participants may set preferences. This carries no privacy or security
weight: they control only their own preferences before the host approves them,
and doing so does not establish any authorization over their uploaded photos.

The frontend gates the preferences step on having photos selected (`selected > 0`)
and having confirmed preferences at least once (`preferencesConfirmed` local state),
rather than re-asking every time photos are added to a batch.

## Alternatives

- Settings/profile table: adds overhead for a 1:1 relationship today; YAGNI.
- Admin-scoped preference override: host decides preferences for all participants.
  Rejected: participants must control their own configuration.
- Automatic photo filtering now: changes behavior that the participant agreed to
  upload. The current design stores preferences but does not filter. Later decisions
  are made by a future engine, not silently in this slice.
- Restrict preferences to approved participants only: Pending participants can set
  them before approval. This is safe (they cannot see others' photos or take actions
  before the host approves), and doing so preserves participant agency: they can
  indicate their preferences in case the host approves them.

## Consequences and limits

- Preferences are stored but not yet enforced. No photos are automatically removed
  or filtered based on `include_selfies` or `include_screenshots`. Calling this
  slice "automatic selfie removal" or "photo filtering" would be false.
- The endpoint is self-scoped, so authorization is simpler than checking IDs in
  the path. Cross-participant updates are impossible by design.
- No account ecosystem exists yet. Preferences are tied to the single participant
  bearer token; lost credentials mean lost identity.
- The frontend preference step can be dismissed if no photos are selected (`selected < 1`),
  avoiding forced configuration steps for participants who do not upload.
- Defaults are conservative: include selfies by default (opt-out), exclude
  screenshots (opt-in). These can be tuned in future slices with user evidence.

## References

- `apps/api/migrations/versions/0005_participant_preferences.py`
- `apps/api/src/gatheroll_api/models.py` (Participant model)
- `apps/api/src/gatheroll_api/schemas.py` (ParticipantResponse, ParticipantPreferencesUpdate)
- `apps/api/src/gatheroll_api/participants.py` (PATCH /me/preferences endpoint, join defaults)
- `apps/web/features/photos/preferences-panel.tsx`
- `apps/web/features/photos/intake-panel.tsx` (preferencesConfirmed gating)
