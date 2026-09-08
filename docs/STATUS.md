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
- **Cleanup v2 classifiers evaluated (2026-09-08, report 008, proposal
  `docs/product/cleanup-v2-classifiers-proposal.md`) — evaluation only, no
  production code changed.** Selfie got its first full real-49-photo
  evaluation (previously only smoke-tested): face-geometry heuristic is
  systematically blind to 15/49 real photos (no HEIC codec in `cv2`) and
  recalls only 10% even on the photos it can decode -- not competitive.
  SigLIP2 zero-shot's original result (0.35 precision, 0.97 FPR) traced to
  a real methodology bug, not a capability limit: its 3-way prompt set had
  no "none of these" option, so every screenshot and blurry photo in the
  set got forced into "selfie." Fixed the prompt set (added
  `screenshot`/`other_no_selfie` categories) and re-ran: 0 errors on all 49
  photos (small-n caveat noted in the report). Screenshot got a new
  interpretable hybrid (`apps/web/features/cleanup/screenshot-hybrid.ts`,
  written and unit-tested, **not wired into any live path**): visual
  (SigLIP2) + metadata (format) agree -> confident; disagree ->
  "uncertain," never a silent guess. On the real set this correctly demoted
  SigLIP2-alone's 4 false positives to "uncertain" instead of a wrong
  answer (24 TP / 0 FP / 0 FN / 21 TN / 4 uncertain). Blur and exact-
  duplicate deliberately untouched. SigLIP2 inference measured at ~200ms/
  image warm (CPU) with a ~5s one-time model-load cost and a 1.4GB
  checkpoint -- ruled out browser-side inference, and ruled out needing
  Redis/a queue/a vector DB for a server-side `BackgroundTasks`-based
  approach at this traffic scale. Proposal awaits approval before any
  `apps/api` wiring.
- **Real-device upload bug found and fixed (2026-09-08):** a phone test
  (5 photos selected) failed with "Could not authorize upload"; API logs
  showed `POST /photos/uploads` returning **422**, not a storage/connection
  problem as the generic error text implied. Root cause: `PhotoInput` on the
  client (`apps/web/features/photos/types.ts`) grew four suggestion-only
  fields during the cleanup work (`has_camera_exif`, `blur_score`,
  `is_likely_screenshot`, `content_hash`) that were never meant to leave the
  browser, but `photos/api.ts`'s `initialize()` sent the full object as-is
  into a request body the API's `PhotoInput` schema validates with
  `extra="forbid"` (`apps/api/.../photo_schemas.py`) -- every batch with any
  photo carrying those fields 422'd, unconditionally, regardless of storage
  health. Nothing in existing lint/typecheck/56-test/build coverage caught
  it: TypeScript's structural typing doesn't flag extra properties, and no
  test exercised the real wire payload (existing tests inject a fake
  `services.initialize`, bypassing `api.ts` entirely). Fixed by extracting
  `toUploadPhoto()` (`apps/web/features/photos/wire.ts`) to strip the four
  client-only fields before the request, with a new test asserting exactly
  that, plus a test differentiating the old generic error message so a
  future 4xx/5xx no longer blames storage. Verified two ways: (1) replayed
  the literal old buggy payload against the live local API -> reproduced the
  same 422 with `extra_forbidden` on all four fields; replayed the fixed
  payload -> 200 with valid signed R2 URLs, proving storage/R2 itself was
  never the problem; (2) full lint/typecheck/58-test/build clean.
  **Re-verified on an actual phone (2026-09-08): confirmed fixed** --
  `POST /photos/uploads` now returns 200 for the real device.

  **Second, separate bug found in the same session, also now resolved:**
  after the 422 fix, real uploads still failed one step later ("Not
  confirmed. Retry keeps successful upload steps.") -- the direct browser
  PUT to the signed R2 URL. This reproduced identically in an automated
  Chrome session (503, 3/3 attempts) and, decisively, on the real phone
  too, which ruled out the initial "Cloudflare bot-detection targeting the
  automation session" theory recorded earlier. A direct CORS preflight
  probe against the signed R2 URL (`curl -X OPTIONS` with
  `Origin`/`Access-Control-Request-*` headers) returned the real cause:
  `403 Forbidden -- "CORS not configured for this bucket"`. The
  `gatheroll-dev` R2 bucket had no CORS policy at all, so every real
  browser (which requires a CORS preflight for a cross-origin `PUT`) failed
  before the request even reached the signed-URL logic, while plain `curl`
  (no browser, no preflight) always succeeded against the identical URL --
  exactly the discriminator that made this look browser/automation-specific
  rather than infrastructure. Not fixable from this session: the scoped API
  key gets `AccessDenied` even reading `GetBucketCors`, let alone writing
  it. User added a CORS policy via the Cloudflare dashboard (allowing
  `http://localhost:3000` and the LAN IP, `PUT/GET/HEAD`) and confirmed a
  real end-to-end phone upload succeeded. **Recurring gotcha, not a
  one-time fix:** like `NEXT_PUBLIC_API_BASE_URL`/`GATHEROLL_WEB_ORIGIN`/
  `allowedDevOrigins`, this bucket CORS allowlist needs the new LAN IP
  added again every time it changes -- see the LAN phone-testing memory.

  **Third finding, same session, product/UX not code:** a participant
  reported deselecting "Selfies" in upload preferences but the photo
  uploaded anyway. Confirmed as intentional-but-misleadingly-worded, not a
  bug: `include_selfies`/`include_screenshots` are saved
  (`participants/me/preferences`) but never consulted anywhere to filter
  selection or upload (deliberate per ADR 006 -- no selfie-detection
  signal exists client-side to filter by, and no browser-vs-backend/
  threshold decision has been made per ADR 007). The toggle's old copy
  ("Include selfies from this event") read as an immediate action, not a
  stored-for-later preference. Reworded to "Saved for later -- everything
  you pick still uploads today" (`preferences-panel.tsx`) so the UI stops
  promising filtering the app doesn't do yet. Actual enforcement remains
  future work and the natural first candidate is the host gallery view
  (`docs/product/host-photo-gallery-v1-proposal.md` already flags this
  exact open question).
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
- **Pre-upload Cleanup v1: first real accuracy numbers** (report 007, real
  49-photo labeled set). Screenshot metadata heuristic measured **0%
  recall** (real screenshots' actual resolution, 1206×2622, wasn't in the
  hardcoded `known_dimensions` list) — retired as a production candidate,
  not scheduled for further tuning. A new content-based SigLIP2 zero-shot
  baseline (`screenshot_zero_shot.py`) measured **100% recall / 85.7%
  precision** on the same set (all 4 false positives were blurry camera
  photos). Separately, `sharp` failed to decode 15/15 real labeled HEIC
  files (`heif: Decoder plugin generated an error`, a systematic
  environment limitation) — fixed with an eval-only `sips`-based JPEG
  cache bridge that never touches original files; after the fix, blur
  scoring covers the full 49-photo set (100% recall / 61.5% precision at
  the still-placeholder `blur_threshold=100`) instead of silently
  excluding 31% of it.
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

- Suggest-only blur/duplicate review badges (commit 575f302): exact-duplicate
  suggestion browser-verified end-to-end (two byte-identical JPEGs uploaded
  under different filenames in a live Chrome session both correctly showed
  "Possible duplicate," nothing auto-removed). Blur suggestion badge remains
  unit-tested/evaluated only (report 007's 49-photo set) — the real-HEIC
  browser path is still unverified; browser automation could not push actual
  `.heic` files through the picker in that session (files were silently
  skipped), and a JPEG proxy of a labeled-blurry photo scored above the
  provisional `blur_threshold=100` and correctly went unflagged given that
  threshold — not evidence of a bug, just an unverified path. A real iPhone/
  Safari check with a genuinely blurry HEIC is planned separately.

## Local dev troubleshooting notes
- **Alembic drift → 503 on every participant join.** If `POST /events/{token}/participants`
  returns `{"code":"service_unavailable"}` with no other detail, check `alembic current`
  vs. `alembic heads` in `apps/api` before suspecting app logic — a local dev DB sitting
  behind head (missing e.g. the 0005 `include_selfies`/`include_screenshots` columns) makes
  every insert raise `SQLAlchemyError`, which `main.py`'s handler intentionally flattens to a
  generic 503 (no column/table detail leaked to the client). Fix: `alembic upgrade head`
  against the local DB; not a code bug. Hit and resolved this way during suggest-only
  blur/duplicate badge browser verification (2026-09-08).

- **Cross-batch "already uploaded" duplicate detection added (2026-09-08):**
  a real phone report ("selected the same photo twice, no duplicate flag")
  traced to a real gap, not a broken model: `groupExactDuplicates`
  (`content_hash`, exact SHA-256) only ever compared photos *within the
  current not-yet-uploaded selection* -- it never checked a new selection
  against photos already confirmed-uploaded in an earlier batch, since the
  comparison set was `jobs.filter(state !== "uploaded")`. Can't reuse
  content-hash matching for that path (the server deliberately never
  stores `content_hash`, per ADR 007's scope notes), so added a second,
  weaker-but-deterministic proxy: `alreadyUploadedIds()`
  (`apps/web/features/cleanup/duplicates.ts`) matches a new selection
  against `stored` by `(original_filename, file_size_bytes)`, both of
  which the server already returns from `GET /photos` and just weren't
  surfaced in the frontend's `StoredPhoto` type. New badge, distinct from
  "Possible duplicate": "Matches a photo you already uploaded". Verified
  end-to-end in a live browser: uploaded a photo, re-added the identical
  file in a separate "Add photos" action, badge appeared correctly.
  Regression tests added at both the `alreadyUploadedIds` and
  `cleanupSuggestions` level. Near-duplicate (different-but-similar
  photos) remains explicitly out of scope, unchanged.

## Next step
**Awaiting approval: cleanup v2 classifiers proposal**
(`docs/product/cleanup-v2-classifiers-proposal.md`, report 008, 2026-09-08)
— selfie and screenshot are now real-evaluated (see Verified above) with a
concrete, measured production architecture proposed (server-side
`BackgroundTasks`, no new infra), but nothing is wired in yet per explicit
direction to wait for approval first. Also explicitly deferred by the same
direction: the participant-facing "review these suggestions, confirm
what's shared" UI (the `uploaded privately != shared` boundary doesn't
exist in the schema yet) and the requested bulk-download feature, both
UX/UI decisions to be made in a separate pass.

**Host photo gallery v1 proposed** (`docs/product/host-photo-gallery-v1-proposal.md`,
2026-09-08): the original brief ranks "working shared album without AI"
above relevance AI (already deferred by ADR 005/007), and it's the largest
gap between what's built and the product's own pitch — the host can approve
participants but has no photo-facing UI at all. Scope: read-only grid +
per-photo on-demand original download, no ZIP/bulk download, no smart
filtering (participant preferences stay unenforced, matching current state).
Needs a new host-authorized photo-listing + per-photo download-URL endpoint
in `apps/api` (none exists today — `GET /photos` is participant-scoped and
never returns originals) before the frontend can be wired up for real; a
non-mocked "Coming soon" stub (`apps/web/features/photos/host-gallery.tsx`)
is slotted into the host page in the meantime.

**Pre-upload Cleanup v1 code is implemented** (blur, screenshot × 2
baselines, selfie comparison, exact duplicates); **real measurement now
exists for blur and screenshot** (report 007, real 49-photo set) — selfie
still only has the report 006 plumbing check, not a real-set precision/
recall run. n=49 is a real measurement, not synthetic, but still small
relative to the 100–250 reference scale the earlier relevance-labeling
guide used — treat current numbers as a start, not a final answer, and
grow the labeled set before making any production call. No production/
browser-vs-backend decision exists yet for any of the four signals, and no
review/exclude UI exists yet either — that's the deliberate next slice
after real numbers exist, not before. Explicitly still out of scope: event
relevance, clustering, shared-album classification, near-duplicate
(pHash/embedding) detection, storing the content hash server-side for the
future download-exclude promise, external vision APIs, and download ZIP
infrastructure.

LAN URLs/origins realigned to the current IP (2026-09-08): the Mac's address
changed again (now 10.17.77.0; still do not assume it stays fixed —
re-check with `ipconfig getifaddr en0` each session). Updated
`apps/web/.env.local` (`NEXT_PUBLIC_API_BASE_URL`) and `apps/api/.env`
(`GATHEROLL_WEB_ORIGIN`) to the current IP and restarted both dev servers
(`next dev` already binds all interfaces by default; `uvicorn` needed an
explicit `--host 0.0.0.0`, which it was missing). Both confirmed reachable
over LAN by IP (`/health` 200, web root 200). Not yet re-verified from an
actual phone this session. Trade-off: `GATHEROLL_WEB_ORIGIN` only allows one
CORS origin at a time, so laptop browser testing against `localhost:3000`
will fail CORS while this is pointed at the LAN IP — use the LAN IP on the
laptop too, or flip `.env` back for localhost-only work.

**Follow-up, same day:** opening `http://10.17.77.0:3000` in an actual
browser (not `curl`) hung forever on "Checking API…" despite both servers
being individually reachable. Root cause was neither the servers nor the
network: `apps/web/next.config.ts` had a stale `allowedDevOrigins:
["192.168.1.185"]` left over from report 005's earlier LAN mismatch — Next
dev's cross-origin protection silently blocks dev-resource requests from
any origin not on that list, and a stale Turbopack-cached chunk (`.next/`)
was also still serving the old `localhost:8000` API base URL. Fixed by
updating `allowedDevOrigins` to the current IP, clearing `.next`, and
restarting; browser-confirmed "API connected" afterward via a live Chrome
session. Lesson for the next IP change: `allowedDevOrigins` in
`next.config.ts` needs updating too, not just the two `.env` files, and a
stale Turbopack cache is a real failure mode after an env change — `rm -rf
.next` before assuming the app itself is broken.
