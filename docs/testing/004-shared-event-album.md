# Shared event album verification — 2026-09-08

## Automated

From `apps/api`, using the existing virtual environment:

```sh
.venv/bin/ruff check .
.venv/bin/mypy src tests
DATABASE_URL=postgresql+psycopg://gatheroll:gatheroll@localhost:5432/gatheroll_test .venv/bin/alembic upgrade head
GATHEROLL_WEB_ORIGIN=http://localhost:3000 TEST_DATABASE_URL=postgresql+psycopg://gatheroll:gatheroll@localhost:5432/gatheroll_test .venv/bin/pytest -q
```

75 tests passed, two existing upstream deprecation warnings. This is a dedicated
local test DB; never substitute a production DB. The test-origin override keeps
LAN development configuration from changing the existing CORS expectations.
Album tests cover host/uploader/different approved participant access, foreign
credentials, pending/rejected denial, unfinished/foreign/missing photo denial,
51-photo pagination across uploaders and inclusion of existing completed photos.
Storage tests inspect locally signed inline/attachment disposition and encoded
filenames without calling R2.

From repository root: `npm --prefix apps/web run lint`, `run typecheck`, `test`
(62 passed), and `run build` passed. Turbopack needed its generated cache preserved
outside the project and a rerun with permission for the build helper's local port.

## Live browser

Used a new synthetic open event, “Shared album verification,” with one test
participant and two generated JPEG files. No personal photos used.

- Host and participant empty album visible.
- Browser uploaded two originals and thumbnails directly to R2.
- Participant album refreshed automatically; host Refresh showed both photos.
- Original viewer decoded the full 1200×900 JPEG; download event received.
- Escape closed the modal; reload restored participant and both photo sections.
- Desktop layout visually inspected with no horizontal overflow.

A 390px viewport override did not apply in this browser session (DOM still
reported 1280px); no mobile-size claim. Browser roles were separate tabs in one
profile. The synthetic event and two originals/two thumbnails remain in the
development environment. Backend tests, not this browser run, verify access by a
second participant and rejection of unauthorized readers.

## Physical-device follow-up

On two devices, join the same event; approve the guest if the event is private.
Upload on one device and use album Refresh on the other. Open and download a JPEG
and a real HEIC. Confirm that pending/rejected guests cannot browse the album.
Check 390px layout, slow-network errors, retry, image format fallback and download
behavior in Safari. No ZIP or automatic exclusion is expected in this slice.
