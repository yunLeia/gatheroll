> Historical implementation prompt. Required starts_at/ends_at and time-order creation
> validation were superseded on 2026-09-07 by [ADR 005](../adr/005-event-boundaries-are-not-membership.md).
> New events use optional event_date; do not reimplement the obsolete contract below.

We finished the initial Gatheroll foundation.

The repository currently has:

* Next.js 16 frontend with TypeScript and Tailwind
* FastAPI backend
* typed `GET /health`
* environment-based frontend URL and CORS configuration
* backend Dockerfile
* Ruff, mypy, pytest, ESLint, TypeScript, and production build checks
* GitHub Actions CI
* initial README
* ADR 001 for Web First vs Native/App Clip

Now build the **first real end-to-end vertical slice**.

The goal is:

```text
Create Event form
→ POST /events
→ FastAPI validation
→ Postgres
→ persisted Event
→ redirect to /e/{share_token}
→ GET /events/{share_token}
→ render the persisted event
```

Do NOT implement photos, AI, R2, participants, QR codes, accounts, Redis, pgvector, or background jobs yet.

---

# 1. Add Postgres persistence

Use:

* PostgreSQL
* SQLAlchemy 2.x
* Alembic
* Pydantic

Keep the database layer explicit and easy to understand.

Do not create unnecessary repository/service abstractions yet unless there is a concrete reason.

Use environment variable:

`DATABASE_URL`

The code should work with a local PostgreSQL instance and later with a managed provider such as Neon without application-code changes.

If useful, add a minimal Docker Compose configuration for local PostgreSQL, but keep it simple.

---

# 2. Initial Event model

Create only the fields needed for the current product slice.

Suggested schema:

```text
events

id
title
starts_at
ends_at
location_name nullable
latitude nullable
longitude nullable
share_token unique
created_at
expires_at
```

Use an appropriate UUID strategy for the primary key.

Generate `share_token` server-side using a cryptographically secure random generator.

The share token is intentionally public because it identifies the guest-facing event URL.

Do NOT add the host `manage_token` yet. We will design management authorization separately when the product needs it.

Do NOT prematurely add:

* participants
* photos
* jobs
* vectors
* AI fields
* generic metadata JSON

We want to learn database migrations by evolving the schema as the product evolves.

---

# 3. Database migration

Set up Alembic properly.

Create the initial migration for `events`.

I want to be able to:

```bash
alembic upgrade head
```

and get a clean database schema from scratch.

Explain where migration configuration lives and how future schema changes should be made.

Do not use `create_all()` as a substitute for migrations in production application startup.

---

# 4. API endpoints

Implement:

```text
POST /events
GET /events/{share_token}
```

## POST /events

Input:

```json
{
  "title": "Jenny's Birthday",
  "starts_at": "...",
  "ends_at": "...",
  "location_name": "Brooklyn",
  "latitude": null,
  "longitude": null
}
```

Validate at least:

* title is not blank
* `ends_at > starts_at`
* latitude/longitude ranges if provided

The server should generate:

* id
* share_token
* created_at
* expires_at

Choose a reasonable temporary default retention period for `expires_at`, such as 30 days after the event ends, but define that policy in configuration rather than scattering a magic number through application code.

Return a typed response schema.

## GET /events/{share_token}

Return the public event information.

If the token is unknown, return a proper typed 404 response rather than a generic server error.

Do not expose database implementation details in API error messages.

---

# 5. Frontend Create Event flow

Build a simple mobile-first Create Event page.

Fields:

```text
Event name
Start date/time
End date/time
Location (optional text for now)
```

Do not add Maps/Places API/geocoding yet.

The form should:

* have clear validation
* show loading state
* handle API errors gracefully
* call FastAPI
* redirect to `/e/{share_token}` after successful creation

Keep the design minimal and aligned with Gatheroll:

* photography-first
* calm
* lots of whitespace
* near-black text
* neutral surfaces
* no film/disposable-camera styling

Do not spend significant time on visual polish yet.

---

# 6. Public event page

Create:

```text
/e/[shareToken]
```

The page should fetch the event from FastAPI and show something like:

```text
Jenny's Birthday

September 12
7:00 PM – 11:30 PM

Brooklyn
```

For now, include a placeholder area such as:

```text
Photos will appear here.
```

Do NOT implement guest participation or photos yet.

Include appropriate:

* loading state
* event-not-found state
* backend unavailable/error state

---

# 7. Tests

Add meaningful tests for the new behavior.

Backend tests should cover at least:

* valid event creation
* blank title rejected
* end before start rejected
* event can be fetched using its share token
* unknown share token returns 404
* share tokens are not trivially predictable / duplicated in normal test creation

Avoid tests that merely test framework behavior.

Frontend tests only where they provide meaningful value; do not build a large frontend testing suite yet.

All existing CI checks must remain green.

---

# 8. README

Update the README only with information that is now true.

Add:

* current implemented architecture
* current local development setup
* database/migration instructions
* first working vertical slice

Do not claim photo sharing or AI works yet.

---

# 9. Learning / explanation requirement

This is a Product Engineer portfolio project.

After implementing, explain these concepts to me specifically in the context of the code you created:

### Database

1. What SQLAlchemy is doing versus what PostgreSQL is doing.
2. What an ORM model is.
3. Why Alembic migrations exist instead of just modifying the model class.
4. What happens from `POST /events` until the row is committed to Postgres.
5. What a database transaction is in this flow.

### API

6. Difference between the Pydantic request schema, SQLAlchemy model, and Pydantic response schema.
7. Why the API generates the share token instead of the frontend.
8. Why unknown events should return 404 rather than 200 with `null`.

### Architecture

9. Trace one request end-to-end:

```text
browser
→ Next.js
→ FastAPI
→ SQLAlchemy
→ PostgreSQL
→ FastAPI
→ browser
```

10. Identify the main failure points in that request path.

Keep these explanations practical and tied to our actual files rather than giving textbook definitions.

---

# 10. Important constraints

Do not:

* implement AI
* implement photo upload
* implement guest participation
* add R2
* add authentication
* add Redis
* add pgvector
* add maps/geocoding
* create unnecessary abstraction layers

Prefer readable code over clever architecture.

Before adding a dependency, have a concrete reason for it.

Leave the repository in a clean, runnable state with CI passing.

---

At the end, report:

1. Files created/changed.
2. Database schema.
3. Migration commands.
4. How to run the complete stack locally.
5. API contract.
6. End-to-end request flow.
7. Tests added.
8. Any tradeoffs or issues discovered.
9. What I should understand from this step.
10. The next smallest vertical slice, but do NOT implement it yet.
