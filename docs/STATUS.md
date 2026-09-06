# Gatheroll status

Updated: 2026-09-06

## Implemented
- Next.js create form `/events/new` → FastAPI POST → PostgreSQL commit → `/e/token` GET.
- One events table, SQLAlchemy 2, psycopg 3, Alembic 0001; no create_all at startup.
- Timezone-aware validation, secure random share token, typed 404, generic DB 503.
- Loading/error/retry views, configurable 30-day expires_at (no cleanup yet).
- Original product brief and accepted slice prompt preserved in docs/product and docs/prompts.
- AGENTS.md, Codex workflow notes and Korean learning notes provide persistent context.
- Global Codex context_management.experimental_mode enabled and CLI accepted it.

## Validation
- PostgreSQL 17 installed locally, manual server on port 5432.
- Separate gatheroll and gatheroll_test databases; initial migration applied to both.
- PostgreSQL API suite: 11 passed; two upstream TestClient deprecation warnings.
- Alembic check: no model/schema drift.
- Web lint/typecheck and backend Ruff/mypy passed.
- Production Next.js build passed; browser form submission → public event page → reload passed.
- A synthetic “Gatheroll local smoke test” event remains in the local development DB.
- GitHub CI / final build result: see latest run and final handoff; do not assume success.

## Limits / follow-up
- No photos, participants, QR, auth, manage token, AI, R2 or deployment yet.
- Public creation is suitable for local development; rate limits/abuse controls needed before public launch.
- Share URLs grant read access to anyone holding them; tokens should not be published in logs.
- No idempotency on POST; response loss followed by manual retry can duplicate events.
- Event timezone is not stored separately; UI uses viewer-local time.
- Docker/Compose not executed locally because Docker is unavailable.
- Python dependencies have version ranges, not a fully reproducible transitive lock yet.

## Next proposed slice (requires a new request)
Design guest identity/authorization, then display-name join and returning-browser recognition.
Keep uploads and AI separate. Preserve the original brief’s precision-first privacy principle.
