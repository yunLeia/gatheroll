# Private photo intake — setup and verification

Updated: 2026-09-06. Distinguish automated/synthetic tests from physical evidence.

## First: phone QR prerequisite

Before photo architecture changes, reviewed `002-mobile-access.md` and its same-Wi-Fi
setup. No phone camera is available to the agent. Subsequently the user confirmed
the **iPhone + Safari** core flow: QR participation → approval → photo selection/
upload → photos retained after refresh. This is user-reported physical evidence,
not desktop emulation. Model/iOS/Safari version, photo count and separate coverage
of both join policies were not supplied.

## Real R2 development setup (one provider)

1. Create the private `gatheroll-dev` bucket. Keep **r2.dev public access disabled**
   and do not attach a public custom domain. The S3 credentials used by this app
   do not by themselves prove those dashboard settings; verify them explicitly.
2. Create R2 S3 credentials scoped to object read/write for this development bucket.
   Put them only in `apps/api/.env`, not the web app, chat, source, screenshots or git.
   Keep `.env.example` as the separate secret-free template; do not rename it in git.
3. Set `GATHEROLL_R2_ACCOUNT_ID`, `GATHEROLL_R2_ACCESS_KEY_ID`,
   `GATHEROLL_R2_SECRET_ACCESS_KEY`, `GATHEROLL_R2_BUCKET_NAME=gatheroll-dev`.
   `GATHEROLL_R2_ENDPOINT` is optional, normally derived as
   `https://<account>.r2.cloudflarestorage.com`. Use the endpoint Cloudflare shows
   for jurisdiction-specific buckets. Do not use r2.dev/custom public URLs.
4. Install API dependencies with `pip install -e '.[dev]'`, apply `alembic upgrade
   head` to the intended development DB, then restart the API. Settings and the S3
   client are process-cached; editing `.env` alone is not a reliable hot reload.
5. Set bucket CORS in Cloudflare (replace the LAN example with the Mac's address):

```json
[
  {
    "AllowedOrigins": ["http://localhost:3000", "http://192.168.1.20:3000"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

The original Blob sets browser Content-Length; JS must not try to set that forbidden
header. The presigner signs its exact expected value. Validate this on real Safari
and R2 before claiming compatibility. Presigned browser PUTs need CORS even though
the URL is signed. Do not send the participant Bearer header to R2. See
[Cloudflare's CORS guide](https://developers.cloudflare.com/r2/buckets/cors/).

For the phone, follow the two-server `0.0.0.0` commands in `002-mobile-access.md`.
Use the same LAN URL for host and phone, configure API `GATHEROLL_WEB_ORIGIN` and
frontend `NEXT_PUBLIC_API_BASE_URL`, and add that exact web origin to R2 CORS.
Frontend and API CORS and R2 CORS are **two separate configurations**. A phone's
localhost is not the Mac. Native file input works without a camera-roll permission
grant. The client UUID generator also works on local HTTP; use HTTPS for hosting.

## Implemented limits

| Setting suffix (all GATHEROLL_) | Default | Reason |
| --- | --- | --- |
| PHOTO_BATCH_LIMIT | 50 | Dozens of selections, bounded setup and preview memory |
| PHOTO_MAX_BYTES | 26214400 (25 MiB) | Ordinary phone stills; large RAW/video excluded |
| PHOTO_THUMBNAIL_MAX_BYTES | 262144 (256 KiB) | Bounded 384px JPEG preview payload |
| PHOTO_PARTICIPANT_LIMIT | 500 | Demo quota includes abandoned records; not rate limiting |
| PHOTO_PUT_TTL_SECONDS | 900 | Batch upload/retry window, not permanent write access |
| PHOTO_GET_TTL_SECONDS | 300 | Short-lived private thumbnail access |

Accepted originals: JPEG, PNG, WebP, HEIC/HEIF; no SVG/GIF/video/RAW. MIME supplied by
the picker wins; only empty MIME uses a filename-extension fallback. Content MIME is
not magic-byte validation. Generated thumbnails are JPEG. Client selection reads
server limits; server remains authoritative. File count overflow rejects the new
selection; invalid individual files are skipped with a count, preserving valid ones.

## API contracts

All photo paths start `/events/{share_token}/photos` and require an **approved
participant** Bearer credential. Host credentials do not qualify.

| Method / suffix | Request | Response |
| --- | --- | --- |
| GET /limits | None | batch_limit, max_bytes, thumbnail_max_bytes, accepted_types |
| POST /uploads | `{photos: [PhotoInput, ...]}` | Array of id, client_id, status, original/thumbnail `{url, headers}`, expires_in_seconds |
| POST /{photo_id}/complete | No body | Own photo metadata, status, uploaded_at; no storage keys |
| GET /?offset=0 | None | `{photos: [...], next_offset}`; 50 rows/page, signed thumbnail URL or null |

PhotoInput: client_id UUID, original_filename, content_type, file_size_bytes;
optional thumbnail_size_bytes, timezone-aware captured_at, latitude, longitude,
width, height. Extra fields such as event_id/participant_id/original_key are rejected.
Original and thumbnail PUT requests are not application API endpoints.

Missing auth: 401. Wrong role/event/unapproved: 403. Another owner's photo: 404.
Inconsistent retry, quota, missing/mismatched objects: 409. Invalid metadata/limits:
422. Storage missing/unavailable: 503. Responses are no-store/no-referrer.
Repeated init with the same participant/client IDs and identical metadata returns
the same photo IDs, re-signing pending uploads. Already completed photos get no PUT
targets. Complete requires all declared objects, is idempotent and does not trust a
client boolean claiming the bytes arrived.

## Failure, restart and cleanup

- Per-photo failures do not cancel siblings. Retry processes only unsuccessful
  files, obtains fresh authorization, and skips successful PUT steps in the live
  page. Lost completion response → retry confirmation, not original upload.
- A completion 409 (HEAD found missing/mismatched objects) clears local checkpoints
  so retry can resend bytes. A declared thumbnail must succeed before completion.
- Navigation aborts queued work. Refresh loses unfinished Files; it restores the
  participant and **completed** DB records, not a byte-level resumable queue.
- A completed HEIC without a thumbnail gets a fallback card after refresh; we do
  not download full originals to fake efficient persisted previews.
- Signed previews can expire. Return-to-tab and Refresh previews obtain new URLs.
  Load more provides bounded retrieval. No background timer signs URLs endlessly.
- Removing a selected/failed card only removes browser state; it does not delete
  existing pending records/objects. UI copy does not call this cloud deletion.

Operator-only stale identification (read-only; never run against an unknown DB):

```sql
SELECT id, event_id, participant_id, created_at
FROM photos
WHERE status = 'pending_upload' AND created_at < now() - interval '24 hours'
ORDER BY created_at;
```

For manual cleanup, coordinate against live retries, wait out the longest issued PUT
TTL, delete both known R2 keys (including a pending thumbnail's deterministic key),
then delete the specific DB rows only after successful object deletion. Object
deletion is idempotent; preserve rows on failure. Do not blindly cascade parents or
apply a bucket-wide lifecycle and leave DB records claiming objects still exist.
No cleanup command/scheduler or retention guarantee is implemented yet. Before real
ongoing use, add controlled expiry/tombstoning to prevent cleanup/retry races and
define a retention period with the user. Current dev objects persist until removed.

## Evidence so far

- API suite: 52 tests passed, including original 26; two existing upstream
  TestClient deprecation warnings. Storage signing/HEAD boundary is mocked except
  an offline signing-contract test; normal tests never upload to R2.
- API Ruff and mypy passed. Frontend lint/typecheck and 16 tests passed (10 photo +
  6 access tests). Photo tests cover
  concurrency=3, partial failure/retry, checkpoint reuse, lost init response,
  completed-record short-circuit, abort, direct PUT isolation, MIME/time validation.
  Thumbnail-only retry and HEAD-conflict repair are included. API tests also cover
  quota/abandoned record accounting and 50-row pagination boundaries.
- Dedicated `gatheroll_test`: migration 0003 applied, Alembic check no drift.
- New dedicated `gatheroll_photo_migration_test`: 0001→0003 from empty, no drift.
  This synthetic schema-only test database remains locally for inspection.
- Browser synthetic event and participant created in development DB. No user photos
  were read. In-app desktop browser at 390px: 10 generated 4032×3024 PNGs selected;
  all produced 384×288 previews, removal targets 44px, Upload button 56px.
- Reported application timing: **1128 ms for metadata + thumbnails of those 10
  synthetic PNGs**, including sequential processing/yields. This is neither a real
  camera-photo dataset nor an iPhone benchmark. Automation file-picker transfer
  took much longer; that tool latency is not photo-processing time.
- No objective input-latency/long-task or memory measurement yet; no Worker added.
- Both default `next build` (Turbopack) and `next build --webpack` passed. Initially
  a restricted run hit a helper-process port binding denial; retry repeated it.
  Moving only generated `.next/cache/turbopack` to a recoverable temporary backup
  followed by an authorized default rebuild passed. No build-script change needed.
- Actual R2 development integration: user configured private `gatheroll-dev`, keys
  and CORS; keys were never printed. Access verified with HEAD bucket. User confirmed
  public access disabled; dashboard public settings were not independently inspected.
- Browser removed one selected file, uploaded **9 synthetic originals + 9 thumbnails**
  directly to R2, and showed 9/9 stored privately. UI session time **7.3 seconds**
  includes authorization, PUTs and confirmation (not raw network throughput).
  DB + R2 HEAD checks confirmed all 9 uploaded_private rows and timestamps,
  16,975,002 original bytes + 185,676 thumbnail bytes. Approximate effective rate
  across that session: 2.24 MiB/s. This is a desktop synthetic batch only.
- Refresh restored the participant and all 9 photos; all 9 persisted thumbnails
  decoded to width 384 and used signed R2 URLs directly. Unsigned S3 object HEAD
  returned 400 (no object access), not proof about separate r2.dev/custom domains.
- Browser widths 375/390/430: measured scrollWidth 360/375/415 respectively, no
  horizontal overflow. Selection removal, persisted grid and 44/56px targets verified.
- A deliberately undecodable `.heic` fixture displayed Preview unavailable and kept
  Upload available. It was **not uploaded**, and is not real HEIC compatibility evidence.
- Migration 0003 also applied to confirmed local `gatheroll` development DB; no drift.
- User subsequently confirmed QR participation through upload and photo retention
  after refresh on iPhone/Safari. Native HEIC behavior, phone throughput, deliberate
  failure/retry and background eviction remain unverified. Implementation commit
  8595a73 passed remote web/API CI: https://github.com/yunLeia/gatheroll/actions/runs/34072793840

### LAN troubleshooting observed during the physical check

- API preflight from localhost returned 400 after allowing only the LAN web origin;
  the same request from `http://192.168.1.185:3000` returned 200.
- Next.js dev assets requested with the LAN Origin returned 403 until the user added
  `allowedDevOrigins: ["192.168.1.185"]` to next.config.ts. HTML rendered but client
  initialization did not run, leaving Checking API and inactive create behavior.
- API CORS, R2 CORS and Next development-origin protection are separate controls.
  Keep the allowlist specific to the current trusted development host, not `*`.

## Physical iPhone/Safari acceptance (user-assisted)

- [ ] Record iPhone model, iOS/Safari version, network and date.
- [x] QR opens the phone event flow (user-reported).
- [ ] Private join → pending → host approval; Public join → immediate entry.
- [ ] Participant identity/state survives Safari refresh.
- [x] Uploaded photos remain after Safari refresh (user-reported).
- [ ] Add photos opens native picker; select 5–10 actual phone stills.
- [ ] Record the browser-provided MIME/size for HEIC/HEIF, and whether it converted.
- [ ] Previews, individual removal, scroll/input responsiveness at 375/390/430px.
- [ ] Uploads go browser→private R2, not Next/FastAPI; completion persists DB state.
- [ ] Interrupt network for one upload; successful items remain, retry only failures.
- [ ] Refresh/reopen restores confirmed private uploads; other participant and host
      cannot see them; unsigned object GET is not public.
- [ ] Record preparation time, upload elapsed/bytes, visible jank and memory symptoms.
- [ ] Background/foreground Safari during selection/upload; record actual limits.

Before the next slice: finish this evidence and any resulting fixes, then define a
small consented golden dataset and metadata-only relevance baseline. No AI now.
