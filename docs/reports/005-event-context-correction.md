# 005 — Event context product correction

2026-09-07. See [ADR 005](../adr/005-event-boundaries-are-not-membership.md) and the
[reference audit/current product model](../product/event-relevance.md).

## Implemented

- Create: name + optional calendar date/location + join policy. No exact start/end inputs.
- API: optional event_date (YYYY-MM-DD); obsolete starts_at/ends_at rejected, not silently
  ignored. Responses/header use date only when explicit, never invented legacy times.
- Migration 0004: nullable legacy timestamps, nullable DATE, removes obsolete time-order
  constraint. No old values rewritten. Downgrade refuses before writes (forward-only).
- New expiry bookkeeping anchored to creation, not optional display date. No cleanup or
  expiry enforcement added. No authorization depends on event time.
- Eval defaults to all user-selected candidates and accepts an event ID without bounds/GPS.
  Historical fixed metadata comparisons/sweep reproduction require explicit opt-in.
  No additional sweep/tuning or visual implementation performed.
- Labeling v2 uses human contextual membership. Archived brief/prompt/ADR/eval report and
  learning note retain the old hypothesis with prominent supersession notices.
- Existing photo intake remains private. No supplied sample originals were read/copied/
  labeled or added to an evaluation manifest. No user photo was deleted.

## Verification

- Local development migration: **10 events, 6 participants, 10 photo DB rows** compared
  in memory before/after. Every pre-existing field unchanged; new event_date is null.
  No object bytes accessed and no private row values printed. Alembic check: no drift.
- Dedicated gatheroll_test DB: migrations up to 0004 and no drift. **61 tests passed**,
  including 0003→0004 preservation in a disposable test-only schema, optional date/location,
  creation without times, retired input rejection, legacy readability, Public/Private
  participation/host approval, and existing private photo authorization/retry tests.
  The migration test removes only its own disposable schema afterward, not app tables.
- Backend Ruff/mypy passed; 2 pre-existing upstream test-client deprecation warnings remain.
- Web lint/typecheck, **32 tests**, default production build passed. Date display tested
  across Los Angeles/Seoul/Honolulu timezones; no date shift or invented timestamp.
- Default CLI smoke run: eval_data/candidates-v2-run, preserved synthetic fixture, only
  all_selected emitted. Historical deterministic tests retained. No real-set performance claim.
- Browser: simplified Create form visible, optional Date, no start/end. End-to-end browser
  submission not confirmed: development network origins were inconsistent. Automated API
  workflows passed; do not claim physical iPhone or full browser acceptance passed.
- Runtime diagnosis after user question: current Next parent process command was
  `next dev --hostname 0.0.0.0`, with NEXT_PUBLIC_API_BASE_URL=http://192.168.1.185:8000;
  listening on *:3000. Backend allowed Origin was http://192.168.1.185:3000. But current
  Mac en0 address was **172.16.29.99**, so the configured LAN destination was stale.
  Reading .env.local alone had not represented the shell override. No user runtime/CORS
  configuration was changed. Temporary test API on 8100 was stopped; temporary frontend
  3100 refused a second dev instance and exited; existing user server was not stopped.
- Commit/push not performed; remote CI for this combined working tree is unverified.

## Next

For phone recheck, align frontend API URL, API origin, Next allowedDevOrigins and R2
CORS with the active LAN address, then restart the appropriate processes. Network
configuration changes remain separate from this completed product correction.
Collect intentionally selected real batches, label contextually, measure all-selected,
then propose visual/context comparisons. No embeddings or review UX implemented.
