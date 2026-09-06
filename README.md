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

The repository currently implements event creation and persistent public event
pages, not a working shared photo album:

- a mobile-first Next.js frontend
- a FastAPI backend with `GET /health`
- `POST /events` and `GET /events/{share_token}` backed by PostgreSQL
- a Create Event form at `/events/new` and public page at `/e/{share_token}`
- an Alembic migration for the events table and PostgreSQL integration tests
- backend Docker support
- lint, type-check, test, and CI foundations
- architectural decision records written as decisions are made

No AI, authentication, object storage, or image processing has been
implemented yet.

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
[Codex setup](docs/codex-workflow.md), and [learning notes](docs/learning/001-foundation-and-events.md).

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
optional latitude [-90, 90] / longitude [-180, 180]. It returns 201 with all public
event fields, including server-generated UUIDv4 id, random share_token,
created_at, and expires_at. `GET /events/{share_token}` returns the same shape or
404 `{ "code": "event_not_found", "message": "This event could not be found." }`.
Validation errors return 422; database errors return a generic 503.

The single `events` table has id (UUID primary key), title, starts_at, ends_at,
nullable location_name/latitude/longitude, unique share_token, created_at,
expires_at. Timestamps use PostgreSQL timestamptz; token uniqueness also supplies
the lookup index. `GATHEROLL_RETENTION_DAYS` defaults to 30 after the event ends.
Expiry enforcement/deletion is not implemented yet. The share URL permits viewing;
there are no host management permissions in this slice.

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

## Intentionally not built yet

Redis, background workers, pgvector, a separate vector database, native apps,
accounts, facial recognition, and multimodal LLM analysis are outside this
foundation. Each should enter the architecture only when a product need or
measurement justifies it.

## Next vertical slice

Guest join by display name and returning-browser identity, with an explicit
authorization design first. It is not implemented yet. Photo upload follows in
a separate slice after the private upload lifecycle ADR is decided.
