# Gatheroll status

Updated: 2026-09-06

## Implemented
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

## Verified
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
- Physical phone QR scanning and native mobile Safari behavior NOT verified. See
  docs/testing/002-mobile-access.md for same-Wi-Fi setup and acceptance checklist.
- Browser tool only exposes one profile, so tests used role-separated tabs, not isolated devices.
- Intermittent browser network TypeErrors occurred during development; API health/event
  requests returned 200 and retry recovered. Underlying cause not established.
- Clipboard button success shown, but tool clipboard readback was unavailable.
- No photos/uploads, AI, R2, accounts, host editing, token rotation/recovery, pagination,
  abuse/rate limits, expiry enforcement or deployment added.
- Lost localStorage loses identity; XSS can steal tokens. No POST idempotency keys.
- Legacy events with NULL manage_token_hash remain readable but unmanageable.
- Docker is still unavailable locally. Python dependencies remain version ranges.

## Next step
First finish the physical QR acceptance check. Then decide the private upload lifecycle
ADR before a bounded approved-participant → photo picker → thumbnail slice.
Do not implement that next slice without a new user request.
