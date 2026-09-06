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

Gatheroll's event detection will be **precision-first**: a false positive can
expose a private photo, while a false negative is inconvenient but recoverable.
The system recommends; the person sharing has final control.

## Current status

The repository implements event creation, host management, QR invitations and
no-account participant approval. Photo sharing is not implemented:

- a mobile-first Next.js frontend
- a FastAPI backend with `GET /health`
- `POST /events` and `GET /events/{share_token}` backed by PostgreSQL
- a Create Event form at `/events/new` and public page at `/e/{share_token}`
- a host page at `/manage/{share_token}`, local QR rendering and copy invite link
- Private (approval required, default) / Public (instant join) policies; both unlisted
- participant pending/approved/rejected states and browser restoration
- two Alembic migrations and PostgreSQL authorization tests
- backend Docker support
- lint, type-check, test, and CI foundations
- architectural decision records written as decisions are made

Host and participant authentication use secret capabilities, without accounts.
No AI, photo upload, object storage, account login or image processing is implemented.

## Architecture

Implemented locally: browser → FastAPI → SQLAlchemy/psycopg → PostgreSQL.
Next.js serves the UI; browser JavaScript calls FastAPI directly. The hosting
targets and object storage below are planned, not deployed.

```text
Mobile browser (Next.js on Vercel)
            │
            │ HTTPS JSON API
            ▼
FastAPI service (Railway)
      │              │
      ▼              ▼
Postgres (Neon)   Private objects (Cloudflare R2)
```

The browser will eventually upload photo bytes directly to private R2 storage
using short-lived presigned URLs. FastAPI will authorize operations and store
metadata; Postgres may gain `pgvector` only when the embedding model and query
needs are known. These are planned directions, not current dependencies.

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

Frontend route files compose `features/events` and `features/participants`.
`lib/api.ts` centralizes requests, `lib/credentials.ts` isolates browser persistence,
and `lib/use-polling.ts` owns the small polling loop. Backend `schemas.py` describes
contracts, `domain.py` contains policy/status enums, and `security.py` provides
event-scoped authorization dependencies reused by event/participant routes.

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

`POST /events` accepts title (1–200 nonblank characters), timezone-aware starts_at
and ends_at (end must be later), optional location_name (300 characters), and
optional latitude [-90, 90] / longitude [-180, 180], and join_policy (`open` or
`approval_required`, default). It now returns 201 `{ event: EventResponse,
manage_token: string }`. The credential is returned once, separate from public data.
`GET /events/{share_token}` returns only EventResponse or
404 `{ "code": "event_not_found", "message": "This event could not be found." }`.
Validation errors return 422; database errors return a generic 503.

The `events` table has id (UUID primary key), title, starts_at, ends_at,
nullable location_name/latitude/longitude, unique share_token, created_at,
expires_at, join_policy, and nullable manage_token_hash. Timestamps use PostgreSQL timestamptz; token uniqueness also supplies
the lookup index. `GATHEROLL_RETENTION_DAYS` defaults to 30 after the event ends.
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

## Intentionally not built yet

Redis, background workers, pgvector, a separate vector database, native apps,
accounts, facial recognition, and multimodal LLM analysis are outside this
foundation. Each should enter the architecture only when a product need or
measurement justifies it.

## Next vertical slice

After the real-phone joining check, design the private upload lifecycle ADR,
then implement approved-participant authorization → explicit photo selection →
client thumbnail in one bounded slice. Storage/upload follows the documented
privacy and mobile-resume decision. No photo work is included in the current slice.
