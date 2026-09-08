# Gatheroll status

Updated: 2026-09-08

## Implemented
- **AI direction pivot (ADR 007, 2026-09-08):** event relevance is no longer a V1
  AI target. Participant selection is trusted as relevance directly. AI investment
  moves to pre-upload cleanup (screenshot/selfie/blur detection, suggest-only),
  shared-album multi-label filters, and download exclusion of a participant's own
  uploads. A SigLIP2 embedding-similarity relevance experiment was designed and
  implemented (local embedding generator with caching/versioning, centroid/
  nearest-neighbor/top-k mean baselines) on branch `relevance-embeddings` before
  this correction, before any real labels were collected. Kept unmerged as
  experimental history, not deleted — see ADR 007's branch-disposition section for
  what's reusable (the embedding generator/caching pattern) versus relevance-
  specific (the scoring baselines, the belongs/does_not_belong labeling scheme).
  See also [learning note 006](learning/006-vision-ai-direction-pivot.md).
- **Pre-upload Cleanup v1** (report 006, eval guide 003, learning note 007):
  four deterministic-where-possible signals, each the simplest suitable
  technique for its own problem, not one model forced onto all four. Blur
  (Laplacian variance, no model) and screenshot (format/dimension/EXIF
  heuristic, no model) compute in the browser during `preparePhoto()` and
  expose `blur_score`/`is_likely_screenshot` on `PhotoJob` — data only, no
  review/exclude UI yet. Exact-duplicate detection (SHA-256 content hash,
  `apps/web/features/cleanup/duplicates.ts`) is deterministic with no
  accuracy question at all; near-duplicate (pHash/embedding) stays
  explicitly deferred. Selfie detection stays **offline-only**: two
  pretrained baselines (OpenCV Haar Cascade face geometry vs. SigLIP2
  zero-shot, `eval/cleanup/`) are compared, not shipped — browser-vs-backend
  and any production threshold remain open, evidence-gated decisions.
  Offline evaluation reuses a new minimal per-photo `CleanupExample` schema
  (`apps/web/evaluation/cleanup-dataset.ts`) and `npm run eval:cleanup`
  (`--detector blur|screenshot|selfie|duplicates`) — deliberately not the
  event-relevance harness's shapes (ADR 007: single-photo properties, not
  cross-photo comparisons).
- Product correction (ADR 005): participant selection is the first relevance filter;
  exact host boundaries are not membership criteria. Time/GPS are weak context only.
- Create/API/header: name, optional event_date/location, join policy. Retired starts_at/
  ends_at inputs rejected; no exact times in current responses/UI. Calendar date does
  not shift with viewer timezone. Old DB timestamps retained as nullable context.
- Migration 0004 preserves old rows, adds nullable DATE, drops time-order check. New
  expires_at bookkeeping uses creation+retention_days; no expiry enforcement/cleanup.
- Evaluation now defaults to all user-selected candidates; event ID needs no time/GPS.
  Old metadata experiments remain opt-in historical comparisons, not current architecture.
  Labeling v2, product reference audit, ADR/learning/report 005 and supersession notices added.
- Offline event-relevance evaluator: three deterministic baselines, versioned config,
  development-only threshold sweep, JSON/CSV outputs and per-photo Markdown errors.
  Labeling rules in docs/eval; schema/collection/run guide in eval/README.md.
- Shared browser/eval exifr extraction in features/photos/metadata.ts; timestamp semantics
  unchanged. No production classification, AI fields, migration, sharing or new dependency.
- Private eval_data/ originals/manifests/results ignored; public synthetic 20-row regression
  fixture committed-ready. Real golden collection is pending (0 real photos supplied/evaluated).
- Korean R2/eval learning notes and docs/reports/004-metadata-baseline.md document measured
  synthetic results, privacy boundaries, error hypotheses and remaining verification limits.
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
- Pre-upload Cleanup v1: web lint/typecheck/build clean after each of the 4
  detector slices; **50/50 tests passing** (18 new in `cleanup.test.mjs`).
  Smoke evidence only, not accuracy metrics (full detail in report 006):
  blur correctly separated a synthetic solid-color image (score 0) from
  synthetic random noise (score 51,226.99); screenshot heuristic correctly
  classified a synthetic iPhone-resolution PNG vs. a synthetic camera-
  resolution JPEG; the selfie face-heuristic found 10 low-confidence false
  detections (largest 0.12% of frame) on one real photo and could not
  decode a real HEIC file at all (OpenCV limitation), while SigLIP2
  zero-shot correctly predicted "selfie" on the same JPEG; exact-duplicate
  detection correctly grouped a real photo with a byte-identical copy and
  found **zero duplicate groups across the real local 169-photo set**
  (a real measurement, not a smoke test — duplicate detection has no
  accuracy question to smoke-test in the first place).
- Current correction: web lint/typecheck/**32 tests**/production build and backend
  Ruff/mypy/**61 PostgreSQL tests** passed. Local dev/test Alembic check: no drift.
- Migration 0004 applied locally: all pre-existing values of **10 events, 6 participants,
  10 photos** preserved; no image objects read. Disposable test-schema 0003→0004 also
  verifies legacy linked rows and new events without timestamps. No data reset.
- All-selected-only CLI run generated ignored eval_data/candidates-v2-run. No further
  time sweep or real-photo evaluation. Previous 004 metrics below are historical evidence.
- Browser shows simplified optional-date form. Full submission unverified due runtime
  LAN mismatch: Next shell override API=192.168.1.185:8000 and API Origin=.185:3000, but
  current Mac en0=172.16.29.99. Next is correctly on 0.0.0.0:3000. No network config changed.
  See docs/reports/005-event-context-correction.md. No commit/push/current remote CI run.
- Current offline-eval working tree: web lint/typecheck, **30 Node tests** (13 new),
  default production build; backend Ruff/mypy and **52 dedicated PostgreSQL tests** passed.
  No new remote CI run: changes have not been committed/pushed in this task.
- Synthetic-only evaluation: 20 rows (10 belongs, 8 unrelated, 2 ambiguous), 1 development
  event; three baselines and 9×2 threshold candidates generated. Time+GPS TP=6 FP=4 FN=4,
  precision/recall=60%, FPR=50%, review=35%; NOT measured real-photo/product performance.
- Forced single original PUT failure automated: 3 jobs, peers finish, only failed ID/PUT
  retried. Physical Safari/R2 failure remains unverified; no production failure switch added.
- Shared exifr verified using synthetic JPEG EXIF bytes; no real HEIC compatibility claim.
- Current build initially hit restricted helper-port error cached by Turbopack; generated
  .next/cache/turbopack preserved in /private/tmp/gatheroll-eval-build.8jM8TT before authorized
  rebuild passed. No .env/source/user data removed; temporary cache backup remains recoverable.
- R2 GetBucketCors read returned AccessDenied with current key. Learning note distinguishes
  known localhost/LAN success from intended CORS example; full live policy not independently read.
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
- Resolved: migration 0004 (optional event context) and 0005 (upload
  preferences) both branched from 0003 independently; merged with
  `alembic merge` into 0006. Single head confirmed (`alembic heads` reports
  only `0006`); local `gatheroll`/`gatheroll_test` upgraded to it cleanly.
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
- Real golden dataset not collected: next evaluation needs intentionally supplied local
  photos and human labels. Synthetic cases demonstrate logical limitations, not prevalence
  or visual-embedding benefit. No threshold chosen as safe for production.
- Full current R2 CORS JSON needs dashboard comparison/export by user; permissions were not
  broadened. No fresh phone HEIC/10-camera-photo/jank measurement; prior evidence preserved.
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

## Next step
**Pre-upload Cleanup v1 code is implemented** (blur, screenshot, selfie
comparison, exact duplicates — see report 006); **real measurement is not.**
Collect the labeled fixtures in
[eval guide 003](eval/003-cleanup-v1-experiments.md) (blur/screenshot/selfie
each need real labeled photos; duplicates already has a real measurement,
zero groups in the local set) and run each `npm run eval:cleanup` mode
against them. Only after that: pick a real `blur_threshold`, decide whether
the screenshot heuristic alone is sufficient or needs the deferred zero-shot
comparison, and decide (evidence-gated) whether selfie detection is worth
shipping at all and in which runtime. No review/exclude UI exists yet for
any of the four signals — that's the deliberate next slice after real
numbers exist, not before. Explicitly still out of scope: event relevance,
clustering, shared-album classification, near-duplicate (pHash/embedding)
detection, storing the content hash server-side for the future download-
exclude promise, external vision APIs, and download ZIP infrastructure.

Align development LAN URLs/origins with the current IP before phone recheck
(currently 172.16.29.99; do not assume it stays fixed) — unrelated infrastructure
follow-up, independent of the AI direction above.
