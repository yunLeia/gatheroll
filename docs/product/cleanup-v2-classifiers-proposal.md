# Pre-upload Cleanup v2 — screenshot/selfie classifiers, evaluated

> **Second correction (2026-09-09), superseding the one below:** ADR 008's
> "upload is sharing, no confirmation step" is itself being reversed — see
> §4 and §5. Storage completion and album visibility are separate states;
> a participant must explicitly confirm before anything becomes visible to
> the host or other participants. ADR 009's one-album-for-everyone read
> contract is unaffected. Nothing in `apps/api` changed yet; this is a
> proposal for ADR 010 to formalize.

> **First correction (2026-09-08, ADR 008), now itself superseded above:**
> uploading selected photos is the sharing action for the event; no
> separate post-upload sharing confirmation is required. See
> [ADR 008](../adr/008-upload-is-event-sharing.md) /
> [ADR 009](../adr/009-shared-event-album.md) for the historical record of
> that decision.

2026-09-08 (evaluation), revised 2026-09-09 (state model). Proposal only —
evaluation is real and complete; **no production code has been wired in.**
Nothing in `apps/api` or the live intake flow changed. Per direction: wait
for approval before wiring anything into production.

## Why this, why now

Screenshot and selfie detection have existed only as offline research
comparisons since report 006/007 (docs/reports/006, 007) — real accuracy
numbers existed for screenshot, but selfie was never run against the full
labeled set, and neither was ever wired into the app. This proposal:
evaluates selfie properly for the first time, fixes a real methodology bug
that was making SigLIP2 look far worse than it is, designs an interpretable
hybrid for screenshot (not a black-box ensemble), and proposes the smallest
production architecture that fits the existing privacy contract.

Per direction, this explicitly does **not** put SigLIP2 alone in charge of
screenshot detection — screenshot stays a hybrid of visual + metadata
evidence, blur and exact-duplicate stay exactly as they are (deterministic,
untouched), and selfie only gets a production recommendation because it was
actually evaluated, not assumed.

## 1. Selfie evaluation — full results

**Real 49-photo labeled set** (`eval_data/cleanup-manifest.json`): 17
selfies, 32 non-selfies.

| Technique | Undecodable | TP | FP | FN | TN | Precision | Recall | FPR |
|---|---|---|---|---|---|---|---|---|
| Face-geometry heuristic (OpenCV Haar Cascade) | **15/49 (30.6%)** | 1 | 1 | 16 | 31 | 0.50 | **0.06** | 0.03 |
| Face-geometry, decodable-only (n=34) | — | 1 | 1 | 9 | 23 | 0.50 | **0.10** | 0.04 |
| SigLIP2 zero-shot, 3-way prompts (original) | 0/49 | 17 | 31 | 0 | 1 | 0.35 | 1.00 | **0.97** |
| **SigLIP2 zero-shot, 5-way prompts (fixed)** | **0/49** | **17** | **0** | **0** | **32** | **1.00** | **1.00** | **0.00** |

**HEIC/undecodable count:** the face heuristic can't decode 15 of 49 real
photos at all — `cv2.imread()` has no HEIC codec, a systematic limitation
(matches report 006's earlier note), not per-file corruption. 7 of those 15
undecodable photos are true selfies the face heuristic can *never* detect
for a reason that has nothing to do with its face-geometry logic. The
existing comparison script (`cleanup-selfie-compare.ts`) silently scores
every undecodable photo as a confident "not a selfie" prediction, which
inflates its apparent true-negative count — the table above reports both
the as-measured number and the decodable-only subset so this doesn't hide
in one blended number.

**Root cause of the original SigLIP2 result (0.35 precision, 0.97 FPR) —
a real methodology bug, not a capability limit:** the original prompt set
(`selfie` / `portrait_by_other` / `group_photo`) had no "none of these"
option. Every one of the 31 false positives was either a **screenshot**
(24) or a **blurry camera photo** (7) — content that isn't a person-photo
at all, forced into the closest of three person-photo labels by
elimination. This is the exact same failure class that already sank the
original screenshot metadata heuristic (see below) — an incomplete label
set, not a bad model.

**Fix:** added two real negative categories to `selfie_zero_shot.py`'s
prompt set — `screenshot` and `other_no_selfie` (scenery/objects/blurry,
no posed subject) — and re-ran. Result: **0 false positives, 0 false
negatives, 49/49 correct.** All 31 previously-misclassified screenshots
and blurry photos now correctly route to their own categories instead of
being forced into "selfie."

**Honesty check on "perfect" — stronger caveat, 2026-09-08:** this is a
**development-set result, not a held-out one.** The prompt set was revised
*after inspecting errors on these same 49 photos*, which is exactly how a
result stops being a fair test — 1.00/1.00 measures "did the fix work on
the photos that motivated the fix," not "does this generalize." n=49 with
only 17 positives compounds that: a single new misclassification on a
larger or more diverse set (more people, devices, settings) would move
these numbers a lot.

**Safeguard, per direction:** the prompt set (`selfie_zero_shot.py`) is now
**frozen** — a comment marks it and explains why. It must not be tuned
further against this 49-photo set. Before any further change, a separate,
not-yet-created holdout set (~15-25 unseen photos) needs to exist and the
frozen classifier re-run against it unchanged. Growing/holding out that
set remains real, unfinished work — this proposal's production-slice
recommendation below does **not** wait on it, per direction, but the
accuracy claim above should be read as "promising on development data,"
not "validated."

**Recommendation:** SigLIP2 zero-shot (5-way prompts) for selfie, no
hybrid — unlike screenshot, no metadata signal exists for "is this a
selfie" the way format/EXIF exists for "is this a screenshot," so there's
no comparably strong second signal to combine it with. Face-geometry
heuristic is not competitive on this evidence (10-30x worse recall,
systematically blind to a third of real photos) and is not recommended for
production.

## 2. Screenshot — hybrid design + evaluation

**Design principle (as directed): agreement raises confidence, disagreement
stays reviewable — an interpretable rule, not a trained ensemble.**

`apps/web/features/cleanup/screenshot-hybrid.ts` (written, tested, **not
wired into any live path**):

```ts
hybridScreenshotDecision(visual, metadata) →
  { decision: "screenshot" | "camera_photo" | "uncertain", evidence: string[] }
```

- `visual === "screenshot"` AND metadata supports (PNG format) → confident `"screenshot"`
- `visual === "camera_photo"` AND metadata doesn't support → confident `"camera_photo"`
- Anything else (disagreement) → `"uncertain"` — reviewable, never guessed
- `evidence` always records what each signal actually said, for explainability

Metadata is evidence, not a gate: unlike the legacy `isLikelyScreenshot()`
(still unchanged, still used pre-upload client-side), this never requires
an exact device-dimension match — that hardcoded list is exactly what
produced 0% recall on real screenshots in report 007 (real resolution
1206×2622 wasn't in the list). PNG format is the metadata signal that
generalizes.

**Real 49-photo labeled set, three techniques:**

| Technique | TP | FP | FN | TN | Uncertain | Precision | Recall | FPR |
|---|---|---|---|---|---|---|---|---|
| Metadata heuristic only (`isLikelyScreenshot`, current shipped logic) | 0 | 0 | 24 | 25 | — | n/a | **0.00** | 0.00 |
| SigLIP2 visual only | 24 | **4** | 0 | 21 | — | 0.857 | 1.00 | 0.16 |
| **Hybrid** | **24** | **0** | **0** | **21** | **4** | **1.00** | **1.00** | **0.00** |

The hybrid's 4 "uncertain" photos are exactly SigLIP2's 4 false positives —
all real HEIC camera photos it misread as screenshots. Metadata (format:
`image/heic`, not PNG) correctly disagreed with the visual signal on all
4, so the hybrid routes them to review instead of a silently-wrong
"screenshot" verdict. **On this dataset, format alone (PNG vs. not) also
happens to be a perfect discriminator** — every real screenshot is PNG,
every real camera photo isn't. That's a real, useful finding, but also a
reason for humility: this dataset doesn't contain the edge cases the
original proposal already named as real risks (a camera/editing app that
exports PNG; a screenshot re-saved as JPEG by a sharing app) where format
alone would be wrong and the visual signal is what would actually save
the decision. The hybrid is the right shape for robustness the current
data doesn't yet have any occasion to prove.

**Recommendation:** ship the hybrid, not either signal alone. Keep the
existing `isLikelyScreenshot()`/`DEFAULT_SCREENSHOT_CONFIG` exactly as
they are for now — they still run pre-upload as one of the hybrid's two
inputs.

## 3. Blur and exact-duplicate — unchanged, as directed

- Blur: `computeBlurScore` (Laplacian variance) and `blur_threshold: 100`
  untouched. No new evaluation run against it in this proposal — none
  requested, and the existing real numbers (report 007: 100% recall / 61.5%
  precision at this threshold) stand as-is.
- Exact duplicate: SHA-256 content hash, client-side, pre-upload,
  deterministic. Untouched. `alreadyUploadedIds()` (added this session for
  the cross-batch gap) is unrelated and also untouched here.

## 4. State model: Selected → Review → Shared (revised 2026-09-09)

**Correction, same day as ADR 008/009:** an earlier draft of this section
assumed post-upload classification necessarily lands after a photo is
already shared, because ADR 008 equated upload completion with sharing.
Direction received: that coupling is itself what needs revisiting, not a
constraint to design around. Storage completion and album visibility are
two separate, independently-tracked states — the sections below (and §5,
the required ADR changes) implement that correction.

**User-facing lifecycle — exactly three states, no other name for a
photo's state is ever shown to a participant:**

- **Selected** — client-side, before any network call. Nothing has left
  the browser.
- **Review** — sharing is in progress. Bytes may already be uploading or
  fully uploaded to private storage; blur/duplicate suggestions appear
  immediately (client-computed, unchanged); selfie/screenshot suggestions
  appear as async server analysis finishes. The participant can inspect
  every flagged thumbnail and exclude any of them. **Nothing is visible to
  the host or other participants yet.**
- **Shared** — the participant has explicitly confirmed. Only the
  confirmed (non-excluded) photos become visible in the album.

**Internal states (never shown to a user as such):**

- Storage — `Photo.status`: `pending_upload` → `uploaded_private`.
  Unchanged in meaning from today. Describes whether bytes exist in R2.
  Nothing about this name or value is user-facing.
- Publication — **new**: `Photo.shared_at: timestamp | null`. `NULL` = not
  visible to anyone but the uploader (whether never-confirmed, or
  confirmed-then-later-hidden). A set timestamp = visible in the album.
  **This is the only field the album's read query should gate on** —
  storage completion alone must no longer imply album membership.

A photo sitting at `status = uploaded_private` (bytes safely stored) while
`shared_at IS NULL` (invisible to everyone else) for as long as the
participant is still in Review is the intended, central mechanism here —
not a bug to eliminate the way ADR 008 treated it.

**Bounded wait, not a hard gate:** Review requests the photo's
classification status; if `classified_at` isn't set within a short window
(proposed ~8s — the measured ~200ms/image inference cost times a generous
margin for queueing) the UI shows whatever's ready and lets the
participant proceed regardless. Share is never blocked on classification
finishing. If classification finishes *after* Share, the result still
attaches to the now-shared photo and remains actionable — un-setting
`shared_at` is the same "hide from album" action whether it happens before
or after the initial Share, so no separate post-share suggestion concept
is needed.

**Scope correction from the previous draft:** that draft also proposed
storing `content_hash` server-side to support cross-participant duplicate
detection in the album. Not part of this slice — the Review step only
needs to compare a participant's own current selection against their own
in-flight batch, which the client already does today with no server
changes. Cross-participant duplicate detection stays exactly where
`docs/STATUS.md` already had it: explicitly deferred.

## 5. What has to change in ADR 008 and ADR 009

Both were accepted the same day, before this correction. ADR 009's read
contract (one album endpoint for host + participants, pagination, signed
URLs, original/download links) is unaffected and stands. What changes is
the piece that equates storage completion with sharing.

**ADR 008 ("Upload is the event-sharing action") — the central decision
is reversed, not refined:**

| | ADR 008 as accepted | Needed change |
|---|---|---|
| Decision | "Participants select photos and complete upload to share them with the event. There is no separate post-upload confirmation or private staging review step." | Uploading stores bytes; it is not the sharing action. A participant must explicitly confirm (**Shared**) before a photo becomes visible to anyone else. |
| Consequences | "post-upload classification cannot prevent a photo from being shared on upload" | Post-upload classification *can* inform Review before Share, and remains actionable (hide-from-album) after Share — it still never auto-excludes either way; that principle was never actually in question, only the timing was. |
| Framing | The private-staging/confirmation alternative "was explicitly rejected as the product rule." | That rejection is what's being overturned by this direction. Worth stating plainly rather than quietly reintroducing the same shape under a different name. |

**ADR 009 ("One event album...") — one query condition changes:**

| | ADR 009 as accepted | Needed change |
|---|---|---|
| Album membership filter | `Photo.status == PhotoStatus.UPLOADED_PRIVATE` is the sole condition (`album.py`: `list_album`, `original`) | Add `Photo.shared_at IS NOT NULL` as a second required condition — storage alone no longer implies membership. |
| Existing uploaded photos | "Completed uploads, including existing ones, are event contributions under the corrected upload-is-sharing rule." | Needs an explicit decision: backfill `shared_at = uploaded_at` for every photo already uploaded under the old (now-reversed) rule, so nobody loses visibility of what was genuinely already shared at the time. Leaving them un-shared would silently hide real content — backfilling is almost certainly correct, but it's a real migration decision, not a no-op. |

**Recommendation:** write this as a new ADR (010) that supersedes 008 and
amends 009's read contract, rather than editing the accepted 008/009 files
directly — 008/009 were real decisions at the time; 010 is the correction,
same pattern this project already uses (ADR 007 superseding earlier
direction). Not written yet — this table is what 010 would need to say;
confirm before I draft it as a file.

## 6. Data model

As directed, these are cleanup-pipeline outputs, not the later
smart-filter album categories (people/food/scenery/candid/selfie-as-a-
browsing-category) — different product purpose, different lifecycle,
should never share a column or a type:

```
-- publication (new, see §4 — the actual mechanism this whole
-- revision is about)
shared_at: timestamp | null

-- cleanup signals (async-classified)
is_screenshot: boolean | null       # null = not yet classified
screenshot_decision: "screenshot" | "camera_photo" | "uncertain"
screenshot_evidence: string[]       # explainability trail, e.g.
                                     #   ["visual classifier: screenshot",
                                     #    "format: image/png (supports screenshot)"]
is_selfie: boolean | null
selfie_evidence: { selfie: number, portrait_by_other: number,
                    group_photo: number, screenshot: number,
                    other_no_selfie: number }  # raw zero-shot scores
classified_at: timestamp | null
```

`blur_score` / `possibly_blurry` stay exactly as they are today —
client-computed `PhotoInput` fields, not server-stored, since Review's
blur/duplicate suggestions are entirely client-side and need no server
round-trip.

## 7. Inference/runtime placement — measured, not guessed

**Latency (this dev machine, CPU, no GPU — the conservative case for a
typical small production VM, which also likely has no GPU):**

| | value |
|---|---|
| Model load (cold) | ~3-5s (varied across runs) |
| Per-image inference, n=1 | 417ms |
| Per-image inference, n=10 (avg) | 274ms |
| Per-image inference, n=30 (avg) | 220ms |
| Checkpoint size on disk | 1.4 GB |

**Memory (`eval/cleanup/measure_memory.py`, `measure_memory_growth.py` —
throwaway measurement scripts, not part of the eval CLI):**

| | RSS |
|---|---|
| Before any ML imports | 17 MB |
| After importing torch/transformers/PIL | 302 MB |
| After model load | 551 MB |
| After 30 images | 1,078 MB |
| **Peak during inference** (sampled + `ru_maxrss` cross-check) | **1,325 MB** |
| Extended run, 200 images (10 real files cycled) | oscillates 787-1,272 MB — **no unbounded growth**, allocator caching + GC, not a leak |

**Multi-worker implication — the finding that actually changes the
recommendation:** model state doesn't share across OS processes. If
inference runs inside the same process pool as the API's request-handling
workers, **each worker independently duplicates the full ~550MB-1.3GB**. A
typical 4-worker API deployment would carry 2.2-5.2GB just for model
memory — likely exceeds a small/cheap production instance entirely.

**Revised recommendation:** don't embed inference in the API's own
multi-worker pool. Run it as **one separate, single-instance process** —
still zero new infra (not Redis, not Celery, no queue — just a second
long-running Python process, the same way `apps/api` and `apps/web` are
already two separate processes today), called via a plain internal HTTP
request from `apps/api`'s `BackgroundTask`. Load the model once at that
process's startup, not per-request. None of the measured numbers justify
Redis/a queue/a vector DB at this scale; if load time or latency becomes a
real problem under real traffic (evidence-gated, same principle this
project already follows elsewhere), that's the trigger to revisit — not a
default.

**Do not run this in the mobile browser.** 1.4 GB and a real
vision-language model are far outside what this project has been willing
to spend client-side even for much cheaper checks (the brief itself
resists adding a Web Worker "unless measurements show it's needed" for
work orders of magnitude lighter than this).

**HEIC:** the server-side classification path needs **no new HEIC
handling**. `pillow_heif.register_heif_opener()` (already used in both
eval scripts) decoded all 49 real HEIC photos in both the selfie and
screenshot runs — 0 undecodable in either. This is a different codepath
than the frontend's `sharp`/libvips limitation (15/15 real HEIC files
failed there, worked around with a `sips` eval-only bridge) and the
face-heuristic's OpenCV limitation (15/49 failed) — Python's `PIL` +
`pillow-heif` simply doesn't share those gaps. No server-side HEIC
conversion needs to be added.

## 8. Smallest production slice (proposed sequence, not built)

1. Write ADR 010 (see §5) — supersedes 008, amends 009's album query.
   Decide and record the backfill question (existing uploads get
   `shared_at = uploaded_at`) as part of it, not as an afterthought.
2. Migration: add `shared_at` + the five classification columns to
   `Photo`. Backfill `shared_at` for existing `uploaded_private` rows per
   ADR 010's decision.
3. `apps/api`: `album.py`'s `list_album`/`original` queries add
   `Photo.shared_at IS NOT NULL` alongside the existing status check.
4. Stand up the single-instance classification process (§7); `apps/api`
   schedules a `BackgroundTask` after `/complete` that calls it, writes
   the five result columns + `classified_at`.
5. New endpoint/action: participant confirms Share for their reviewed
   selection → sets `shared_at = now()` on the confirmed (non-excluded)
   photos. This is the one truly new piece of product surface — nothing
   like it exists today (upload and share were the same action until this
   correction).
6. Review UI: shows blur/duplicate immediately, polls/waits up to ~8s for
   `classified_at`, shows Selfie/Screenshot/Possibly blurry/Possible
   duplicate as independent, explainable groups per §6 of the original
   selfie/screenshot design; each flagged thumbnail gets an inspect +
   exclude toggle before Share, and remains toggleable after Share too
   (un-setting `shared_at`).
7. Replace `"Stored privately · Unreviewed"` (`intake-panel.tsx`) — it
   names the internal storage state directly, exactly the pattern this
   correction rules out. Not just a string swap: the section's actual
   meaning changes under this model, from "list of confirmed uploads" to
   "what's in Review vs. what's Shared." Target copy to design against in
   the later UX pass, not fixed inline here.

## 9. Tests

Written and passing now (62/62 in `apps/web`, evaluation-layer only, no
production path touched):
- `hybridScreenshotDecision`: agreement → confident in both directions;
  disagreement → uncertain in both directions; evidence trail is populated
  and includes both signals (`apps/web/tests/cleanup.test.mjs`).
- Existing `isLikelyScreenshot`/blur/duplicate/suggestions tests untouched
  and still passing.

Not yet written (blocked on the `apps/api`/migration work above, which
doesn't exist yet — Codex's build once ADR 010 and this proposal are
approved): Python unit tests for the ported hybrid decision, the
classification process, the album query's new `shared_at` condition, and
the new confirm-Share endpoint (including: nothing becomes visible without
it, existing-upload backfill is correct, late-arriving classification
after Share still attaches and remains toggleable).

## 10. What's intentionally deferred

- Wiring any of this into `apps/api` or the live intake/upload flow.
- ADR 010 itself, the migration, and all six new columns.
- The confirm-Share endpoint and the Review-screen UI.
- Growing the labeled set beyond n=49 (still real, unfinished work) — see
  the frozen-prompt safeguard in §1.
- A separate inference microservice beyond the one single-instance process
  proposed in §7, Redis/Celery/Upstash, a vector DB — none justified by
  the numbers measured here.
- Cross-participant duplicate detection / server-side `content_hash`
  storage — considered and explicitly scoped back out in §4; stays
  deferred where `docs/STATUS.md` already had it.
- Album smart-filter labels (people/food/scenery/candid) — a different
  system with a different purpose; not touched or conflated with these
  cleanup signals.
- Blur threshold changes — none made; existing real numbers stand.
- Bulk download — separate request, not part of this slice.
