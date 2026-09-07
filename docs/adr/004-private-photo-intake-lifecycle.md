# ADR 004 — Private photo intake before review

Date: 2026-09-06
Status: Accepted; core iPhone/Safari upload/refresh flow user-confirmed. Physical
edge-case and performance evidence remains outstanding (see testing/003).

## Context

Gatheroll will eventually recommend which explicitly selected photos belong to an
event, and the contributor will confirm sharing. A mobile page can refresh or be
evicted before a long review completes. Browser File references do not give us a
durable original, nor permission to inspect the rest of a camera roll.

The user prefers Option B: upload originals privately before analysis. This creates
a real privacy tradeoff: unrelated originals and embedded EXIF may reach storage.
The current upload action states this. It does not say that an AI exists.

## Decision

After explicit selection and the **Upload privately** action, an approved
participant sends originals and any generated JPEG thumbnails directly to a
private Cloudflare R2 development bucket. Selection alone does not start network
upload. A small concrete `storage.py` handles S3-compatible signing and HEAD.
No MinIO, generalized provider interface, image proxy, worker, or scheduler.

```text
Mobile browser ── JSON + participant Bearer ──→ FastAPI ──→ PostgreSQL
      │                                      │
      │←──────── short-lived PUT URLs ────────┘
      └──────── original / thumbnail bytes ──────────────→ Private R2
      │                                      │
      └──────── complete photo ──────────────→│── HEAD metadata ──→ R2
```

**Stored privately is not shared with event participants.** The only states are
`pending_upload` and `uploaded_private`. `uploaded_private` requires uploaded_at;
pending requires NULL. Failed attempts remain pending in PostgreSQL and failed
in the browser. A network failure is not an AI rejection or final photo decision.
No shared state, album endpoint, host photo access, or scoring fields exist.

Originals use `events/{event_uuid}/photos/{server_photo_uuid}/original`; thumbnails
use the same prefix with `/thumb`. Names and GPS never enter keys. DB records have
both event and participant FKs. Deletion is NO ACTION rather than cascading DB
rows and silently orphaning bytes. A future deletion workflow must delete R2
objects and then DB rows, with retries, before removing the parents.

Each file has a browser-generated client UUID, unique per participant in the DB.
The initialization route locks the participant, reuses existing matching records,
and rejects altered metadata for the same UUID. This tolerates a lost init response
within the live selection. It is not file-content deduplication or durable
resumption after the browser loses Files. Completion locks the photo and checks
ownership plus HEAD size/content type for original and declared thumbnail. Repeated
completion returns the existing state/timestamp. No storage body is downloaded.

PUT authorization lasts 15 minutes, GET preview authorization 5 minutes by default.
PUT signs key, MIME and exact Content-Length; browser Blob requests supply the
length. The list endpoint returns only the caller's confirmed records, with signed
thumbnail GETs. It never supplies a public URL or original GET in this slice.
Native `<img>` bypasses Next image optimization. An unavailable decoder gets a
fallback card and can still upload the original.

## Alternatives

- Browser-only originals until review: minimizes cloud exposure before relevance
  decisions, but refresh/eviction loses Files and future processing cannot resume.
- Proxy through FastAPI or Next.js: simpler CORS but doubles image transport through
  app infrastructure and adds memory/timeouts/hosting bandwidth pressure.
- Public uploads: rejected; selection does not authorize disclosure to others.
- Local S3 emulator: deferred; real R2 is the one current provider. Unit/API tests
  replace our storage boundary and do not require real credentials.

## Consequences and limits

- Completed intake survives refresh using the participant token + DB list. Originals
  and selected thumbnails are not persisted in localStorage/IndexedDB. Incomplete
  Files must be reselected after refresh; stale pending records can remain.
- Three simultaneous file jobs limit mobile socket/memory pressure. One image is
  decoded at a time for 384px JPEG thumbnails. No Worker/OffscreenCanvas without
  measured physical-device jank. 40MP EXIF/dimension guard skips large previews,
  but unknown dimensions may still allocate a decoder before they are discovered.
- 50 files/batch, 25 MiB/original, 256 KiB/thumbnail, 500 records/participant are
  configurable demo safeguards, not a complete abuse/rate-limiting system.
- MIME/length validation does not prove image content. HEIC is stored without a
  server decoder. EXIF/GPS are untrusted claims; missing GPS is absence of evidence,
  not evidence against the event. Camera timestamps lacking an explicit offset
  remain NULL rather than guessing the phone/browser timezone.
- Presigned URLs are bearer capabilities and reusable until expiry. A leaked PUT
  can overwrite its exact key with matching-length/type data during that window;
  HEAD completion does not make content immutable. Before any later AI/scoring
  trusts bytes, add a checksum/immutable-finalization design. This slice does not
  claim byte-integrity validation or one-time URLs.
- Short-lived GETs can be shared by their owner until expiry. CORS is not auth.
  Bucket privacy and keeping signed URLs out of logs/analytics remain mandatory.
- Storage costs begin before any relevance decision. There is **no automatic
  retention deletion yet**. `GATHEROLL_RETENTION_DAYS` is existing event metadata,
  not a photo deletion timer. Development objects persist until manual cleanup.
  Stale pending >24h and confirmed intake retention must be reviewed by an operator;
  see the setup/test document. No promises of automatic seven-day deletion.
- Anonymous open-event participation still permits storage abuse; the per-identity
  quota is not sufficient for an unrestricted public launch. No production launch
  or infrastructure provisioning is included.

## References

- [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- [R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/)
- [S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/)
- Implementation: `photos.py`, `photo_schemas.py`, `storage.py`, `models.py`,
  `features/photos/{prepare,selection,upload,intake-panel}.ts(x)`.
