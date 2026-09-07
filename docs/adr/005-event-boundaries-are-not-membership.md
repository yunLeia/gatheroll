# ADR 005: Host-defined event boundaries are not required for relevance

Accepted: 2026-09-07. Supersedes the exact-time requirement/expiry anchor in ADR 002
and the primary time/location relevance hypothesis in experiment 004.

## Why the earlier assumption changed

Initially the host supplied starts_at/ends_at and we explored metadata-based membership.
But participants already intentionally broad-select candidate photos from their own
camera rolls. Social gatherings have fuzzy boundaries: setup before dinner or time
after leaving can belong, while a simultaneous screenshot/private selfie may not.
Time match != membership; time mismatch != non-membership. This is a product-model
correction, not a claim that the synthetic experiment measured real-world AI benefit.

## Decision and contracts

- Host: event name, optional calendar date, optional location, Public/Private join policy.
  Date is display context, never an authorization or relevance gate.
- Current POST/GET schemas expose nullable `event_date` (YYYY-MM-DD), not starts_at/ends_at.
  POST rejects retired fields with 422 (existing extra=forbid). No supported external
  legacy client contract requires keeping them; deploy frontend/API together.
- Migration 0004 adds nullable SQL DATE, makes existing timestamp columns nullable,
  removes event_time_order. Original timestamps, credentials, participants, photos and
  expiry values stay unchanged. No backfill from timestamptz: the host's original
  timezone/calendar intent is unavailable. Existing event dates remain null.
- Legacy timestamp columns are storage-only historical context, absent from current UI/API.
  Do not drop old migration 0001 or rewrite recorded history. 0004 is forward-only:
  downgrading would invent missing times or discard newly entered dates; it raises
  before writes. Rollback requires a reviewed backup or forward corrective migration.
- New expires_at bookkeeping is created_at + configured retention_days (default 30),
  independent of optional event date. Existing expires_at untouched. No expiration
  enforcement/automatic deletion exists; this is not a promised retention cleanup service.
- Future relevance is primarily visual/contextual, starting with participant selection.
  Capture time/GPS are weak supporting context, not ground truth or gates. No AI added now.
- Current eval default is all user-selected candidates. Event ID alone is sufficient.
  Time/GPS comparisons remain explicit `--historical-metadata` experiments; their
  deterministic fixtures/results are preserved. No additional threshold tuning performed.

All-selected means a counterfactual no-filter relevance recommendation. It does NOT
change uploaded_private into shared: any eventual sharing still requires confirmation.

## Consequences

Less host friction, a more realistic gathering model, fewer incorrect time-based
exclusions and simpler onboarding. In exchange, a strong deterministic shortcut is
lost, visual/context relevance is harder and privacy/review design matters more.
Visual similarity does not prove event membership either. It remains an unvalidated
hypothesis until intentionally selected real batches are contextually labeled.

Migration verification uses a disposable schema of the dedicated PostgreSQL test DB:
0003 seed event/participant/private-photo rows → 0004 → exact retained-value comparison
and a new date-only event. The local development DB is compared before/after separately.

Current product framing and reference audit: [product note](../product/event-relevance.md).
