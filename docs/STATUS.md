# Gatheroll status

Updated: 2026-09-07

## Implemented
- Create Private (default approval_required) or Public (open) unlisted events.
- POST /events returns {event, manage_token}; public GET never exposes credentials/hashes.
- Host /manage/share: local 256px QR, invite copy, private recovery link, participant cards.
- Guest /e/share: name-only join → pending or approved, refresh restoration, rejection view.
- Server authorization dependencies bind host and participant tokens to their event/role.
- DB stores only SHA-256 secret verifiers; shared invite identifier remains plaintext.
- Final decisions are idempotent; opposite decisions return 409; row lock serializes updates.
- 5-second non-overlapping visible-tab polling with cleanup, stopping on participant final state.
- Role/event localStorage isolated in lib/credentials.ts; blocked-storage warning and memory fallback.
- Creation navigates to a clean host URL. Saved capability links use a fragment which is
  removed from browser history and Next router state on opening.
- 0002 migration adds policies/host verifier and participants without resetting data.
- ADR 003, Korean learning note 002, mobile test checklist and updated README.
- Approved participant photo intake: system multi-file picker, selection removal,
  sequential 384px JPEG thumbnails, best-effort EXIF, and three concurrent file jobs.
- Private R2 originals/thumbnails receive direct browser PUTs; no image-byte proxy
  through FastAPI or Next.js. R2 integration is configured in ignored apps/api/.env.
- 0003 adds photos: pending_upload → uploaded_private, ownership FKs, retry identity,
  metadata and DB timestamp/thumbnail invariants. No AI or sharing states.
- Approved/event-bound participant auth on all photo endpoints, own confirmed
  listing (50/page) with short-lived thumbnail GETs, no host/other-participant access.
- Batch init is idempotent by participant/client UUID; server-controlled keys and
  exact type/length signing. Complete verifies R2 HEAD, locks the row and is idempotent.
- Per-photo retry keeps successful PUT checkpoints; missing/mismatched HEAD clears
  checkpoints for repair. Refresh restores completed uploads, not unfinished Files.
- Configurable demo defaults: 50/batch, 25 MiB/original, 256 KiB/thumbnail, 500/participant;
  PUT 15 minutes / GET 5 minutes. HEIC/HEIF accepted with graceful preview fallback.
- ADR 004, Korean learning note 003 and R2/mobile acceptance document 003 added.
- Development-only photo diagnostics: allowlisted numeric/boolean metrics in browser
  console and an on-phone panel, capped at 100 entries, no remote collection or secrets.
  Logs preparation, PUT/complete/retry, restored list count and page lifecycle signals.
  Step summary: docs/reports/003-private-photo-intake.md.
- Participant-scoped upload preferences: `include_selfies` (default true) and
  `include_screenshots` (default false) stored on participants. Self-scoped PATCH
  endpoint (no participant ID in path, bearer token identity). Frontend
  PreferencesPanel step gated on selected photos and local preferencesConfirmed
  state, not re-asked every batch. Preferences stored but not yet enforced by
  any automatic filtering. ADR 006 and Korean learning note 005 added.

## Verified
- Implementation commit 8595a73 pushed to main with the preceding frontend commit.
  Remote web/API CI passed: https://github.com/yunLeia/gatheroll/actions/runs/34072793840
  (lint/typechecks/tests/build and clean PostgreSQL migrations). Existing Actions
  Node runtime deprecation annotations were non-failing; workflow upgrade is separate.
- Preferences slice: Backend 6 PostgreSQL tests passed (test_preferences.py):
  defaults (selfies true, screenshots false), update/persistence, payload
  validation (both fields required, unknown fields rejected), pending
  participant access, cross-participant isolation, and photo endpoint smoke
  test. Backend Ruff/mypy passed, and the full 58/58 PostgreSQL test suite
  passed (52 prior + 6 new), not just the 6 new tests. Frontend lint,
  typecheck, test, and build were all clean; PreferencesPanel and
  intake-panel integration with preferencesConfirmed state verified locally.
  Existing API TestClient deprecation warnings unchanged. Implementation
  commits 84b5cf3 (backend) and 006d55f (frontend) on branch; this slice
  follows the same patterns and does not modify existing routes.
- Migration 0005's chain (0001→0002→0003→0005) was verified to resolve
  cleanly and `alembic check` reported no drift, using an isolated
  disposable Postgres schema inside `gatheroll_test` (not the shared
  dev/test database, which is owned by a concurrent session).
- Development diagnostic panel verified in the LAN browser with a synthetic
  participant: list_loaded count shown without credentials, filenames or URLs.
- User-reported physical iPhone/Safari check: QR participation → approval → photo
  selection/upload → refresh retained photos. Confirmed in chat after LAN setup fixes;
  not independently operated by the agent. Device/OS version and photo count unknown.
- Latest photo slice: backend Ruff/mypy and **52 PostgreSQL tests** passed (26 new);
  frontend lint/typecheck and **17 Node tests** passed (11 new). Two existing upstream
  TestClient deprecation warnings remain.
- Latest default `npm run build` (Turbopack) and alternate `--webpack` build passed.
  Initial restricted-run helper-port failure recurred from build cache; after moving
  only generated Turbopack cache to a temporary backup, the authorized rebuild passed.
- Alembic 0003 applied to local gatheroll and gatheroll_test, no drift. Empty dedicated
  gatheroll_photo_migration_test migrated 0001→0003, no drift; DB retained for inspection.
- User prepared private gatheroll-dev bucket/CORS; credentials loaded without printing.
  Actual browser → R2 upload: **9 synthetic originals + 9 thumbnails**, all confirmed
  uploaded_private in DB, timestamp present and HEAD size/type verified for all objects.
- Refresh restored the same participant and 9 private thumbnails directly from signed
  R2 URLs. Unsigned S3 HEAD returned 400; public dashboard settings user-confirmed,
  not independently inspected. Synthetic cloud objects remain for inspection.
- Desktop in-app browser: 10 synthetic 4032×3024 PNGs → 384×288 previews in 1128 ms;
  remove one → upload 9 in 7.3 s including API/confirmation. 17,160,678 combined
  object bytes (~2.24 MiB/s effective). Not an iPhone/camera-photo benchmark.
- 375/390/430px photo views had no horizontal overflow; 44px removal and 56px upload
  targets. Deliberately undecodable HEIC fixture showed fallback without blocking
  selection; never uploaded, not a real HEIC compatibility claim.

### Earlier access slice evidence
- 2 pre-existing development events survived migration unchanged except new defaults;
  no management credential can be reclaimed for these legacy rows.
- Alembic check: no model/schema drift.
- PostgreSQL API suite: 26 passed; 2 upstream TestClient deprecation warnings.
- Frontend credential tests: 6 passed. Backend Ruff/mypy and web lint/typecheck passed.
- Final web lint/typecheck, 6 credential tests and production Next.js build passed
  after the URL/diagnostic refinements.
- In-app browser separate tabs: Private pending → approval, Public immediate entry,
  rejection, pending/rejected reload restoration, clean host URL creation/reload.
- 375px host / 390px participant / 430px host had no horizontal overflow in measured views.
- Synthetic browser test events/participants remain in local development DB.
- Check GitHub Actions for the run matching the current commit; local results above
  are separate from remote CI evidence.

## Outstanding acceptance / limits
- Core iPhone/Safari flow is user-confirmed. Exact model/version, HEIC behavior,
  physical-device failure/retry and background/eviction tests remain unverified.
  See docs/testing/003-private-photo-intake.md for the remaining checklist.
- Unfinished selections are not persisted across reload/eviction; reselect required.
  No automatic cleanup/retention, multipart resume, server decode or checksum validation.
- Signed PUTs are reusable until expiry and can overwrite matching-type/length bytes.
  HEAD does not guarantee content integrity/immutability. Revisit before future AI.
- No measured real-phone jank/memory/throughput. No Worker added without that evidence.
- Browser tool only exposes one profile, so tests used role-separated tabs, not isolated devices.
- Intermittent browser network TypeErrors occurred during development; API health/event
  requests returned 200 and retry recovered. Underlying cause not established.
- Clipboard button success shown, but tool clipboard readback was unavailable.
- No AI/shared album, accounts, host editing, token rotation/recovery, participant
  pagination, global abuse/rate limits, expiry enforcement or deployment added.
- Lost localStorage loses identity; XSS can steal tokens. Event create/join still have
  no POST idempotency keys; photo initialization has scoped client UUID idempotency.
- Legacy events with NULL manage_token_hash remain readable but unmanageable.
- Docker is still unavailable locally. Python dependencies remain version ranges.
- Migration 0005 branches from 0003, not 0004: a concurrent, unrelated task in
  another session already claims revision id "0004" for a different migration.
  An `alembic merge` will be needed once that migration lands on this branch.

## Next step
Upload preferences are now stored and surfaced in the UI. Preferences are not
yet enforced by any automatic filtering. The next slice is a multi-label shared
album: allow approved participants to tag their uploaded photos with labels
(e.g. "group", "landmarks", "food"), share tagged photos to an album view only
other approved participants of the same event can see, and explore grouping by
label. Evaluate the album view with user feedback before building AI
classification/filtering.
