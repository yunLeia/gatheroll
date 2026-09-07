> Historical source brief. On 2026-09-07, required host start/end boundaries and primary
> time/GPS membership filtering were superseded by [ADR 005](../adr/005-event-boundaries-are-not-membership.md).
> Use the [current product model](event-relevance.md): participant selection first,
> visual/contextual relevance hypothesis, weak optional metadata. The original text below
> is preserved as provenance, not authorization to reinstate obsolete requirements.

You are helping me build a production-quality portfolio project called **Gatheroll**.

This is not just a hackathon app. I am building it as a centerpiece **Product Engineer / AI Product Engineer portfolio project**, so I care about product judgment, architecture, AI evaluation, reliability, deployment, observability, and being able to explain every important technical decision myself.

The local folder is currently empty and is named:

`gatheroll`

Do not try to build the entire product in one pass. Work incrementally, keep the application deployable, and help me understand what we are building.

---

# 1. PRODUCT

## Name

**Gatheroll**

Pronounced approximately:

**gather + roll → “gather-roll” / 개더롤**

The name comes from:

> gather + camera roll

---

# 2. PRODUCT THESIS

After friends hang out, everyone takes photos on their own phones.

The current workflow is usually:

```text
hang out
→ everyone takes photos
→ "send me the pics"
→ everyone manually selects photos
→ people send them through different apps
→ someone forgets
→ photos remain scattered across camera rolls and chats
```

Gatheroll should remove as much of this coordination as possible.

The core idea is:

> **Scan once. Take photos normally. Gatheroll figures out what belongs to the event.**

Another useful description:

> **A shared album that fills itself.**

The purpose is NOT primarily to curate one “perfect memory.”

The main problem is:

> **People should not have to manually coordinate photo sharing after a group event.**

---

# 3. CORE USER FLOW

## Host

```text
Create event
→ event name
→ start/end time
→ location if available
→ QR code + share link
```

## Guest

```text
Scan QR
→ open mobile web app
→ join without account
→ enter display name
→ take photos normally using their normal phone camera
→ later tap "Add photos"
→ bulk-select photos around the event
→ Gatheroll analyzes which photos actually belong to the event
→ user reviews uncertain photos
→ confirm sharing
```

## Shared album

```text
All Photos
Group
Portraits / People
Scenery
Food
Candid

→ Download originals
```

Later we may add:

```text
Moments
Photos with me
Cross-camera moments
```

but those are NOT V1 priorities.

---

# 4. WHY WEB FIRST

The MVP should be a **mobile-first web application**, not a native app.

This is a deliberate product decision.

The whole point is low-friction participation:

```text
QR
→ browser
→ join
```

No App Store.
No Play Store.
No mandatory download.

A native app would give better access to the user's photo library, but requiring everyone at an event to install an app creates more coordination friction.

## Future V2

On iOS, I want to explore an **App Clip**.

The long-term experience could be:

```text
QR
→ App Clip
→ native-like experience without full app installation
→ better photo-library integration
```

Android does not currently have a direct modern equivalent to App Clips, so the mobile web app should remain the universal participation layer.

Document this as an architectural/product decision.

---

# 5. CORE AI PROBLEM

The primary AI problem is:

# **Which photos belong to this event?**

This is the most important AI feature.

Suppose an event is:

```text
September 6
6:00 PM – 10:30 PM
Central Park
6 participants
```

A user may select 60 photos from their camera roll.

Those 60 may contain:

* real event photos
* screenshots
* unrelated selfies
* downloaded images
* photos before the event
* photos after the event
* photos from the same location but another time
* bursts / duplicates

Gatheroll should produce something like:

```text
42 Event Photos
7 Need Review
11 Excluded
```

---

# 6. PRIVACY PRINCIPLE

This is extremely important.

A false positive is more harmful than a false negative.

If Gatheroll misses one valid event photo, that is inconvenient.

If Gatheroll automatically shares a private or unrelated photo with the group, that is a serious trust/privacy failure.

Therefore:

> **Event detection should be precision-first.**

The system should prefer to put uncertain photos into a review state rather than automatically share them.

Conceptually:

```text
high confidence
→ selected

medium confidence
→ review required

low confidence
→ excluded
```

Do NOT hardcode arbitrary thresholds permanently.

Thresholds should eventually be selected using evaluation data and stored in versioned configuration.

AI should recommend.

The user has final control.

---

# 7. AI ARCHITECTURE PHILOSOPHY

Do NOT solve the entire problem by sending every image to a multimodal LLM.

Prefer the cheapest and most deterministic mechanism that solves each subproblem.

Potential layers:

```text
Layer 1
Metadata
- capture timestamp
- GPS if available
- dimensions
- MIME/type
- EXIF

Layer 2
Deterministic CV
- pHash / near-duplicate detection
- blur / basic quality if needed

Layer 3
Vision embeddings
- CLIP / SigLIP or another appropriate open-source model
- cosine similarity

Layer 4
Event scoring
- time relevance
- location relevance
- visual relevance
- cross-user similarity

Layer 5
Optional vision classification
- group
- portrait
- scenery
- food
- candid
```

An LLM or multimodal generative model should only be used where it is actually justified.

A key portfolio story should be:

> I intentionally did not use an LLM for every image because the core problem is similarity and classification, not language generation.

---

# 8. EVENT VISUAL RELEVANCE

Do not treat `visual_score` as an undefined magic value.

One possible strategy to investigate:

## Step 1

Use strong metadata matches to identify high-confidence seed images.

For example:

```text
photo timestamp is inside event window
+
GPS is close to event
```

## Step 2

Generate embeddings for those seed photos.

Build an event visual representation, potentially using:

* clusters
* nearest-neighbor sets
* centroids

## Step 3

Compare ambiguous photos against the event's visual representation.

## Step 4

Use cross-user similarity as an additional signal.

Example:

If two participants took visually similar photos within a similar time window, that is strong evidence that the photo belongs to the same event.

This should remain explainable.

Do not create an opaque ML system unnecessarily.

---

# 9. PHOTO CATEGORIES

After approved photos are in the shared album, classify them into smart filters.

Initial categories:

```text
All
Group
People / Portrait
Scenery
Food
Candid
```

This should be **multi-label**, not mutually exclusive.

A photo may be:

```json
["group", "food", "candid"]
```

Do not model these as physical folders.

Treat them as smart filters/tags over the same underlying photo collection.

---

# 10. LATER FEATURES, NOT MVP

Do not prioritize these until the core product is strong:

```text
Photos with me
facial recognition
social feed
comments
likes
chat
video editing
native iOS app
Android native app
App Clip
automatic full camera-roll scanning
advanced highlight generation
complex social features
```

Potential P1/P2 feature:

## Cross-camera moments

If Leia, Mina, and Alex all photographed the birthday cake at approximately the same moment, cluster those photos into something like:

```text
Birthday Cake
15 photos from 3 people
```

But event relevance is much more important than moment clustering.

---

# 11. ACCOUNT / AUTH MODEL

V1 should NOT require user accounts.

This is a deliberate product decision.

## Guest

```text
QR
→ event page
→ enter display name
→ join
```

No login.

The app may create:

```text
participant_id
browser_token
```

Store a browser token using an appropriate secure mechanism so a returning guest can be recognized.

## Host

V1 should also avoid mandatory host signup.

Use separate capability-style tokens.

For example:

```text
share_token
manage_token
```

### share token

Allows:

* open event
* join
* contribute photos
* view shared album

### manage token

Allows host-level operations such as:

* edit event
* close event
* manage photos
* delete event
* download/manage event

Treat manage tokens as secrets.

Do not expose them in public QR codes.

Optional Apple/Google account login may be a V2 feature for users who want a persistent "My Events" library.

---

# 12. STORAGE / RETENTION

Events and photos need server-side persistence.

Potential V1 retention policy:

> Events remain available for approximately 30 days after the event.

This is motivated by:

* privacy
* storage cost
* clear lifecycle
* avoiding permanent storage promises

Do not assume this exact policy is immutable; make it configurable.

Use lifecycle cleanup rather than storing everything forever.

---

# 13. IMPORTANT WEB PHOTO CONSTRAINT

Because this is a web app, the browser cannot silently scan the user's entire camera roll.

The user must explicitly select files using the browser/system photo picker.

The UX should therefore say something like:

> **Select everything from around the event. Don't worry about deciding what to share.**

The user performs one broad selection.

Gatheroll does the filtering afterward.

---

# 14. ORIGINAL PHOTO UPLOAD ARCHITECTURE

Think carefully about this.

One attractive product design is:

```text
select originals
→ generate small thumbnails client-side
→ analyze thumbnails
→ user approves
→ upload approved originals
```

However, on mobile web we cannot safely assume that browser `File` references survive refreshes, background tab eviction, or long-running processing.

Therefore investigate and document the tradeoff between:

## Option A

Keep originals client-side until approval.

Pros:

* unrelated/private originals never reach our storage

Cons:

* fragile across refresh/tab termination
* difficult to resume

## Option B

Upload originals immediately to temporary PRIVATE object storage using signed URLs.

Then:

```text
uploaded != shared
```

Only approved photos become visible in the shared album.

Rejected/unapproved originals should be deleted after an appropriate short retention period.

Pros:

* resilient
* resumable
* safer on mobile Safari
* easier async processing

Cons:

* unrelated photos temporarily reach private server storage

Do not silently choose without documenting this tradeoff.

This should become an ADR.

---

# 15. RECOMMENDED TECH STACK

## Frontend

```text
Next.js
TypeScript
React
Tailwind CSS
```

Mobile-first.

Do not overuse component libraries unless they meaningfully accelerate development.

## Backend

```text
FastAPI
Python
Pydantic
SQLAlchemy or another justified ORM
Alembic migrations
```

## Database

```text
Postgres
```

Likely hosted on Neon or another managed Postgres provider.

Use `pgvector` if/when image embeddings need to be stored and queried.

Do NOT introduce a separate vector database unless there is evidence it is necessary.

## Object storage

```text
Cloudflare R2
```

Use S3-compatible presigned URLs so original image bytes do not unnecessarily pass through FastAPI.

Conceptually:

```text
Browser
   ↓ request upload authorization
FastAPI
   ↓ signed URL
Browser ─────────────→ R2
```

## Deployment

Target:

```text
Frontend → Vercel
Backend → Railway
Database → Neon/Postgres
Storage → Cloudflare R2
```

Use Docker for the backend.

## Error monitoring

```text
Sentry
```

Do not force Langfuse into the project if the main AI pipeline is embeddings + deterministic CV rather than LLM calls.

If a later multimodal model is used for classification, Langfuse may be appropriate for that part only.

---

# 16. COST PHILOSOPHY

This should remain cheap enough to run as a portfolio project.

Prefer:

* open-source vision models
* local development inference
* small thumbnails for AI
* direct-to-R2 uploads
* free/low-cost infrastructure tiers
* rate limits
* photo count limits

Do not send full-resolution images to an AI API unless there is a strong reason.

Track eventual metrics like:

```text
cost per 100 photos
storage per event
processing latency per photo
upload failure rate
```

Cost-aware engineering is part of the portfolio story.

---

# 17. DATABASE STARTING POINT

Do not consider this final without thinking through relationships and indexes.

A starting model could be:

```text
events
- id
- title
- starts_at
- ends_at
- latitude
- longitude
- share_token
- manage_token
- created_at
- expires_at

participants
- id
- event_id
- display_name
- browser_token_hash
- joined_at

photos
- id
- participant_id
- event_id
- status
- captured_at
- latitude
- longitude
- phash
- embedding
- thumbnail_key
- original_key
- created_at

photo_scores
- photo_id
- time_score
- location_score
- visual_score
- cross_user_score
- final_score
- decision
- score_version
- embedding_model
- pipeline_version

jobs
- id
- event_id
- stage
- status
- progress
- error
- created_at
- updated_at
```

Do NOT hardcode an embedding dimension until we choose the actual model.

Do not add PostGIS unless measurements/use cases justify it.

Simple latitude/longitude plus Haversine distance should probably be enough initially.

---

# 18. PHOTO STATE MACHINE

We want photo processing to have explicit state rather than boolean flags everywhere.

Possible conceptual lifecycle:

```text
selected
→ temporarily_uploaded / thumbnail_ready
→ processing
→ scored
→ pending_review
→ approved
→ shared
```

Alternative path:

```text
scored
→ rejected
→ deleted
```

The exact state machine should be designed deliberately.

Document it visually in the README later.

---

# 19. DO NOT OVERENGINEER EARLY

This project should show engineering judgment, not technology collection.

Do not automatically add:

* Redis
* arq / Celery
* HNSW
* IVFFlat
* streaming ZIP
* PostGIS
* Kubernetes
* separate vector DB
* complicated auth system

until measurements justify them.

Examples of good portfolio decisions:

> Exact pgvector search was fast enough for hundreds of photos per event, so I did not add an ANN index.

or:

> Synchronous processing exceeded acceptable latency at 100 photos, so I introduced a background worker.

That is better than adding infrastructure because "production apps use it."

---

# 20. GOLDEN DATASET BEFORE SOPHISTICATED AI

Evaluation is one of the most important parts of this portfolio project.

Do not build a complex AI pipeline first and invent evaluation afterward.

Create a golden dataset before tuning the AI.

Initial labels:

## Event relevance

```text
belongs
does_not_belong
ambiguous
```

## Categories

multi-label:

```text
group
people
scenery
food
candid
other
```

Later, if implementing moment clustering:

```text
duplicate pairs
moment clusters
```

Create written labeling rules before labeling.

Examples:

```text
screenshots → generally unrelated

photo taken during travel immediately before event
→ potentially ambiguous

same physical location on another day
→ unrelated

burst photos taken seconds apart
→ potentially same moment
```

Include intentionally difficult examples:

* screenshots during event
* downloaded/saved images
* burst photos
* same location on different date
* same location, different group
* indoor/outdoor
* day/night
* immediately before/after event
* unrelated selfie within event time
* food photo with no visible people
* photos with missing GPS

Dataset diversity matters more than chasing a huge number.

Something like 200–500 well-labeled photos may be enough for a portfolio-scale project.

---

# 21. EVALUATION

For event relevance, precision matters more than recall.

Positive class:

```text
belongs_to_event
```

A false positive therefore means:

> an unrelated photo was incorrectly treated as an event photo

This is the failure we most want to avoid.

Measure:

```text
precision
recall
false positive rate
review rate
```

Also measure the tradeoff as thresholds change.

For example:

```text
threshold increases
→ fewer false positives
→ more review / false negatives

threshold decreases
→ less review
→ more false positives
```

Do not choose thresholds by intuition alone.

Use the dataset.

For category classification, category-level precision/recall is more useful than one global accuracy number.

Later, if moment clustering exists, investigate appropriate clustering metrics such as ARI/NMI.

---

# 22. BASELINES

Always build simple baselines.

Before embeddings:

## Baseline 1

Timestamp only.

## Baseline 2

Timestamp + location.

Then compare against:

## Model 3

Metadata + visual embeddings.

Potential final portfolio table:

```text
                Precision    Recall
Timestamp       ...
Time + GPS      ...
+ Visual        ...
```

The point is to prove whether AI actually improves the workflow.

---

# 23. CI / TESTING

Start with normal engineering tests:

```text
lint
type checking
backend unit tests
API tests
frontend tests where justified
```

Later create an AI evaluation harness.

Do not necessarily run the full expensive vision pipeline on every pull request.

Possible model:

## Every PR

Small frozen regression set.

## AI/scoring/model changes

Full golden dataset.

If adding an AI quality CI gate, choose thresholds deliberately.

Do not create a meaningless badge just for the portfolio.

---

# 24. OBSERVABILITY

This is a production AI application.

Measure the actual pipeline.

Examples:

```text
thumbnail_ms
upload_ms
embedding_ms
scoring_ms
batch_processing_ms

P50
P95

photos processed / sec
failure rate
retry count
```

Also record AI/scoring metadata such as:

```text
pipeline_version
model_version
score_version
```

Use Sentry for application errors.

If we later use a generative multimodal model, trace those calls appropriately.

Do not use Langfuse simply as a checkbox if it is not the correct tool.

---

# 25. DOGFOODING

The app should be used by real people during development.

At minimum:

```text
Create real event
→ QR
→ friend joins
→ both upload
→ observe where workflow breaks
```

Record:

* how many people joined
* how many successfully contributed
* where they hesitated
* where they abandoned
* upload errors
* review decisions they changed
* AI false positives
* AI false negatives

Especially important:

If the AI predicts:

```text
event photo
```

and the user changes it to:

```text
does not belong
```

store/log that correction.

That corrected example can later be added to the golden dataset.

Ideal quality loop:

```text
prediction
→ user correction
→ dataset
→ next pipeline version
→ regression evaluation
```

This is an important Product Engineer portfolio story.

---

# 26. DESIGN DIRECTION

The visual inspiration is:

**Once (once.film)**

But do NOT copy its film/disposable-camera aesthetic.

Take inspiration from:

* simplicity
* photography-first UI
* large confident typography
* minimal chrome
* QR as an important object
* mobile-first interaction
* one primary action per screen
* calm premium feeling

Do NOT use:

* fake film grain
* disposable camera framing
* retro film colors
* exposure counters
* development/darkroom metaphors
* analog camera UI
* fake film borders

The visual mental model should be closer to a **modern camera roll / Apple Photos album**.

Photos should provide most of the color.

UI should be neutral and restrained.

Possible:

```text
off-white / white background
near-black typography
very light gray surfaces
one restrained accent color
```

---

# 27. ALBUM UI

Think dense camera-roll grid, not social feed.

Example:

```text
←             NYC Picnic              ···

September 6, 2026
6 people

[ All ] [ Group ] [ People ] [ Scenery ] [ Food ] [ Candid ]

┌──────┬──────┬──────┐
│ IMG  │ IMG  │ IMG  │
├──────┼──────┼──────┤
│ IMG  │ IMG  │ IMG  │
├──────┼──────┼──────┤
│ IMG  │ IMG  │ IMG  │
└──────┴──────┴──────┘
```

Avoid:

* Instagram-like feed cards
* excessive text
* Pinterest masonry unless justified

The photo grid is the primary UI.

---

# 28. AI UX

Do not make the product constantly talk about AI.

Bad:

> Our multimodal AI has analyzed your images.

Good:

> **We found 38 photos from this event.**

Then:

```text
38 selected
6 need review
12 not included
```

AI should feel embedded in the product.

Not like a chatbot added to the side.

---

# 29. FAILURE UX

The product should still function if AI fails.

Examples:

## AI unavailable

```text
We couldn't analyze your photos right now.
You can still choose and share them manually.
```

## Upload partial failure

```text
47 of 50 uploaded.
Retry 3 failed photos.
```

## Low confidence

```text
We couldn't confidently identify these photos.
Review them manually.
```

AI failure must degrade gracefully rather than kill the shared-album product.

---

# 30. PORTFOLIO GOAL

This project should demonstrate that I can think through:

```text
product problem
→ UX
→ frontend
→ backend
→ database
→ file infrastructure
→ AI architecture
→ evaluation
→ privacy
→ reliability
→ cost
→ deployment
→ observability
→ iteration
```

I want to be able to explain the project from 1 to 100.

The code alone is not the portfolio.

The decisions are part of the portfolio.

---

# 31. DOCUMENT IMPORTANT DECISIONS AS THEY HAPPEN

Create an ADR directory such as:

```text
docs/adr/
```

Do NOT wait until the project is finished and retroactively invent ADRs.

Potential early ADRs:

```text
001-web-vs-native.md
002-photo-upload-lifecycle.md
003-embeddings-vs-multimodal-llm.md
004-vector-search-strategy.md
```

Only create an ADR when we actually make a meaningful decision.

Each should be concise:

```text
Context
Decision
Alternatives considered
Consequences
```

---

# 32. PROJECT README

Start the README now, before the product exists.

The final README should eventually contain:

```text
1. One-line description + live link
2. Demo GIF
3. Problem / current workflow
4. Why existing products do not fully solve it
5. Product flow
6. Architecture diagram
7. AI design and why
8. Evaluation methodology + results
9. Observability / performance
10. ADRs / important decisions
11. Real-world dogfooding lessons
12. What I intentionally did not build
13. Limitations
14. What I would build next
```

Do not fabricate metrics.

Only use measured results once we have them.

---

# 33. MANUAL BASELINE

Use language like this as a starting point, but do not present invented numbers as facts:

> After a group event, friends often exchange photos manually across multiple chats and camera rolls. Gatheroll explores whether event context and visual similarity can reduce that workflow to a QR scan, one broad photo selection, and a privacy-aware confirmation step.

When we dogfood the app, replace vague claims with real observations.

---

# 34. DEVELOPMENT PLAN

The goal is to have a portfolio-ready version in approximately **4 weeks**, then deepen it if useful.

## PHASE 1 — SHIP IN 4 WEEKS

### Week 1 — Foundation + deployment

Build:

```text
repository structure
Next.js frontend
FastAPI backend
Postgres
R2 integration skeleton
Docker backend
GitHub Actions skeleton
deploy empty/skeleton frontend
deploy empty/skeleton backend
health check
initial schema/migrations
README problem statement
```

Study/understand:

```text
HTTP request/response
REST
FastAPI routing
Pydantic
database relationships
migrations
object storage
presigned URLs
browser file APIs
```

The application should be deployed early even before it does anything useful.

---

### Week 2 — Working shared album without sophisticated AI

Build:

```text
create event
QR/share link
join without signup
participant identity
multi-photo selection
client-side thumbnail generation
photo upload
partial upload retry
album view
basic event lifecycle
```

Keep this week focused.

Do not automatically add:

```text
Web Worker
OffscreenCanvas
streaming ZIP
complex HEIC support
Redis
```

unless measurements show they are needed.

Dogfood once with at least one other person.

Start golden dataset collection.

---

### Week 3 — Core AI + evaluation

Build:

```text
metadata extraction
timestamp baseline
timestamp + GPS baseline
image embeddings
event visual similarity
event relevance score
event / review / exclude decisions
privacy review UX
basic photo categories
golden dataset
evaluation harness
```

Study:

```text
EXIF
Haversine distance
embeddings
CLIP/SigLIP
cosine similarity
precision
recall
false positives
threshold tuning
classification
multi-label classification
```

Do not use a model without understanding what its representation/output means.

---

### Week 4 — Production + portfolio readiness

Build/refine:

```text
failure states
rate limits
file limits
event expiration
Sentry
pipeline timing
model/scoring versioning
small CI regression eval
dogfood again
performance measurements
README
architecture diagram
demo GIF
portfolio case study
```

At the end of Week 4 the project must be able to stand on its own as a portfolio project.

---

# 35. OPTIONAL DEPTH AFTER V1

Only if the MVP is already strong:

```text
background job queue
SSE processing progress
moment clustering
cross-camera moments
full evaluation suite
larger golden dataset
browser worker optimizations
better HEIC handling
ZIP download
App Clip exploration
optional accounts
```

Do not sacrifice the core product to add these.

---

# 36. HOW I WANT YOU TO WORK WITH ME

This is important.

I am using coding agents, but I want to understand the project myself.

When introducing a new technology or architectural pattern:

1. Tell me what problem it solves.
2. Explain how it works at a practical level.
3. Explain why it is appropriate here.
4. Mention the simplest meaningful alternative.
5. Mention the main failure mode or tradeoff.

Do not over-explain trivial syntax.

Focus learning on architectural and computer-science concepts I should know as a Product Engineer.

If I ask you to implement something, implement it, but make the code understandable.

Avoid clever abstractions that make a small project harder to reason about.

Prefer explicit, readable code.

---

# 37. CODING PRINCIPLES

Use:

```text
clear types
small functions
explicit schemas
consistent naming
structured errors
tests for important logic
environment variables
safe secret handling
migrations
reasonable logging
```

Avoid:

```text
giant files
magic numbers
untyped JSON
hidden global state
premature abstractions
unnecessary frameworks
copy-pasted generated code I cannot understand
```

Any AI thresholds, scoring weights, or model identifiers should eventually live in versioned configuration rather than scattered magic constants.

---

# 38. SECURITY / PRIVACY

Photos are sensitive user data.

Treat this seriously even though this is a portfolio project.

Think about:

```text
private R2 buckets
short-lived presigned URLs
random high-entropy share/manage tokens
authorization on event resources
file type validation
file size limits
rate limiting
event expiry
deleting rejected/expired originals
avoiding public object URLs
avoiding raw secret tokens in logs
```

Do not add enterprise security complexity, but do not build obviously unsafe photo sharing.

---

# 39. CURRENT PRIORITY ORDER

Do not invert this:

```text
1. Clear product problem
2. Deployed foundation
3. Working shared album without AI
4. Golden dataset
5. Event relevance AI
6. Privacy review UX
7. Evaluation
8. Production reliability
9. Observability
10. Categories
11. Moment clustering
12. Everything else
```

Feature count is not the success metric.

---

# 40. FIRST TASK

The folder is empty.

Start by doing ONLY the foundation work necessary to make the project easy to build incrementally.

Before changing files, briefly inspect the environment and propose a minimal repository structure.

I expect something roughly like:

```text
gatheroll/
├── apps/
│   ├── web/
│   └── api/
├── docs/
│   └── adr/
├── .github/
│   └── workflows/
├── README.md
└── ...
```

but choose the exact structure based on simplicity.

Then:

1. Initialize the repository.
2. Create the Next.js TypeScript frontend.
3. Create the FastAPI backend.
4. Add a `/health` endpoint.
5. Add minimal local development instructions.
6. Add Docker support for the backend.
7. Add lint/test/type-check skeletons.
8. Create the initial README with:

   * Gatheroll one-liner
   * problem
   * current workflow
   * product hypothesis
   * current planned architecture
   * project principles
9. Create the first ADR:

   * Web first vs native/App Clip.
10. Do NOT implement AI yet.
11. Do NOT implement Redis, pgvector, authentication, R2, or complex image processing yet unless required for the bare skeleton.
12. Leave the repository in a clean, runnable state.

At the end, tell me:

* what you created
* how to run frontend/backend locally
* the request flow between them
* the important architectural decisions made
* what I should understand before we start the next feature
* what the next smallest vertical slice should be

Remember: **Gatheroll is a portfolio project. Every major technical choice should either improve the product, improve production quality, or teach/show an important Product Engineer concept.**
