We have completed Gatheroll's first end-to-end vertical slice:

```text
Create Event
→ POST /events
→ FastAPI validation
→ PostgreSQL persistence
→ GET event by share_token
→ render persisted event in Next.js
```

The project already has:

* Next.js 16 + TypeScript + Tailwind frontend
* FastAPI backend
* PostgreSQL
* SQLAlchemy 2.x
* Alembic migrations
* Docker backend
* CI with lint/type-check/test/build
* deployed architecture foundation
* README
* ADR 001: Web First vs Native/App Clip

Now build the next vertical slice:

# Host Management + Public/Private Join + Participant Approval

This is the first genuinely multi-user workflow in Gatheroll.

Do NOT implement photo upload or AI yet.

---

# 1. Product Roles

Gatheroll has two distinct roles.

## Host

The host:

* creates the event
* configures name, date/time, location
* chooses whether the event is Public or Private
* receives the QR code / invite link
* manages participants
* approves/rejects join requests for Private events
* will later manage the event and shared photos

## Participant

A participant:

* scans the QR or opens the invite link
* enters only a display name
* does NOT create an account
* joins immediately if the event is Public
* waits for host approval if the event is Private
* after approval, will eventually upload photos

For this task, photo uploading is NOT implemented yet.

---

# 2. Very Important: Mobile First

Gatheroll will primarily be used from phones.

The main real-world experience is:

```text
person sees QR
→ takes out phone
→ scans QR
→ browser opens
→ joins event
```

Treat mobile as the primary viewport, not a responsive afterthought.

Design and test around widths such as:

```text
375px
390px
430px
```

Requirements:

* no horizontal overflow
* no hover-dependent controls
* touch targets approximately 44px minimum where practical
* forms easy to complete with one hand
* important actions near the bottom / thumb-accessible where appropriate
* readable typography without zooming
* QR must be large enough to scan reliably from another phone
* participant management must use mobile-friendly cards, NOT desktop tables
* account for mobile browser safe areas where relevant
* loading/error/empty states must work well on small screens
* desktop can expand gracefully, but do not design desktop first

Keep Gatheroll visually aligned with our direction:

* Once-inspired simplicity
* modern camera-roll feeling
* photography-first
* neutral colors
* near-black typography
* generous whitespace
* no retro film aesthetic
* no fake disposable-camera UI

Do not spend excessive time polishing visuals yet, but the flows must already feel intentional on mobile.

---

# 3. Public vs Private Events

When creating an event, the host chooses:

## Public

UI explanation:

> Anyone with this QR or link can join instantly.

Important:

"Public" does NOT mean searchable or globally discoverable.

All Gatheroll events remain **unlisted**.

A person still needs the event's QR or share link.

## Private

UI explanation:

> Guests request to join. You approve them before they enter.

Private should be the default for now because Gatheroll will eventually contain personal photos and privacy is important.

---

# 4. Model This as a Join Policy, Not `is_public`

Do NOT store this as:

```python
is_public: bool
```

Prefer an explicit domain concept such as:

```text
join_policy
```

Possible values:

```text
open
approval_required
```

The UI can call these:

```text
Public
Private
```

Why:

`public/private` describes the user-facing concept.

`open/approval_required` describes the actual system behavior.

This also leaves room for future policies without adding ambiguous booleans.

Use an enum or another strongly typed representation appropriate to the current architecture.

---

# 5. Evolve the Event Schema

Create a new Alembic migration.

Add to `events`:

```text
join_policy
manage_token_hash
```

Do not reset the database manually.

Use the migration to evolve the existing schema.

Existing development events should migrate safely.

---

# 6. Host Management Token

We still do NOT want host accounts in V1.

Instead use capability-based host authorization.

When an event is created:

```text
generate cryptographically secure manage token
↓
return raw token to creator ONCE
↓
store only its hash in PostgreSQL
```

Use Python's secure random facilities, e.g. `secrets`.

Because the token has high entropy, a cryptographic hash such as SHA-256 is appropriate for storing its verifier.

Do not treat it like a user password requiring password-specific slow hashing unless there is a concrete reason.

Important distinction:

```text
share_token
```

is intentionally public/unlisted.

```text
manage_token
```

is a secret capability.

Never expose the raw manage token through public GET endpoints.

Never log it.

---

# 7. Event Creation Response

The existing `POST /events` response will need to evolve.

Keep public event data separate from creator-only credentials.

Conceptually:

```json
{
  "event": {
    "...": "...",
    "share_token": "...",
    "join_policy": "approval_required"
  },
  "manage_token": "SECRET_RETURNED_ONLY_ON_CREATE"
}
```

Use appropriately named Pydantic schemas.

Do NOT accidentally add `manage_token` or `manage_token_hash` to the normal public `EventResponse`.

This separation is important.

---

# 8. Create Event UI

Update the existing Create Event form.

In addition to:

```text
Event name
Start
End
Location
```

add a clear mobile-friendly selector:

```text
Who can join?

○ Private
  Guests request to join.
  You approve them first.

○ Public
  Anyone with the QR or link joins instantly.
```

Private should be selected by default.

Do not make this a tiny checkbox.

The host should understand the consequence before creating the event.

After successful event creation:

DO NOT redirect the host to the participant/public event page.

Redirect to the new **Host Manage Page**.

---

# 9. Host Manage Page

Create a host-facing route.

Choose a simple secure capability-link pattern that works with the current architecture.

The host page should show:

```text
Jenny's Birthday

Sep 12 · 7:00 PM
Brooklyn

Private Event
```

Then prominently:

```text
[ QR CODE ]

Scan to join

[ Copy invite link ]
```

The QR must encode the PARTICIPANT URL:

```text
/e/{share_token}
```

Do NOT use an external QR-generation web service.

Generate/render the QR locally in the application using a small justified library.

Below it:

```text
Participants
```

Private event initial state:

```text
No one has requested to join yet.
```

Public event initial state:

```text
No one has joined yet.
```

Use mobile cards, not tables.

---

# 10. Participant Model

Add a `participants` table through Alembic.

Suggested starting structure:

```text
participants

id
event_id
display_name
status
participant_token_hash
joined_at
approved_at nullable
```

Use the appropriate relationship / foreign key to `events`.

Participant status should be explicit.

Possible states:

```text
pending
approved
rejected
```

Do NOT use a single `approved: bool`.

These are distinct product states.

Think through sensible state transitions.

For Public events:

```text
join request
→ participant created as approved
```

For Private events:

```text
join request
→ participant created as pending
```

Do not automatically create the host as a participant yet.

Host and participant are separate roles for now.

---

# 11. Participant Identity Without Login

Participants should not need:

* email
* password
* phone number
* Google login
* Apple login

When a participant joins, generate a high-entropy participant token.

Conceptually:

```text
raw participant token
→ returned once to that browser

hash
→ stored in PostgreSQL
```

This token represents that participant's identity for this event.

The frontend may persist the token locally for the current MVP so that refreshing/reopening the event can restore the participant state.

Before choosing the browser persistence mechanism, inspect the current frontend/backend architecture and choose the simplest reasonable solution.

If using localStorage, explicitly document the XSS/security tradeoff.

Do not introduce a complicated authentication framework or BFF solely for this step.

We can improve session handling later if measurements/security needs justify it.

Keep token-handling code isolated so it can be replaced later.

---

# 12. Participant Join Flow

Public event page:

```text
/e/{share_token}
```

If this browser has not joined yet, show:

```text
Jenny's Birthday

September 12
Brooklyn

Your name
[ Leia ]

[ Join Gatheroll ]
```

Only ask for display name.

No account creation.

---

# 13. Join API

Create an API for joining an event.

Choose a clean REST shape consistent with the current API.

Example conceptually:

```text
POST /events/{share_token}/participants
```

Input:

```json
{
  "display_name": "Leia"
}
```

The server determines the initial state from the EVENT'S join policy.

The client must NOT send:

```text
status = approved
```

and decide its own authorization.

Server behavior:

## Public/open

```text
create participant
status = approved
```

## Private/approval_required

```text
create participant
status = pending
```

Return:

* participant public data
* raw participant token once

Validate display names reasonably.

Do not require names to be unique.

---

# 14. Participant States in the UI

## Public Event

After Join:

```text
You're in.

Photos will be added in the next development step.
```

## Private Event

After Join:

```text
Request sent

Waiting for the host to let you in…
```

Do NOT make the participant resubmit after refresh.

Restore their state from their stored participant token.

## Rejected

Show a respectful simple state:

```text
Your request wasn't approved.
```

Do not leak host information.

---

# 15. Participant Status Endpoint

Add a secure way for a participant to retrieve their own current state using their participant token.

Do not allow one participant to fetch private state belonging to another participant.

Use an explicit authorization check.

This endpoint will also become useful later when photo upload authorization depends on:

```text
participant.status == approved
```

---

# 16. Host Participant Management

The host management page should display participants.

Private event example:

```text
Participants

Leia
Waiting for approval
[ Approve ] [ Reject ]

Mina
Approved
```

Public event example:

```text
Participants

Leia
Joined

Mina
Joined
```

Host actions must be authorized using the manage token.

Frontend visibility is NOT security.

Even if someone manually calls the API:

```text
approve participant
```

without valid host authorization, the backend must reject it.

Create host-authorized endpoints to:

* list participants
* approve a participant
* reject a participant

Keep the API coherent and small.

Actions should be safe to retry where practical.

---

# 17. Authorization Principle

This project now needs a clear distinction between:

## Identity / Authentication

> Which participant/browser is this?

represented by the participant token.

## Authorization

> Is this participant allowed to do this action?

represented by participant status and event membership.

Host authorization:

> Does this request possess the event's valid manage capability?

Later, photo upload authorization will require:

```text
valid participant identity
AND
participant belongs to event
AND
participant.status == approved
```

Design the code so those checks can later be reused.

Do not scatter token verification logic across route handlers.

A small focused security/auth utility or dependency is appropriate.

---

# 18. Real-Time Behavior: Keep It Simple

For Private events:

Participant:

```text
Waiting for host approval…
```

Host:

```text
Leia requested to join
```

We want state changes to appear without a manual page refresh.

For THIS iteration, use simple polling.

For example:

```text
participant pending page → poll own status periodically
host participant list → poll participant list periodically
```

Choose a reasonable interval.

Do NOT introduce:

* WebSockets
* SSE
* Redis
* event bus

yet.

Document that polling is intentional at this scale.

If later measurements/user experience justify real-time infrastructure, we can change it.

Clean up polling when pages unmount / become irrelevant.

Avoid excessive network requests.

---

# 19. QR Experience

The QR is an important physical/social object in Gatheroll.

The Host Manage Page should make it visually prominent.

Requirements:

* large enough to scan reliably
* high contrast
* participant URL only
* copy invite link button
* mobile-friendly
* works when Host A displays the QR on one phone and Participant B scans it

Test the actual QR with a phone.

Do not consider it complete based only on desktop rendering.

---

# 20. Code Architecture

This is a Product Engineer portfolio project.

Do NOT allow this feature to turn route files into giant files or spread product logic everywhere.

Before implementing, inspect the current repository structure.

Preserve existing conventions when they are good.

Refactor only where needed.

Keep clear boundaries such as:

Frontend conceptually:

```text
app/
  event routes
  manage routes

features/
  events/
  participants/

lib/
  api/
  tokens/storage if needed

components/
  reusable UI primitives only when actually reused
```

Do NOT force this exact structure if the repo already has a cleaner equivalent.

The goal is:

* event logic grouped coherently
* participant logic grouped coherently
* API client logic not duplicated in every component
* token persistence isolated
* mobile UI components kept understandable
* no global state library unless genuinely needed

Backend conceptually:

```text
api/routes/
  events
  participants
  host management

models/
schemas/
db/
security/
```

Again, adapt to the current codebase rather than creating unnecessary layers.

Avoid premature:

```text
repository pattern
service interfaces
dependency injection frameworks
generic CRUD abstractions
```

But also avoid putting:

```text
validation
database logic
token hashing
authorization
serialization
```

all inside one route function.

Prefer explicit, small, well-named functions.

---

# 21. State Machines

Document the participant lifecycle explicitly.

At minimum:

```text
              ┌─────────┐
              │ pending │
              └────┬────┘
                   │
          ┌────────┴────────┐
          ▼                 ▼
      approved           rejected
```

Public events skip pending:

```text
created
→ approved
```

Do not create inconsistent combinations such as:

```text
status = pending
approved_at != null
```

Preserve invariants in application logic and/or database constraints where reasonable.

Do not over-engineer a state machine framework.

---

# 22. Security

Use high-entropy random tokens.

Store hashes for:

```text
manage token
participant token
```

Do not log secrets.

Do not expose manage-token hashes.

Do not expose participant-token hashes.

Public event GET responses should expose only information participants need.

Host-only APIs must verify host capability.

Participant-only APIs must verify participant capability.

Use constant-time comparison if appropriate in the implementation.

Keep public `share_token` distinct from secret authorization tokens.

---

# 23. Tests

Add meaningful backend tests for at least:

### Event creation

* private event defaults to approval_required
* explicit public event persists as open
* event creation returns raw manage token
* public event GET never returns manage token/hash

### Join

* Public event join creates approved participant
* Private event join creates pending participant
* blank display name rejected

### Host authorization

* correct manage token can list participants
* incorrect/missing manage token cannot
* correct manage token can approve
* correct manage token can reject
* guest/participant token cannot perform host actions

### Participant authorization

* participant can retrieve their own status with correct token
* wrong token cannot retrieve another participant's protected state

### State

* approved state is persisted
* rejected state is persisted

Frontend tests should focus only on meaningful product logic. Do not create a large test suite for presentational components.

Existing CI must remain green.

---

# 24. Manual Mobile Test

Before calling the task complete, manually test the real flow.

Use two browser contexts/devices if possible.

## Private Event

```text
Host phone/browser
→ Create Private Gatheroll
→ Host Manage Page
→ QR displayed

Participant phone/browser
→ Scan QR
→ enter name
→ Join
→ Waiting for approval

Host
→ participant appears
→ Approve

Participant
→ polling detects approval
→ "You're in"
```

## Public Event

```text
Host
→ Create Public Gatheroll

Participant
→ Scan QR
→ enter name
→ Join
→ immediately approved
```

Check on mobile-sized viewports and a real phone where possible.

---

# 25. README / ADR

Update the README with only implemented behavior.

Document:

```text
Host vs Participant roles
Public vs Private join behavior
No-account identity model
Host capability authorization
Participant state lifecycle
```

Create an ADR for this meaningful decision.

Suggested:

```text
docs/adr/002-event-access-and-no-account-authorization.md
```

Cover:

## Context

Gatheroll needs near-zero-friction QR participation but photo albums are private/sensitive.

## Decision

* Events are always unlisted.
* Host chooses Open ("Public") or Approval Required ("Private").
* No mandatory accounts.
* Host authorization uses a secret capability token.
* Participant identity uses an event-scoped secret token.
* Backend status determines authorization.

## Alternatives

* mandatory accounts
* QR grants full access automatically for every event
* one boolean `is_public`
* full auth framework

## Consequences

Include both benefits and risks.

Do not write this as post-hoc marketing. Record actual tradeoffs.

---

# 26. Do NOT Implement Yet

Do not implement:

* photo picker
* photo uploads
* thumbnails
* R2
* AI
* embeddings
* pgvector
* Redis
* SSE
* WebSockets
* App Clip
* account login
* Google/Apple auth
* comments
* album categories

This step is specifically about:

```text
event
→ host
→ QR
→ participant
→ join policy
→ approval
→ authorization
```

---

# 27. Learning Explanation

After implementation, explain these concepts using the ACTUAL Gatheroll code:

## Product / Domain

1. Why `join_policy` is better than `is_public`.
2. Difference between "Public" and internet-discoverable.
3. Why approval is authorization, not just a frontend state.

## Security

4. Difference between `share_token`, `manage_token`, and `participant_token`.
5. Why share_token can be stored in plaintext but secret capability tokens are hashed.
6. Why high-entropy API tokens can use a fast cryptographic hash while passwords generally need slow password hashing.
7. What attack becomes possible if frontend-only approval checks are used.

## Database

8. Explain the Event → Participants relationship.
9. Explain the new Alembic migration and how it evolves an existing database.
10. Explain participant state invariants.

## Frontend

11. Explain how a returning participant is recognized.
12. Explain where participant credentials are stored and the tradeoff of that choice.
13. Explain how polling works and why we chose it over WebSockets/SSE.

## Request flow

Trace this exact private-event sequence:

```text
Host creates Private event
→ event + manage credential stored

Guest scans QR
→ GET public event

Guest joins
→ POST participant
→ pending participant stored

Host lists participants
→ manage authorization verified

Host approves
→ participant status updated

Guest polls
→ participant authorization verified
→ approved returned

Frontend updates
```

Identify failure points at every stage.

---

# 28. Completion Report

When finished, report:

1. Files created/changed.
2. Database migration and new schema.
3. Route/API contracts.
4. Token/security model.
5. Participant state model.
6. Host flow.
7. Public participant flow.
8. Private participant flow.
9. Mobile UX choices made.
10. Code-structure decisions/refactors.
11. Tests added.
12. Manual mobile testing performed.
13. Tradeoffs discovered.
14. Anything you intentionally did NOT implement.
15. What I should understand before the next step.
16. Recommend the next smallest vertical slice, but do NOT implement it.

The likely next slice will be:

```text
approved participant
→ photo picker
→ client-side thumbnail
→ upload lifecycle
```

but do not start it yet.

Remember:

**Gatheroll is primarily a mobile product and a Product Engineer portfolio project.**

Do not optimize for the number of features.

Optimize for:

```text
clear product behavior
clean architecture
mobile usability
correct authorization
explicit state
production-minded code
and technical decisions I can explain myself
```
