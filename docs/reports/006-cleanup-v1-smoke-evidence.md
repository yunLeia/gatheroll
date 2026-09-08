# 006 — Pre-upload Cleanup v1: implementation + smoke evidence

2026-09-08. Implements
[docs/product/pre-upload-cleanup-v1-proposal.md](../product/pre-upload-cleanup-v1-proposal.md)
and [ADR 007](../adr/007-cleanup-first-ai-direction.md).

**This report records what was actually run and observed while building the
four detectors — plumbing/smoke verification, not accuracy metrics.** No
real precision/recall for blur/screenshot/selfie exists yet: that needs the
labeled fixtures described in
[docs/eval/003-cleanup-v1-experiments.md](../eval/003-cleanup-v1-experiments.md),
which have not been collected. Nothing here should be read as a measured
production result.

## What was built

Four signals, in dependency order: blur scoring (Laplacian variance),
screenshot detection (format/EXIF heuristic), a selfie-detection comparison
(OpenCV Haar Cascade vs. SigLIP2 zero-shot, both pretrained baselines, both
offline-only), and exact-duplicate detection (SHA-256 content hash). Full
design in the proposal doc; implementation across
`apps/web/features/cleanup/`, `apps/web/evaluation/cleanup-*`, and
`eval/cleanup/`.

## Blur — smoke evidence

Synthetic images generated with `sharp` (a solid gray 200×200 image vs. a
200×200 random-noise image), run through `npm run eval:cleanup --
--detector blur --sweep`:

| photo | label | blur_score |
|---|---|---:|
| flat (solid gray) | blurry | 0 |
| noisy (random noise) | sharp | 51,226.99 |

Correctly classified at every swept threshold (20 through 500) — an
extreme, deliberately unambiguous synthetic case, not evidence about real
photos. Confirms the pipeline (canvas/`sharp` decode → Laplacian variance →
threshold decision → CSV/sweep output) works end to end.

## Screenshot — smoke evidence

Synthetic images: a 1170×2532 PNG (a known iPhone screenshot resolution) vs.
a 4032×3024 JPEG (a typical camera photo resolution), run through
`--detector screenshot`: both correctly classified (precision/recall 1.0 on
this n=2 synthetic pair — again, not evidence about real screenshots, which
still need real labeled examples per report 003's own eval guide).

## Selfie — smoke evidence, and two real limitations found

Ran both baselines against one real local photo (content never inspected or
described beyond the structural output below — consistent with this
project's existing photo-privacy discipline) plus a synthetic blank image
and a real HEIC file:

| technique | input | output |
|---|---|---|
| face_heuristic.py | synthetic blank | `face_count: 0` — correct |
| face_heuristic.py | real JPEG | `face_count: 10`, largest face area ratio **0.12%** |
| face_heuristic.py | real HEIC | `error: "undecodable"` |
| selfie_zero_shot.py | real JPEG | `predicted_label: "selfie"` |

Two things worth documenting as real, observed baseline characteristics
(not hypothetical concerns from the proposal — actually hit):

1. **OpenCV cannot decode HEIC at all.** `cv2.imread` returns `None` for a
   real iPhone HEIC file; handled as a non-crashing `"undecodable"` result,
   never a fabricated detection. Since most real Gatheroll uploads will be
   HEIC, any real evaluation run needs a HEIC→JPEG conversion step first —
   this is a prerequisite, not an edge case.
2. **Default Haar Cascade parameters produced 10 small, low-confidence
   "faces"** on one real photo, none large enough to pass even the smallest
   swept area threshold (0.05) — the largest was 0.0012. This is exactly
   the imprecision this comparison exists to surface, not a bug: it is why
   the proposal frames the face heuristic as "a simple baseline," not a
   production candidate.

Running the comparison CLI (`--detector selfie`) on this one labeled example
(`is_selfie: true`, used only to exercise the plumbing, not a real
evaluation sample): the face heuristic predicted `false` at every swept
threshold (missed it — its detections were all too small/off-center);
SigLIP2 zero-shot predicted `selfie` (correct). **One example proves
nothing about real accuracy** — it's recorded here only as evidence the
comparison mechanism itself produces a meaningful, differentiated result
between the two techniques, which is what Task 6 was built to do.

## Exact duplicates — real measurement (not just smoke)

Unlike the other three, this one has no accuracy question, so a real run
over the actual local photo set is informative on its own terms, not just a
plumbing check:

- A real photo plus a byte-identical copy of it: correctly grouped as one
  duplicate pair; a third, different real photo correctly excluded.
- **Full scan of the local `eval_data/photos/` directory: 169 photos, 0
  exact-duplicate groups found.** Consistent with a personal camera-roll
  export (unlike, say, a messaging app's saved-media folder, which
  commonly accumulates exact re-saved copies) — an honest, measured, if
  small, real-world data point, not a synthetic case.

## Verification

Full frontend quality gate (`npm run lint && npm run typecheck && npm test
&& npm run build`) passed clean after each of the 4 detector tasks; 50/50
tests passing by the end (18 new `cleanup.test.mjs` tests across the four
signals). Python: both `eval/cleanup` scripts run successfully end to end
against real local files (never uploaded/transmitted anywhere); no repo-wide
Python lint config exists for `eval/` yet, so `py_compile`-level sanity was
the only static check applied, and is noted here as a real gap rather than
silently assumed covered.

## What's next

Collect the labeled fixtures in
[docs/eval/003-cleanup-v1-experiments.md](../eval/003-cleanup-v1-experiments.md)
for blur, screenshot, and selfie. Until then: no threshold, model choice, or
browser-vs-backend decision for selfie detection is production-ready — this
report is evidence the *mechanisms* work, not that any of the four signals
is accurate enough to ship.
