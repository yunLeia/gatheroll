# Selfie-detection experiment: pretrained baselines, offline only

Two techniques being **compared as pretrained baselines** for the selfie
sub-problem of [Pre-upload Cleanup v1](../../docs/product/pre-upload-cleanup-v1-proposal.md) —
no training, no fine-tuning. Neither ships to the browser or a production
path yet; that decision waits on this comparison's precision/recall and
(if a technique looks worth deploying) separate latency/model-size evidence.

## Setup

```bash
cd eval/cleanup
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## 1. Face-geometry heuristic (`face_heuristic.py`)

The simplest baseline: OpenCV's bundled Haar Cascade frontal-face detector
(no separate model download, no GPU). Outputs face count, the largest
face's area as a fraction of the whole image, and whether it's roughly
centered — **not yet a selfie decision**; that threshold is swept later
against labels (`cleanup-selfie-compare.ts`), not fixed here.

```bash
python3 face_heuristic.py \
  --manifest ../../eval_data/cleanup-manifest.json \
  --root ../../eval_data/photos \
  --out ../../eval_data/face-heuristic-v1.json
```

**Known limitations observed while building this** (not hypothetical — hit
during development smoke-testing, see
[report 006](../../docs/reports/006-cleanup-v1-smoke-evidence.md)):
- OpenCV's `cv2.imread` cannot decode **HEIC** files at all (returns `None`;
  handled as `{"error": "undecodable"}`, never a crash) — most real iPhone
  photos are HEIC, so a HEIC→JPEG conversion step is a prerequisite for any
  real evaluation run, not optional.
- Default Haar Cascade parameters can produce many small, low-confidence
  "faces" on complex real photos (busy textures/edges) — a real precision
  risk this baseline is explicitly expected to have; exactly why it's being
  compared against SigLIP2 rather than assumed adequate.

## 2. SigLIP2 zero-shot (`selfie_zero_shot.py`)

Reuses the pretrained-inference pattern from `eval/embeddings/generate.py`
(same checkpoint family, `AutoModel.from_pretrained` in eval mode only) but
for zero-shot **classification**, not embedding generation: an image is
compared against three fixed text prompts (`selfie`, `portrait_by_other`,
`group_photo`) using the model's own image and text encoders.

```bash
pip install transformers torch pillow  # or: pip install -r requirements.txt after Task 5 extends it
python3 selfie_zero_shot.py \
  --manifest ../../eval_data/cleanup-manifest.json \
  --root ../../eval_data/photos \
  --out ../../eval_data/selfie-zero-shot-v1.json
```

## Comparing the two

`apps/web/evaluation/cleanup-selfie-compare.ts` loads both artifacts plus
the manifest's `is_selfie` labels and reports `binaryMetrics` for each
technique side by side — see that file and
[docs/eval/003-cleanup-v1-experiments.md](../../docs/eval/003-cleanup-v1-experiments.md).

## Privacy

Both scripts read only local files named in the manifest and never
transmit images anywhere. Outputs belong under gitignored `eval_data/`.
