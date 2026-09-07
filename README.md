# Gatheroll

**A shared album that fills itself.**

Gatheroll is a mobile-first shared photo album that explores whether event
context and visual similarity can reduce post-event photo sharing to a QR scan,
one broad photo selection, and a privacy-aware confirmation step.

This repository is being built as a production-minded Product Engineer / AI
Product Engineer portfolio project. It is intentionally incremental: first make
the shared album useful and reliable, then prove whether AI improves it.

## The problem

After a group event, photos are scattered across individual camera rolls and
chat threads. Sharing usually requires repeated coordination:

```text
hang out
→ everyone takes photos
→ "send me the pics"
→ everyone manually selects photos
→ photos arrive through different apps—or never arrive
```

The problem is not primarily how to curate one perfect memory. It is how to
remove the work of gathering everyone's photos without accidentally sharing
private or unrelated images.

## Product hypothesis

```text
Host creates an event
→ friends join from a QR code without an account
→ each person selects everything from around the event
→ Gatheroll recommends what belongs
→ uncertain photos require review
→ approved originals appear in one shared album
```

Participants' explicit broad selection is the first relevance filter. Hosts do not
need precise event boundaries: name, optional date/location, and join policy suffice.
Future relevance is primarily visual/contextual; time/GPS are weak supporting metadata,
not ground truth or membership gates. See the [current product model](docs/product/event-relevance.md).

Gatheroll's event detection will be **precision-first**: a false positive can
expose a private photo, while a false negative is inconvenient but recoverable.
The system recommends; the person sharing has final control.

## Current status

The repository implements event creation, host management, QR invitations,
no-account participant approval, and private photo intake. Photo sharing and AI
are not implemented:

- a mobile-first Next.js frontend
- a FastAPI backend with `GET /health`
- `POST /events` and `GET /events/{share_token}` backed by PostgreSQL
- a Create Event form at `/events/new` and public page at `/e/{share_token}`
- a host page at `/manage/{share_token}`, local QR rendering and copy invite link
- Private (approval required, default) / Public (instant join) policies; both unlisted
- participant pending/approved/rejected states and browser restoration
- approved participant multi-photo picker, previews and bounded direct-to-R2 uploads
- private own-photo listing, partial failure/retry, and refresh of confirmed uploads
- four Alembic migrations and PostgreSQL authorization/state tests
- backend Docker support
- lint, type-check, test, and CI foundations
- architectural decision records written as decisions are made

Host and participant authentication use secret capabilities, without accounts.
No AI, shared album, host access to participant photos, or account login is implemented.
Originals and thumbnails are private objects, not automatically shared photos.

## Evaluation

Evaluation harness implemented; golden dataset collection in progress.
The default offline baseline is **all user-selected candidates**; exact event times
are not required. JSON/CSV metrics and per-photo error reports are available. Earlier
time/time+GPS experiments and their 20 synthetic examples remain opt-in historical
comparisons of a rejected primary product assumption, not current architecture or
real-photo performance claims. No further time-threshold tuning is planned.
Production still does **not** classify, share, hide or delete photos automatically.
See the [evaluation guide](eval/README.md), [labeling rules](docs/eval/event-relevance-labeling.md)
and [baseline report](docs/reports/004-metadata-baseline.md).

## Architecture

Next.js serves the UI; browser JavaScript calls FastAPI directly for JSON and private
R2 directly for image bytes. Vercel/Railway/Neon remain hosting targets, not claimed
deployments. Configure a real private R2 development bucket as described below.

```text
Mobile browser (Next.js UI)
      ├── JSON / authorization ──→ FastAPI ──→ PostgreSQL
      │                              │
      │←── short-lived PUT URLs ──────┘
      └── original / thumbnail bytes ─────────→ Private R2
                                     FastAPI ── HEAD ──→ R2
```

Neither Next.js nor FastAPI proxies photo bytes. FastAPI verifies the participant,
creates photo records, signs uploads, and checks R2 metadata before confirming
`uploaded_private`. Own previews use short-lived signed GETs, not public URLs.
No embeddings, image analysis, shared grid or background processing is present.

## Repository structure

```text
apps/
├── web/                 # Next.js, TypeScript, React, Tailwind CSS
└── api/                 # FastAPI, Pydantic, pytest, Docker
docs/
└── adr/                 # Architectural decision records
.github/workflows/       # Continuous integration
```

Read [current state](docs/STATUS.md), [working agreement](AGENTS.md),
[original product brief](docs/product/original-brief.md),
[Codex setup](docs/codex-workflow.md), [foundation learning notes](docs/learning/001-foundation-and-events.md),
and [access/approval learning notes](docs/learning/002-event-access.md).
See [private intake learning notes](docs/learning/003-private-photo-intake.md) for
File/Blob, object storage, direct PUT, authorization and retry explanations.

Frontend route files compose `features/events` and `features/participants`.
`lib/api.ts` centralizes requests, `lib/credentials.ts` isolates browser persistence,
and `lib/use-polling.ts` owns the small polling loop. Backend `schemas.py` describes
contracts, `domain.py` contains policy/status enums, and `security.py` provides
event-scoped authorization dependencies reused by event/participant routes.
`features/photos/` separates selection validation, EXIF/thumbnail preparation,
upload orchestration, photo API contracts and the intake panel. Backend `photos.py`
owns photo transitions, `photo_schemas.py` the contracts and `storage.py` concrete
R2 signing/HEAD. No generalized storage/repository framework is included.

The apps own their dependencies. No monorepo orchestrator is included because
two small applications do not yet justify one.

## Run locally

### Frontend

Requires Node.js 20.9+.

```bash
cd apps/web
cp .env.example .env.local
npm ci
npm run dev
```

Open <http://localhost:3000>.
Copy example environment files only on first setup; preserve existing local values.

### Backend

Requires Python 3.11+.

Start PostgreSQL first (Docker option, from repository root):

```bash
docker compose up -d db
```

Alternatively use Homebrew PostgreSQL 17. This machine has it installed, running
manually, and the `gatheroll` and `gatheroll_test` databases created. To restart:

```bash
/opt/homebrew/opt/postgresql@17/bin/pg_ctl -D /opt/homebrew/var/postgresql@17 -l /opt/homebrew/var/postgresql@17/server.log start
```

Use only one local PostgreSQL server on port 5432. The example credentials are
local development credentials, never production credentials.

```bash
cd apps/api
python3 -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
cp .env.example .env
alembic upgrade head
uvicorn gatheroll_api.main:app --reload
```

Open <http://localhost:8000/health> for the health check or
<http://localhost:8000/docs> for FastAPI's generated API documentation.

The frontend reads `NEXT_PUBLIC_API_BASE_URL` and requests `GET /health` from
the browser. The API allows the configured `GATHEROLL_WEB_ORIGIN` through CORS;
both example files use the local ports above.

### Backend with Docker

```bash
docker build -t gatheroll-api apps/api
docker run --rm -p 8000:8000 --env-file apps/api/.env gatheroll-api
```

For a Dockerized API use a DATABASE_URL whose host is reachable from the container
(for example `host.docker.internal` on macOS). Apply migrations with the same
environment using `docker run --rm --env-file apps/api/.env gatheroll-api alembic upgrade head`.
Docker execution has not been verified on this machine; Docker is not installed.

### Quality checks

```bash
npm --prefix apps/web run lint
npm --prefix apps/web run typecheck
npm --prefix apps/web test
npm --prefix apps/web run build

cd apps/api
ruff check .
mypy src tests
DATABASE_URL=postgresql+psycopg://gatheroll:gatheroll@localhost:5432/gatheroll_test alembic upgrade head
TEST_DATABASE_URL=postgresql+psycopg://gatheroll:gatheroll@localhost:5432/gatheroll_test pytest
```

Create a dedicated `gatheroll_test` database before running these commands. Tests
roll back their own transactions; never point TEST_DATABASE_URL at production.
For Compose: `docker compose exec db createdb -U gatheroll gatheroll_test`.
CI provisions its own PostgreSQL database and applies migrations before tests.

## Event API and schema

`POST /events` accepts title (1–200 nonblank characters), optional event_date
(calendar date YYYY-MM-DD), optional location_name (300 characters), and
optional latitude [-90, 90] / longitude [-180, 180], and join_policy (`open` or
`approval_required`, default). It now returns 201 `{ event: EventResponse,
manage_token: string }`. The credential is returned once, separate from public data.
`GET /events/{share_token}` returns only EventResponse or
404 `{ "code": "event_not_found", "message": "This event could not be found." }`.
Validation errors return 422; database errors return a generic 503.
The obsolete starts_at/ends_at creation fields now return 422 and are absent from
public/managed responses. Deploy updated frontend/API together.

The `events` table has id (UUID primary key), title, nullable event_date,
nullable legacy starts_at/ends_at (storage only, not current product requirements),
nullable location_name/latitude/longitude, unique share_token, created_at,
expires_at, join_policy, and nullable manage_token_hash. Timestamps use PostgreSQL timestamptz; token uniqueness also supplies
the lookup index. `GATHEROLL_RETENTION_DAYS` defaults to 30 after creation for new events.
Migration 0004 preserves all old values and does not invent dates from legacy instants.
It is forward-only to avoid fabricating times on downgrade; see [ADR 005](docs/adr/005-event-boundaries-are-not-membership.md).
Expiry enforcement/deletion is not implemented yet. Migration 0002 preserves old
events and defaults them to Private. Their manage_token_hash stays NULL because no
host credential was issued in slice 1. They remain readable but cannot be managed;
create a new event to use host/approval flows. No anonymous claim/recovery endpoint exists.

`participants`: UUID id, event_id foreign key (indexed), display_name (1–80 trimmed
characters; not unique), status, unique participant_token_hash, joined_at,
nullable approved_at. DB CHECKs enforce valid states and timestamp consistency.

## Roles and access contracts

The host creates the event, receives a host credential, displays the invite QR and
approves/rejects requests. Hosts are not automatically participants. Participants
provide only a display name and receive a separate event-scoped credential.

| Method / path | Authorization | Result |
| --- | --- | --- |
| POST /events | None | 201 `{event, manage_token}` |
| GET /events/{share} | Invite token in path | Public event metadata only |
| GET /events/{share}/manage | Host Bearer token | Event metadata for host screen |
| POST /events/{share}/participants | Invite token in path | 201 `{participant, participant_token}` |
| GET /events/{share}/participants/me | Participant Bearer token | Own current state only |
| GET /events/{share}/participants | Host Bearer token | Participant list, no credentials/hashes |
| PATCH /events/{share}/participants/{id} | Host Bearer token | `{status: "approved" or "rejected"}` decision |

Missing/malformed credentials return 401, wrong role/event credentials return 403,
unknown resources return 404, conflicting final decisions return 409. Validation
returns 422. No client-supplied approval field is accepted at join time.
Join input is `{ "display_name": "Leia" }`; the server derives status from the
event policy. Normal participant responses contain id, display_name, status,
joined_at and approved_at only.

```text
Private: join → pending ─┬→ approved (approved_at set)
                        └→ rejected (approved_at null)
Public:  join ────────────→ approved
```

Repeating the same decision is safe and preserves approved_at. Opposite decisions
cannot reverse a final state. The API locks the participant row during decisions.
Host lists and pending participants poll every 5 seconds after request completion,
pause in hidden tabs, and abort on unmount. Approved/rejected participant polling stops.

## Token handling and limitations

All tokens use 32 random bytes. Share tokens intentionally identify unlisted invite
pages; they never authorize management. Host and participant secrets are stored
only as SHA-256 hashes on the server and sent as Bearer headers. Public GETs never
return raw credentials or hashes. Responses use no-store and pages use no-referrer/noindex.
Noindex is not access control. Invite metadata is visible before joining.

The creator saves the host token locally and navigates to a clean management URL.
A saved private management link includes a `#token=...` fragment (not sent in HTTP
requests), which is removed on opening and synchronized with the Next.js router.
The QR always encodes `/e/{share}` and is generated locally by `qrcode.react` (no
external QR service). Save the private host link securely; never send it to guests.

Browser restoration uses role/event-scoped localStorage, isolated in one module.
Same-origin XSS can steal these tokens. Lost storage means lost identity; no account
recovery/rotation is implemented. If storage is blocked, memory keeps the current
tab usable and the UI warns that refresh may lose access. HTTP-only sessions may
replace this later with an appropriate deployment/CSRF design.

Creation/join have no idempotency keys yet: a lost response followed by retry may
create duplicates. Rate limiting, expiration enforcement, participant pagination
and token revocation are not implemented. Use HTTPS before hosting outside local
development and keep authorization headers, response credentials and fragments
out of analytics/error logs. This is not yet a publicly deployed production album.

## Mobile verification

See [mobile test record and real-phone checklist](docs/testing/002-mobile-access.md).
375/390/430px browser checks and role flows are recorded separately from physical
phone scanning. A QR with localhost cannot open this computer from another phone.
Photo setup, exact limits, API contracts, synthetic measurements and pending
iPhone/Safari tests: [private intake verification](docs/testing/003-private-photo-intake.md).

## Private photo intake

This slice's [completion summary and diagnostic log guide](docs/reports/003-private-photo-intake.md)
records implementation, tests, physical-device evidence and remaining limitations.

```text
Approved participant → Add photos → explicit system selection → previews
→ Upload privately → batch authorization → browser PUTs to private R2
→ HEAD-verified completion → uploaded_private → refresh own uploads
```

The picker does not scan the whole camera roll. Selection does not start upload;
the participant explicitly confirms **Upload privately**. Originals may include
unrelated images and EXIF/location data. Uploaded is not shared: neither other
participants nor the host can list these private photos. Sharing needs a later
explicit user-confirmed workflow.

Configure `apps/api/.env` using the separate `.env.example`, install updated API
dependencies and apply migration 0003. Use private `gatheroll-dev` R2 credentials;
never put secrets in `NEXT_PUBLIC_*`. Keep public access disabled and configure
bucket CORS for the actual browser origin. Restart the API after changing `.env`.
The [setup guide](docs/testing/003-private-photo-intake.md#real-r2-development-setup-one-provider)
contains the exact settings and CORS example. Without storage configuration the API
returns 503, not a fake success. Normal automated tests do not use real R2.

`photos`: server UUID id, event/participant FKs, unique participant+client_id retry
identity, status, original_key, nullable thumbnail_key/thumbnail_size_bytes,
original_filename, content_type, file_size_bytes, nullable captured_at/GPS/dimensions,
created_at, nullable uploaded_at. Only `pending_upload → uploaded_private` exists;
the DB enforces timestamp consistency. No AI fields. FKs prevent parent removal
before an explicit future object cleanup workflow.

Defaults: 50 photos/batch, 25 MiB/original, 256 KiB/thumbnail, 500 records/participant.
The server enforces limits; the UI reads them. JPEG/PNG/WebP/HEIC/HEIF originals are
accepted. Three concurrent file jobs, sequential thumbnail preparation, 384px JPEG
long side. Unsupported decoding gets a fallback; HEIC rendering is not universally
promised. Captured time requires EXIF time plus explicit offset; GPS/dimensions are
nullable and untrusted. Missing metadata is not a negative relevance signal.

All `/events/{share}/photos` endpoints require an approved participant token:
`GET /limits`, `POST /uploads` (batch metadata → signed targets),
`POST /{photo_id}/complete` (verified idempotent completion), and `GET /?offset=0`
(own confirmed photos, 50/page with signed thumbnails). No host photo endpoint.
See [full contracts and failure behavior](docs/testing/003-private-photo-intake.md#api-contracts).

Retry keeps stable client IDs and skips successful PUT steps/files in the live tab.
Completed records survive refresh, unfinished selections do not. This is not
multipart or cross-refresh byte resumption. PUT URLs are reusable for 15 minutes;
GETs expire after 5. MIME/size/HEAD checks do not establish content integrity or
immutability. **No automatic photo retention deletion is implemented**: dev objects
remain until manual cleanup. Quotas are not sufficient public-launch abuse controls.

To evolve schema: change the ORM model, run `alembic revision --autogenerate -m
"describe change"`, review the migration, then `alembic upgrade head` and tests.
`alembic check` detects differences between model metadata and the migrated DB.

GitHub Actions runs the same checks for pushes to `main` and pull requests.

## Project principles

- Ship the smallest useful vertical slice and keep it deployable.
- Use deterministic, inexpensive mechanisms before more complex AI.
- Treat photos as sensitive data and make sharing an explicit user decision.
- Establish simple baselines and a labeled dataset before tuning models.
- Measure privacy-relevant quality: precision, recall, false-positive rate, and
  review rate.
- Keep scoring and model versions explainable and reproducible.
- Add infrastructure only when observed scale or reliability requires it.
- Record measured results; never fabricate portfolio metrics.

## Architectural decisions

- [ADR 001: Use the web as Gatheroll's universal participation layer](docs/adr/001-web-first.md)
- [ADR 002: Event persistence](docs/adr/002-event-persistence.md)
- [ADR 003: Event access and no-account authorization](docs/adr/003-event-access-and-no-account-authorization.md)
- [ADR 004: Private photo intake lifecycle](docs/adr/004-private-photo-intake-lifecycle.md)

## Intentionally not built yet

Redis, background workers, pgvector, a separate vector database, native apps,
accounts, facial recognition, and multimodal LLM analysis are outside this
foundation. Each should enter the architecture only when a product need or
measurement justifies it.

## Next vertical slice

The core iPhone/Safari QR + upload + refresh flow is user-confirmed. Finish remaining
device edge-case checks and remote CI, and address any measured issues.
Then establish a small consented golden dataset, labeling rules and a metadata-only
event-relevance baseline. Do not add sophisticated AI or a shared album yet.
