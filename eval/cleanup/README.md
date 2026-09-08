# Cleanup v1: pretrained-baseline experiments, offline only

Scripts here compare **pretrained baselines** for two sub-problems of
[Pre-upload Cleanup v1](../../docs/product/pre-upload-cleanup-v1-proposal.md) —
no training, no fine-tuning anywhere in this directory. Nothing here ships
to the browser or a production path yet; that decision waits on each
comparison's measured precision/recall and (if a technique looks worth
deploying) separate latency/model-size evidence.

## Setup

```bash
cd eval/cleanup
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## HEIC handling

`face_heuristic.py` (OpenCV) **cannot decode HEIC/HEIF at all** — confirmed
on a real labeled set, not hypothetical (see
[report 006](../../docs/reports/006-cleanup-v1-smoke-evidence.md)):
`cv2.imread` returns `None`, handled as `{"error": "undecodable"}`, never a
crash. This is a real, current limitation with no workaround applied yet in
this script.

`selfie_zero_shot.py` and `screenshot_zero_shot.py` (both SigLIP2-based)
**do** handle HEIC, via `pillow_heif.register_heif_opener()` — this makes
`PIL.Image.open()` read HEIC/HEIF transparently, no separate conversion step
needed. Any file that still fails to decode is caught, logged to stderr,
excluded from `results`, and listed in the output artifact's `undecodable`
array — never a fabricated score, never a crashed run.

## Selfie experiment

### 1. Face-geometry heuristic (`face_heuristic.py`)

The simplest baseline: OpenCV's bundled Haar Cascade frontal-face detector
(no separate model download, no GPU). Outputs face count, the largest
face's area as a fraction of the whole image, and whether it's roughly
centered — **not yet a selfie decision**; that threshold is swept later
against labels (`apps/web/evaluation/cleanup-selfie-compare.ts`), not fixed
here.

```bash
python3 face_heuristic.py \
  --manifest ../../eval_data/cleanup-manifest.json \
  --root ../../eval_data/photos \
  --out ../../eval_data/face-heuristic-v1.json
```

Real observed behavior worth knowing before running this for real: default
Haar Cascade parameters can produce many small, low-confidence "faces" on
complex real photos (busy textures/edges) — a real precision risk this
baseline is explicitly expected to have; exactly why it's being compared
against SigLIP2 rather than assumed adequate.

### 2. SigLIP2 zero-shot (`selfie_zero_shot.py`)

Reuses the pretrained-inference pattern from `eval/embeddings/generate.py`
(same checkpoint family, `AutoModel.from_pretrained` in eval mode only) but
for zero-shot **classification**, not embedding generation: an image is
compared against three fixed text prompts (`selfie`, `portrait_by_other`,
`group_photo`) using the model's own image and text encoders.

```bash
python3 selfie_zero_shot.py \
  --manifest ../../eval_data/cleanup-manifest.json \
  --root ../../eval_data/photos \
  --out ../../eval_data/selfie-zero-shot-v1.json
```

### Comparing the two

`apps/web/evaluation/cleanup-selfie-compare.ts` loads both artifacts plus
the manifest's `is_selfie` labels and reports `binaryMetrics` for each
technique side by side — see that file and
[docs/eval/003-cleanup-v1-experiments.md](../../docs/eval/003-cleanup-v1-experiments.md).

## Screenshot experiment

Added after the metadata/format heuristic (`isLikelyScreenshot`, browser +
`apps/web/evaluation/cleanup-cli.ts --detector screenshot`) measured **0%
recall on a real 49-photo labeled set**: real screenshots correctly had
`content_type: image/png`, but their actual device resolution was not in
the hardcoded `known_dimensions` list — a structural limitation of an
enumeration-based approach, not a one-off bug (see
[report 007](../../docs/reports/007-cleanup-v1-real-evaluation.md)).
`screenshot_zero_shot.py` is content-based instead, so it does not share
that failure mode.

```bash
python3 screenshot_zero_shot.py \
  --manifest ../../eval_data/cleanup-manifest.json \
  --root ../../eval_data/photos \
  --out ../../eval_data/screenshot-zero-shot-v1.json
```

Compared against the metadata heuristic via
`npm --prefix apps/web run eval:cleanup -- --detector screenshot --siglip-artifact <path-to-this-output>`
— see [docs/eval/003-cleanup-v1-experiments.md](../../docs/eval/003-cleanup-v1-experiments.md).

## Privacy

All three scripts read only local files named in the manifest and never
transmit images anywhere. Outputs belong under gitignored `eval_data/`.
