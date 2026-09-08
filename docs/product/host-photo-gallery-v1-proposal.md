# Host photo gallery v1 — UX/product proposal (not yet implemented)

2026-09-08. Proposal only — pending Codex review/build of the backend piece.
No frontend or backend code written against this yet.

## Why this, why now

Per the original brief's own priority order (`docs/product/original-brief.md`
§39): "working shared album without AI" ranks *above* event-relevance AI,
and ADR 005/007 already retired relevance filtering from V1 scope (trust
participant selection directly). Everything upstream of this is built and
verified: create event → QR join → approval → private photo intake with
client-side thumbnails → confirmed upload. But the album itself — the thing
a host actually opens to see what people shared — does not exist yet. The
host page (`apps/web/features/events/host-page.tsx`) currently ends at
participant approval; there is no photo-facing UI at all on the host side.
This is the largest gap between what's built and the product's own one-line
pitch ("a shared album that fills itself").

## Scope: V1 is deliberately small

**In scope:**
- A read-only grid of all confirmed-uploaded photos for the event, visible
  to the host only.
- Per-photo, on-demand original download (tap a photo → view full-size →
  download button). No bulk/ZIP download — matches the original brief's own
  phasing (ZIP is explicitly "optional depth after V1", brief §35) and
  today's `docs/STATUS.md` scope note ("no ... download ZIP infrastructure").
- Basic chronological ordering (`created_at`, matching the existing
  participant-facing photo list's own ordering) and pagination, reusing the
  50/page shape already established in `PhotoPage`/`my_photos`.
- Empty state ("No photos yet") and loading state, matching the visual
  language already used in `intake-panel.tsx` and `host-participants.tsx`.

**Explicitly out of scope for v1** (do not build without a separate
decision):
- Any smart categorization/filtering (`All / Group / People / Scenery /
  Food / Candid` from brief §27's mockup) — that's relevance/classification
  work already deferred past V1 by ADR 007.
- Enforcing participant `include_selfies`/`include_screenshots` preferences
  as a filter — those are stored but explicitly not yet enforced anywhere
  (`docs/STATUS.md`); a gallery filter would be the first place that
  enforcement decision gets made, and it hasn't been made yet. V1 gallery
  shows everything uploaded, full stop.
- ZIP/bulk download, moment clustering, "photos with me," cross-camera
  grouping — all named as later-phase or optional in the brief.
- Real-time updates. Reuse the existing 5-second polling pattern
  (`HostParticipants`) only if/when it's clearly wanted; a manual "Refresh"
  action is enough for v1, matching `intake-panel.tsx`'s own "Refresh
  previews" button.
- Per-photo deletion/moderation by the host. Not requested anywhere in the
  brief for v1; would need its own auth/consent design (a participant's
  photo being removable by someone else raises questions ADR 004's privacy
  posture doesn't currently answer).

## What the backend needs (for Codex — not built here)

No host-scoped photo endpoint exists today. `GET /events/{share_token}/photos`
(`apps/api/src/gatheroll_api/photos.py`) is participant-scoped: it filters to
`Photo.participant_id == participant.id` and never returns original links,
only signed thumbnail URLs (`my_photos`, photos.py:180-211). A host view
needs a parallel, host-authorized endpoint:

- **List:** `GET /events/{share_token}/photos` under host auth (same
  `HostDep` pattern already used in `participants.py`'s `list_participants`)
  returning all `PhotoStatus.UPLOADED_PRIVATE` photos for the event, any
  participant — same `PhotoPage`/`PhotoPreview` shape as the participant
  version (signed thumbnail URL + short TTL), so the frontend can reuse the
  existing `PhotoPreview` type instead of inventing a new one. Whether this
  is the *same* route disambiguated by which credential is presented, or a
  separate `/manage/...` path, is an API design call for Codex — either is
  fine from the frontend's side as long as the response shape matches
  `PhotoPreview`.
- **Original download:** a per-photo, on-demand signed URL for the original
  (not the thumbnail) — e.g. `GET /events/{share_token}/photos/{photo_id}/download`
  under the same host auth, returning a short-TTL signed R2 GET URL. Signed
  on request, not batched with the list response, consistent with ADR 004's
  "never proxy image bytes through the API" posture and the existing pattern
  of signing thumbnail URLs individually per page load.
- Both need to enforce host-only access (event's `manage_token`, not any
  participant token) — reuse `HostDep`, do not add a new auth mechanism.

Nothing else changes: no new DB columns, no new photo states, no migration.
This is a read path over data that already exists.

## Frontend shape (mine to build once the endpoint exists)

- New section in `host-page.tsx`, slotted after `HostParticipants` and
  before the "Keep your host access" section — same `Card`/`PageHeader`
  primitives already in use, no new design system work needed.
- Dense grid matching brief §27's "camera-roll grid, not social feed"
  direction: 3-column on mobile, more on wider viewports, thumbnail-only in
  the grid (never fetch/decode originals for the grid itself — matches the
  intake panel's own thumbnail-first pattern).
- Tap a thumbnail → simple lightbox/detail view (full-bleed image, close
  button, download button that requests the per-photo signed original URL
  at that moment, not ahead of time).
- Photo count in the section header (`"Photos · N"`, matching
  `"Your uploads · N"` in the intake panel for visual consistency).
- Until the backend endpoint exists, the frontend stub should render a
  clearly-labeled "Coming soon" state — not fake data, not a mocked photo
  grid. (Per the working agreement: don't invent backend data that doesn't
  exist yet.)

## Open questions for Codex / next decision point

1. Same route disambiguated by credential, or a separate host-prefixed
   route? (Frontend is agnostic either way.)
2. Does the host list response need to include which participant uploaded
   each photo (display name), or is that out of scope for v1 too? The brief
   doesn't call for per-photo attribution in the album view mockup (§27
   shows a plain grid), so default answer is **no** unless there's a reason
   to add it.
3. Pagination UX: settled — an explicit "Load more" button, matching the
   pattern already used by `intake-panel.tsx`'s own confirmed-uploads list
   (`page.next_offset`-driven, no infinite scroll anywhere else in the
   codebase).
