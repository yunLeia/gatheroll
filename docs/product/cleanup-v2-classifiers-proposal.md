# Pre-upload Cleanup v2 — screenshot/selfie classifiers, evaluated

2026-09-08. Proposal only — evaluation is real and complete; **no production
code has been wired in.** Nothing in `apps/api` or the live intake flow
changed. Per direction: wait for approval before wiring these classifiers
into production.

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

**Honesty check on "perfect":** n=49 with only 17 positives is small, and
this set is a limited sample (few distinct people/devices/settings) — a
single new misclassification on a larger or more diverse set would
meaningfully move these numbers. Treat this as strong evidence the
corrected-prompt approach is sound, not proof of production-grade accuracy
at scale. Growing the labeled set remains real, unfinished work
(`docs/STATUS.md`'s existing note).

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

## 4. Data model — new signals, kept separate from album labels

As directed, these are cleanup-pipeline outputs, not the later
smart-filter album categories (people/food/scenery/candid/selfie-as-a-
browsing-category) — different product purpose, different lifecycle,
should never share a column or a type:

```
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

`blur_score` / `possibly_blurry` already exist as client-computed
`PhotoInput` fields (unchanged, not server-stored — matches the existing
architecture). `exact_duplicate_group` is **not** part of this slice:
storing `content_hash` server-side was already explicitly deferred
(`docs/STATUS.md`'s "explicitly still out of scope" list, ADR 007) and
nothing here changes that — duplicate detection stays exactly where it is,
client-side and pre-upload.

## 5. Inference/runtime placement — measured, not guessed

**Measured on this dev machine (CPU, no GPU — the conservative case for a
typical small production VM, which also likely has no GPU):**

- Model load (`google/siglip2-base-patch16-224`, cold): **~5.1s**
- Per-image inference (warm): **~170-210ms**
- Checkpoint size on disk: **1.4 GB**

These numbers directly answer the "measure latency first" requirement:
5 seconds is a real, one-time cost that must not happen per-request (load
once, keep the process warm); ~200ms/photo means a 20-photo batch is ~4s of
CPU-bound work — noticeable, needs to happen off the upload response path,
but nowhere near large enough to justify a queue/broker for a low-traffic
app.

**Do not run this in the mobile browser.** 1.4 GB and a real
vision-language model are far outside what this project has been willing
to spend client-side even for much cheaper checks (the brief itself
resists adding a Web Worker "unless measurements show it's needed" for
work orders of magnitude lighter than this).

**Smallest server-side path (proposed, not built):** run inference
in-process inside `apps/api`, using FastAPI's built-in `BackgroundTasks`
(zero new infra) triggered after `POST /photos/{id}/complete` confirms an
upload. Load the model once at API process startup, not per-request. No
Redis, no Celery/Upstash, no job queue, no vector DB — none of the
measured numbers justify that infrastructure yet. If model load time or
per-photo latency becomes a real problem under real traffic (evidence-
gated, same principle this whole project already follows), splitting
inference into its own small service is the natural next step — not a
default.

**HEIC:** the server-side classification path needs **no new HEIC
handling**. `pillow_heif.register_heif_opener()` (already used in both
eval scripts) decoded all 49 real HEIC photos in both the selfie and
screenshot runs — 0 undecodable in either. This is a different codepath
than the frontend's `sharp`/libvips limitation (15/15 real HEIC files
failed there, worked around with a `sips` eval-only bridge) and the
face-heuristic's OpenCV limitation (15/49 failed) — Python's `PIL` +
`pillow-heif` simply doesn't share those gaps. No server-side HEIC
conversion needs to be added.

## 6. Smallest production slice (proposed sequence, not built)

1. Migration: add the five columns above to `Photo`.
2. `apps/api`: after `/complete`, schedule a `BackgroundTask` that reads
   the original from R2 (server already holds R2 credentials; no new
   access pattern), runs the metadata heuristic (port `isLikelyScreenshot`'s
   inputs, already computable from stored `content_type`/EXIF) + SigLIP2
   inference, combines via a Python port of `hybridScreenshotDecision` for
   screenshot, uses the SigLIP2 label directly for selfie, writes the
   result columns.
3. Expose the signals on the existing photo read paths (participant's own
   list today; host gallery once it exists) as suggest-only data — same
   posture as every other cleanup signal: flagged, never auto-excluded.
4. **Deliberately not built in this slice:** the actual UI where a
   participant reviews these post-upload suggestions and confirms what
   becomes "shared" (`uploaded privately != shared` — that boundary
   doesn't exist anywhere in the schema yet; today everything private
   simply has no shared state at all). That's a real, separate UX/UI
   design decision, explicitly deferred per direction ("let's do the
   UX/UI later").

## 7. Tests

Written and passing now (62/62 in `apps/web`, evaluation-layer only, no
production path touched):
- `hybridScreenshotDecision`: agreement → confident in both directions;
  disagreement → uncertain in both directions; evidence trail is populated
  and includes both signals (`apps/web/tests/cleanup.test.mjs`).
- Existing `isLikelyScreenshot`/blur/duplicate/suggestions tests untouched
  and still passing.

Not yet written (blocked on the actual `apps/api` implementation, which
doesn't exist yet): Python unit tests for the ported hybrid decision and
the classification `BackgroundTask` — that's Codex's build once this
proposal is approved.

## 8. What's intentionally deferred

- Wiring any of this into `apps/api` or the live intake/upload flow.
- The migration and the five new columns.
- The post-upload "review and confirm what's shared" UI — real, needed,
  explicitly UX/UI work deferred per direction.
- Growing the labeled set beyond n=49 (still real, unfinished work).
- A separate inference microservice, Redis/Celery/Upstash, a vector DB —
  none justified by the numbers measured here.
- Server-side `content_hash`/duplicate storage — unrelated to this
  proposal, already deferred elsewhere.
- Album smart-filter labels (people/food/scenery/candid) — a different
  system with a different purpose; not touched or conflated with these
  cleanup signals.
- Blur threshold changes — none made; existing real numbers stand.
