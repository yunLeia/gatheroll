# Pre-upload Cleanup v1 — evaluation guide

2026-09-08. Companion to
[docs/product/pre-upload-cleanup-v1-proposal.md](../product/pre-upload-cleanup-v1-proposal.md)
and [ADR 007](../adr/007-cleanup-first-ai-direction.md). Read those first for
*why*; this doc is *how to run each evaluation* and *what real labeled data
each one needs* — none of this has real precision/recall numbers yet (see
[report 006](../reports/006-cleanup-v1-smoke-evidence.md) for what has
actually been measured so far: plumbing/smoke evidence, not accuracy).

## Shared manifest shape

All four signals share one minimal per-photo schema
(`apps/web/evaluation/cleanup-dataset.ts`), deliberately not the
event-relevance `Dataset` shape — these are single-photo properties, not
cross-photo comparisons:

```json
{
  "schema_version": 1,
  "dataset_version": "local-v1",
  "examples": [{
    "photo_id": "p1",
    "source_file": "p1.jpg",
    "notes": "human labeling note, required",
    "is_blurry": true,
    "is_screenshot": null,
    "is_selfie": null
  }]
}
```
Each label is independently nullable — one manifest can carry partial labels
for different experiments; each CLI mode filters to the rows labeled for
its own property.

## 1. Blur

```bash
npm --prefix apps/web run eval:cleanup -- \
  --manifest eval_data/cleanup-manifest.json --root eval_data/photos \
  --detector blur --sweep
```
**Data needed:** ~15-20 clearly sharp + ~15-20 clearly blurry real photos,
`is_blurry` labeled. Note deliberately ambiguous cases (bokeh, low-detail
scenes) in `notes` even though the label itself is binary.
**Output:** `results.json`, `predictions.csv` (per-photo `blur_score` +
prediction), `sweep.csv` (precision/recall/fpr/accuracy at 7 candidate
thresholds). The current `eval/config/cleanup-blur-v1.json` threshold (100)
is a placeholder — replace it with whatever the sweep shows once real labels
exist, not before.

## 2. Screenshot

```bash
npm --prefix apps/web run eval:cleanup -- \
  --manifest eval_data/cleanup-manifest.json --root eval_data/photos \
  --detector screenshot
```
**Data needed:** ~15 real screenshots (iOS and/or Android) + ~15 real camera
photos, `is_screenshot` labeled.
**Output:** `results.json`, `predictions.csv`. No sweep (no continuous
threshold — the heuristic is format+dimension+EXIF, not a score).
**This is the metadata heuristic only.** The proposal's "lightweight visual/
zero-shot approach if needed" is not implemented — only pursue it if this
baseline's measured precision/recall on real screenshots turns out
insufficient.

## 3. Selfie (two pretrained baselines, offline only)

```bash
cd eval/cleanup && source .venv/bin/activate
python3 face_heuristic.py --manifest ../../eval_data/cleanup-manifest.json --root ../../eval_data/photos --out ../../eval_data/face-heuristic-v1.json
python3 selfie_zero_shot.py --manifest ../../eval_data/cleanup-manifest.json --root ../../eval_data/photos --out ../../eval_data/selfie-zero-shot-v1.json
cd ../../apps/web
npm run eval:cleanup -- \
  --manifest ../../eval_data/cleanup-manifest.json --root ../../eval_data/photos \
  --detector selfie --face-artifact ../../eval_data/face-heuristic-v1.json --siglip-artifact ../../eval_data/selfie-zero-shot-v1.json
```
**Data needed:** a small manually reviewed set covering `selfie`,
`portrait_by_other`, and `group_photo` cases, `is_selfie` labeled
true/false (true only for genuine selfies — portraits-by-others and group
photos are both `false` for this binary comparison, even though the SigLIP2
prompts distinguish all three).
**Output:** `comparison.csv` (face-heuristic metrics at 5 swept area
thresholds, SigLIP2 metrics once), `predictions.csv` (both techniques'
predictions per photo). **Both are pretrained baselines being compared, not
models being trained** — no fine-tuning, no gradient updates, no training
loop anywhere in this experiment. Face detection cannot read HEIC files
(see report 006) — convert real iPhone photos to JPEG before running
`face_heuristic.py`, or the affected rows will read `"error":
"undecodable"` and score as zero faces.

## 4. Exact duplicates

```bash
npm --prefix apps/web run eval:cleanup -- \
  --manifest eval_data/cleanup-manifest.json --root eval_data/photos \
  --detector duplicates
```
**Data needed:** none — this needs no labels at all. It's not evaluating a
judgment call; two files with the same SHA-256 are the same bytes.
**Output:** a console report of hash-group counts, no results file (nothing
to score). Near-duplicate detection (pHash/embedding similarity, for
resized/edited/re-compressed copies) is explicitly a separate, deferred
problem — see ADR 007.

## What none of this decides yet

No threshold, model choice, or browser-vs-backend call for selfie detection
is a production decision until real labeled data has actually been run
through the relevant CLI mode above.
