# ADR 003: Unlisted events, join policies and no-account capabilities

Status: Accepted — 2026-09-06

## Context
QR participation needs little friction, while future albums contain sensitive photos.
The current architecture is browser JavaScript calling a separate FastAPI origin.
ADR 002 already describes persistence; this decision is numbered 003 to preserve it.

## Decision
- Events are unlisted. UI Public means `open`; Private means `approval_required` (default).
- Generate separate 32-byte random share, host and participant tokens using secrets.
  Share tokens identify the invite page; SHA-256 hashes verify the secret tokens in DB.
- Creation responses separately return a raw credential once, never public GET responses.
- Creation stores the host token before navigating to a clean management path.
  Saved host links use `/manage/{share_token}#token=...`. On opening, isolate the token,
  store it, remove the fragment from the address bar and Next.js router state,
  and send it only in a Bearer header.
  Invite QR/copy always uses `/e/{share_token}` and never a host credential.
- Event-scoped localStorage keys restore host and participant browsers. One small storage
  module owns this choice; an in-memory fallback warns if persistence is unavailable.
- Backend dependencies verify event-bound host/participant capabilities. Participant
  identity does not imply approved access. No photo endpoints exist in this slice.
- pending can become approved or rejected; final decisions cannot be reversed yet.
  Same-decision retries are idempotent; conflicting decisions return 409. Row locks
  serialize concurrent decisions and a DB check ties approved_at to approved status.
- Poll every 5 seconds while relevant/visible, serialize requests and abort on unmount.
  Participant polling stops after a final state. No push infrastructure is needed yet.
- Migration preserves old events with Private policy and NULL host hash: they have no
  management credential. No anonymous reclaim endpoint or invented host is introduced.

## Alternatives
Mandatory accounts add joining friction. Automatically granting everyone QR access
removes host choice. `is_public` obscures joining behavior. A full auth/BFF framework
would expand this slice; HTTP-only cookies with a same-site deployment are a future option.

## Consequences
No account is needed and authorization is enforced at the API. Duplicate display names
are valid; they are not verified identities. A stolen token grants that role. SHA-256 is
appropriate for high-entropy random tokens, unlike guessable human passwords.
localStorage is readable by same-origin JavaScript: XSS can steal credentials. Use HTTPS
outside local development, avoid third-party scripts/raw HTML, and never log authorization
headers, bodies containing credentials, or host fragments (including analytics/Sentry).
Browser extensions/clipboard/history may still expose a copied host link. Do not share it.
Clearing storage without saving the private host link loses management; no recovery/rotation
or revocation is implemented. Losing participant storage loses identity; rejoining can duplicate.
Polling costs requests and has up to roughly 5 seconds of visible delay. Final-state reversal,
participant pagination, rate limiting, expiry enforcement and upload authorization remain future work.
The public invite shows only event metadata, never participant lists or secret verifiers.

QR library: [qrcode.react](https://www.npmjs.com/package/qrcode.react), pinned to 4.2.0.
It renders the invite as a local SVG; this avoids disclosing invite URLs to a QR service.
