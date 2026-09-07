# ADR 002: Persist the first event slice in PostgreSQL

Status: Accepted — 2026-09-06

Partially superseded 2026-09-07 by [ADR 005](005-event-boundaries-are-not-membership.md):
required exact times, viewer-local event-time display and ends_at-anchored expiry are
historical. SQL persistence/capability principles remain; new events use optional date
and creation-anchored expiry bookkeeping. Original reasoning below is preserved.

## Context
An event URL must survive API restarts. The first slice needs one table and
simple create/read operations, plus a schema history that can be learned and reviewed.

## Decision
Use PostgreSQL 17, SQLAlchemy 2 synchronous sessions, psycopg 3, and Alembic.
Routes directly use request-scoped sessions. Alembic owns schema creation;
application startup never calls create_all. A commit finishes each creation.
Use UUIDv4 IDs, unique 256-bit random share tokens, timezone-aware timestamps,
and a configurable 30-day expiry after ends_at. No management capability yet.
The unique token constraint supplies its lookup index; no additional indexes yet.

## Alternatives considered
- In-memory storage loses events on restart and would need replacement immediately.
- SQLite is simpler locally but does not exercise the target PostgreSQL behavior.
- Raw SQL works but SQLAlchemy provides explicit typed row mapping and sessions.
- Async sessions add complexity without measured concurrency needs here.

## Consequences
A DB process is needed for development/tests. DB tests use PostgreSQL and an outer
transaction rolled back per test. Migrations must be applied before starting API
traffic. expires_at records policy only: enforcement and cleanup are future work.
Anyone with a share URL can read the event; it is unlisted, not authenticated.
Creation has no idempotency key yet: a retry after an ambiguous network failure
can duplicate an event. No automatic POST retry is used.
UTC instants preserve ordering; the UI displays viewer-local time, not a stored
event timezone. A named event timezone can be added in a later migration.
