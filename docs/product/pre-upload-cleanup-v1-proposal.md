# Pre-upload Cleanup v1 — technical proposal (not yet implemented)

> **Update, 2026-09-08 (same day):** v1 shipped (blur, screenshot metadata
> heuristic, exact duplicate, selfie offline comparison) — see
> `docs/STATUS.md`. Screenshot and selfie's *production* direction has
> since moved on: see
> [cleanup-v2-classifiers-proposal.md](cleanup-v2-classifiers-proposal.md)
> and [report 008](../reports/008-cleanup-v2-classifiers-evaluation.md) for
> the real selfie evaluation (never completed here) and the screenshot
> hybrid design. This document's blur/duplicate sections and its
> cross-cutting design principles still stand.

2026-09-08. Proposal only, per [ADR 007](../adr/007-cleanup-first-ai-direction.md).
No code written against this yet — pending approval. Three sub-problems, each
gets its own simplest-fit technique; nothing here forces one model onto all
three.

## Cross-cutting design

- All three detectors are **suggest-only**: they flag candidates for review;
  the participant makes the final include/exclude decision. Nothing is
  auto-removed. This matches the existing "uploaded ≠ shared" and preference-
  storage-without-enforcement posture already in the codebase.
- All three run **client-side, before upload**, where feasible (see per-task
  verdict below) — matches the product story ("pre-upload cleanup") and
  avoids sending photos anywhere before the participant has decided to
  upload them at all, consistent with the existing privacy architecture
  ([ADR 004](../adr/004-private-photo-intake-lifecycle.md)).
- Evaluation reuses the *pattern* from the relevance-embedding work (a small
  labeled dataset + deterministic scoring + metrics/CSV/error reports), not
  its code — this needs a **new, simpler per-photo schema** (`is_selfie`,
  `is_screenshot`, `is_blurry`: boolean or ordinal, no event/participant
  grouping needed at all, since these are single-photo properties, not
  cross-photo comparisons). See [ADR 007](../adr/007-cleanup-first-ai-direction.md)'s
  branch-disposition section for why the relevance dataset shape doesn't fit.

## 1. Screenshot detection

**Simplest suitable technique: deterministic metadata heuristic, no model.**
A screenshot is distinguishable from a camera photo almost entirely by file
properties, not visual content:
- File format: iOS/Android screenshots are saved as PNG; camera photos are
  JPEG/HEIC/HEIC almost universally. Format alone is a strong signal.
- Dimensions: screenshots exactly match a device's screen resolution in
  pixels (an enumerable, if large, set for iOS; more fragmented for Android
  but still a recognizable class — round numbers, common aspect ratios like
  9:19.5, 9:20).
- EXIF: screenshots have no camera EXIF (no `Make`/`Model`/`DateTimeOriginal`
  from a lens); camera photos almost always do.

Combine as: `PNG format AND (no camera EXIF OR dimensions match a known
device-screen list)` → flagged. This reuses the EXIF extraction already
built in `apps/web/features/photos/metadata.ts` and the format/dimension
checks already touched in `selection.ts` — no new dependency.

**SigLIP2 useful here? No.** This is a metadata classification problem, not
a visual understanding problem. A vision-language model would be strictly
more expensive and less interpretable than a format/EXIF check for the same
result.

**Browser or backend?** Browser, at selection time — the same moment
`prepare.ts` already extracts EXIF for the intake flow. Zero new runtime
cost.

**Evaluation:** label a small set of real photos as screenshot/not-screenshot
(should be easy and fast — this is usually visually obvious to the human
labeler too), measure precision/recall of the format+EXIF heuristic.
Expect very high precision, since the format signal alone is close to
deterministic for genuine device screenshots.

**False-positive risk:** low, but not zero — a camera app or photo editor
that exports PNG (some Android camera apps, screenshot-editing round-trips,
messaging apps that re-encode as PNG) would false-positive. A screenshot
re-saved as JPEG by a sharing app would false-negative (miss it) rather than
false-positive — worth naming as a known recall gap, not a precision risk.

## 2. Selfie detection

**Simplest suitable technique: lightweight on-device face detection**
(presence, size, and centering of face(s) in frame), not a general vision-
language model. Selfies have a distinctive, learnable geometric signature
(arm's-length framing: one or more faces occupying a large fraction of the
frame, roughly centered, camera-facing) that a small dedicated face detector
captures directly, without needing open-vocabulary image understanding.

**Is SigLIP2 actually useful here?** Possibly, but not established, and not
as the primary technique — this is the one sub-problem worth *testing*
SigLIP2 against rather than assuming either way. Proposal: ship the face-
detection heuristic as the real, in-browser technique, and separately run a
one-time **offline comparison** — SigLIP2 zero-shot classification (image
embedding vs. a text prompt like "a selfie photograph") against the same
labeled set, using the *pattern* already proven in the relevance-embeddings
work (Python local embedding generation, TypeScript scoring/metrics) — to
answer empirically whether the extra weight buys meaningfully better
precision/recall than the cheap face detector. If it doesn't, that's a
concrete, evidence-based reason not to add the dependency for this task;
if it does meaningfully better on a specific failure class (see false-
positive risks below), that's a concrete reason to consider it later. Not
proposing to ship SigLIP2 in the browser or as a production path for this
sub-problem regardless of the outcome — only as an offline evaluation
comparison.

**Browser or backend?** Browser, via a small (order of 1 MB, real-time)
WASM/TF.js-style face-detection model — this class of model is designed for
exactly this (on-device, no server round trip). The SigLIP2 comparison
baseline stays offline/Python, evaluation-only, same as the existing
harness's Python step never being a production path.

**Evaluation:** label a small real set (selfie / not-selfie) — reuse the
~30–50-photo scale already established for this kind of work. Score both
the face-detection heuristic and the SigLIP2 zero-shot baseline through the
new per-photo eval schema; compare precision/recall/false-positive rate.

**False-positive risk:** the most likely failure class is a close-up
*portrait of someone else*, taken by another person — indistinguishable
from a selfie by framing alone without knowing who's behind the camera; no
technique proposed here can resolve that ambiguity, so it should be named as
a known limitation, not solved. Multi-person "group selfies" are a **false-
negative** risk instead: a naive "one large centered face" heuristic can
miss them, so the detector should trigger on "one or more faces, collectively
large and roughly centered," not strictly one face.

## 3. Blur / low-quality detection

**Simplest suitable technique: Laplacian-variance sharpness scoring** — a
decades-old, well-validated, purely signal-processing technique. Convert to
grayscale, compute the image Laplacian (an edge-detection operator), take
its variance: a sharp photo has many strong edges (high variance); a blurry
one has few (low variance). No model, no training, no labels required to
*compute* it — only to *calibrate a threshold*.

**Is SigLIP2 useful here? No**, not remotely the right tool — blur is a
low-level pixel-statistics property, and a large vision-language embedding
model would be slower, less interpretable, and no more accurate than a
sharpness metric purpose-built for exactly this.

**Browser or backend?** Browser — draw the image to an offscreen canvas
(already happening for thumbnail generation in `prepare.ts`), read pixel
data, compute grayscale + Laplacian variance in a Web Worker to avoid
blocking the main thread, matching the existing thumbnail-generation
pattern's use of a worker-friendly, one-image-at-a-time approach.

**Evaluation:** label a small real set as blurry/sharp (or a coarse 3-point
scale if binary feels too coarse), compute the Laplacian-variance score for
each, sweep a threshold, measure precision/recall — same reusable pattern
as the other two.

**False-positive risk:** the real failure classes are photos that are
*correctly* low-edge-variance without being quality defects — intentional
shallow-depth-of-field/bokeh shots, low-detail scenes (a plain wall, open
sky, calm water), and deliberate motion-blur artistic shots. A flat "low
variance = blurry" rule will flag these. The threshold needs calibration
against real, varied examples (not just genuinely-blurry ones) before
shipping even as a suggestion, and the UI framing should stay "possibly
blurry" rather than a confident claim, given this known false-positive
class.

## Summary table

| Sub-problem | Technique | Model? | Where it runs | SigLIP2 role |
|---|---|---|---|---|
| Screenshot | Format + EXIF heuristic | None | Browser | Not applicable |
| Selfie | Face detection (presence/size/centering) | Small on-device face detector | Browser | Offline comparison baseline only, not shipped |
| Blur | Laplacian variance | None | Browser | Not applicable |

No backend/model service is proposed for v1. Nothing here implements event
relevance, clustering, album classification, pHash/near-duplicate detection,
external vision APIs, or download ZIP infrastructure — all remain explicitly
out of scope per this task's boundary.

## What's next, pending approval

If this technique selection looks right, the next step is a full TDD
implementation plan (file-by-file, in the style already used for prior
slices) covering: the new per-photo eval dataset schema, the three detector
implementations (metadata heuristic, face-detection integration, Laplacian-
variance scorer), their wiring into the existing intake flow as a review
step, and the labeled evaluation set needed to calibrate thresholds before
shipping even suggestion-only behavior. Not written yet — waiting on this
proposal's approval first, per instruction.
