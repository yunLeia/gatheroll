# 007 — Pre-upload Cleanup v1: real evaluation results

2026-09-08. Builds on
[report 006](006-cleanup-v1-smoke-evidence.md), which was explicitly smoke
evidence, not accuracy metrics. This report has real precision/recall from a
human-labeled 49-photo set (`eval_data/cleanup-manifest.json`: 24
screenshots, 8 blurry, 17 selfies, 15 HEIC files) — the first real accuracy
milestone for cleanup v1.

## Screenshot metadata heuristic: real result

| | value |
|---|---:|
| total | 49 |
| tp | 0 |
| fp | 0 |
| fn | 24 |
| tn | 25 |
| precision | null (0/0) |
| recall | **0%** |
| fpr | 0% |
| accuracy | 51.0% |

**Root cause, confirmed by direct inspection:** every real screenshot's
`content_type` correctly resolved to `image/png` (the format check works),
but their actual resolution — **1206×2622**, confirmed by opening a real
labeled screenshot directly — is not in the hardcoded
`known_dimensions` list (`eval/config/cleanup-screenshot-v1.json`, 8
guessed iPhone sizes). This is retired as a production candidate, not
scheduled for further tuning: adding a 9th entry would "fix" this one
device model without addressing the structural problem — a new phone
released next year breaks it again. An enumeration-based approach to a
content property (what an image visually *is*) was the wrong shape for
this problem from the start.

## Screenshot SigLIP2 zero-shot: real result

| | value |
|---|---:|
| total | 49 |
| tp | 24 |
| fp | 4 |
| fn | 0 |
| tn | 21 |
| precision | 85.7% |
| recall | **100%** |
| fpr | 16.0% |
| accuracy | 91.8% |

Prompts: `"a screenshot of a mobile app or phone screen"` vs. `"a natural
photograph taken with a camera"` (`eval/cleanup/screenshot_zero_shot.py`,
`google/siglip2-base-patch16-224`, zero-shot, no fine-tuning).

**All 4 false positives**, from `screenshot-siglip-errors.md`, share the
same note: `photo_id p044, p045, p047, p048` — every one labeled `"clearly
blurry camera photo"`. Zero false negatives (every real screenshot was
caught). This is a content-based technique, not enumeration-based, so a new
device resolution does not break it the way the metadata heuristic does.

## Blur: HEIC blocker and its resolution

**Before fix:** `sharp(...).raw().toBuffer()` failed on 15/15 real labeled
HEIC files with `heif: Decoder plugin generated an error` — a systematic
libvips/heif-plugin limitation in this evaluation environment, not
per-file corruption (every file failed identically). This silently excluded
31% of the labeled set (34/49 scored) from any blur metric.

**Fix:** an eval-only `sips`-based JPEG cache bridge (`ensureJpegEvalCopy()`
in `apps/web/evaluation/cleanup-cli.ts`) — macOS's built-in `sips` converts
each HEIC file to a cached JPEG copy under gitignored
`eval_data/.heic-jpeg-cache/`, used only for scoring. The original HEIC
files are never touched, moved, or modified. `computeBlurScore` itself is
unchanged.

**After fix, real result over the full 49-photo set:**

| | value |
|---|---:|
| total | 49 |
| tp | 8 |
| fp | 5 |
| fn | 0 |
| tn | 36 |
| precision | 61.5% |
| recall | **100%** |
| fpr | 12.2% |
| accuracy | 89.8% |
| undecodable | **0 of 15** HEIC files — full recovery |

`blur_threshold: 100` (the provisional config value) was not re-tuned as
part of this fix — this is the same threshold from report 006, now
measured against the real, complete set for the first time.

## Duplicates: confirmed no changes needed

Restated from [report 006](006-cleanup-v1-smoke-evidence.md#exact-duplicates--real-measurement-not-just-smoke):
full scan of 169 real local photos found **0 exact-duplicate groups**.
Deterministic SHA-256 content hashing has no accuracy question to
re-measure — this finding does not change with more labels.

## What this means

Three of four signals now have real accuracy numbers on a real, if small
(n=49), human-labeled set:

- **Screenshot:** metadata heuristic is a dead end (0% recall, structural,
  not tunable); SigLIP2 zero-shot is strong (100% recall, 85.7% precision,
  all false positives on blurry camera photos — a real, specific failure
  mode worth knowing, not a mystery).
- **Blur:** Laplacian variance at `threshold=100` gets 100% recall / 61.5%
  precision on the full set now that HEIC decoding works — no algorithm
  change made, just previously-excluded data now included.
- **Selfie:** unchanged since report 006 (comparison mechanism verified,
  full-set accuracy not yet re-run against real labels in this pass).
- **Duplicates:** unchanged, confirmed clean.

n=49 is a real measurement, not a synthetic one, but still small relative to
the 100–250 photo reference scale the earlier relevance-labeling guide used.
No production/browser shipping decision exists yet for any of the four
signals — this report is evidence of measured accuracy on a real set, not a
ship decision.
