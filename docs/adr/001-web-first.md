# ADR 001: Use the web as Gatheroll's universal participation layer

- **Status:** Accepted
- **Date:** 2026-09-06

## Context

Gatheroll succeeds only if every person at an event can join with very little
coordination. Native apps offer deeper photo-library integration, but requiring
an installation before contributing recreates the friction the product is meant
to remove. Mobile browsers cannot silently scan a camera roll, so people will
still need to explicitly select photos through the system picker.

## Decision

Build V1 as a mobile-first web application. A guest scans a QR code, joins in
the browser without an account, and explicitly selects a broad set of photos for
Gatheroll to filter. The web experience remains the universal participation
layer even if native surfaces are added later.

Explore an iOS App Clip only after the web product proves useful. An App Clip
may provide a more native photo-selection experience without a full install,
but it is not part of V1 and has no direct modern Android equivalent.

## Alternatives considered

- **Native iOS and Android apps:** better device integration, but two clients and
  mandatory installation add substantial delivery and participation cost.
- **Native iOS first:** reduces implementation scope, but excludes Android users
  and weakens the QR-to-join promise.
- **App Clip first:** promising on iOS, but platform-specific and adds native
  complexity before the product hypothesis is validated.

## Consequences

- Joining stays as simple and cross-platform as QR → browser → display name.
- Photo access must be initiated by the user through the browser/system picker.
- Mobile browser lifecycle constraints must shape the later upload design.
- Some native capabilities are deferred in exchange for reach and iteration
  speed.
