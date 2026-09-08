# 008 — Pre-upload Cleanup v2: selfie full evaluation + screenshot hybrid

2026-09-08. Builds on [report 007](007-cleanup-v1-real-evaluation.md).
Full detail, data model, and architecture proposal in
[docs/product/cleanup-v2-classifiers-proposal.md](../product/cleanup-v2-classifiers-proposal.md);
this report is the evaluation-numbers record. Same real 49-photo labeled set
(`eval_data/cleanup-manifest.json`: 24 screenshots, 8 blurry, 17 selfies).

## Selfie: full real-set evaluation (first time run to completion)

| Technique | Undecodable | TP | FP | FN | TN | Precision | Recall | FPR |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Face-geometry heuristic (as-measured) | 15/49 | 1 | 1 | 16 | 31 | 0.50 | 0.06 | 0.03 |
| Face-geometry, decodable-only (n=34) | — | 1 | 1 | 9 | 23 | 0.50 | 0.10 | 0.04 |
| SigLIP2 zero-shot, original 3-way prompts | 0/49 | 17 | 31 | 0 | 1 | 0.35 | 1.00 | 0.97 |
| SigLIP2 zero-shot, fixed 5-way prompts | 0/49 | 17 | 0 | 0 | 32 | **1.00** | **1.00** | **0.00** |

Face heuristic (`cv2.imread`, no HEIC codec): systematically blind to
15/49 real photos (30.6%), 7 of which are true selfies it can never catch
regardless of geometry logic. On the 34 it *can* decode, recall is still
only 10%.

Original SigLIP2 prompts (`selfie` / `portrait_by_other` / `group_photo`)
had no "none of these" option — a real methodology bug, not a capability
ceiling. All 31 false positives were screenshots (24) or blurry camera
photos (7) forced into the nearest person-photo label. Added
`screenshot`/`other_no_selfie` categories to `selfie_zero_shot.py` and
re-ran: 0 errors on all 49 photos.

n=49/17-positive caveat applies — strong evidence for the corrected
approach, not proof of large-scale production accuracy. See proposal doc
§1 for the full discussion.

## Screenshot: hybrid vs. either signal alone

| Technique | TP | FP | FN | TN | Uncertain | Precision | Recall | FPR |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Metadata only (shipped `isLikelyScreenshot`) | 0 | 0 | 24 | 25 | — | n/a | 0.00 | 0.00 |
| SigLIP2 visual only | 24 | 4 | 0 | 21 | — | 0.857 | 1.00 | 0.16 |
| Hybrid (visual + format, agreement-gated) | 24 | 0 | 0 | 21 | 4 | **1.00** | **1.00** | **0.00** |

All 4 SigLIP2-only false positives are real HEIC camera photos; the hybrid
routes exactly those 4 to "uncertain" (metadata disagrees) instead of a
wrong confident answer. Format (PNG) alone is also a perfect discriminator
on this particular dataset — noted in the proposal as a reason for
humility about how much this set can prove, not a reason to drop the
visual signal.

## SigLIP2 inference cost (measured, CPU, this dev machine)

- Cold model load: ~5.1s (one-time; must not happen per-request)
- Per-image inference (warm): ~170-210ms
- Checkpoint size: 1.4 GB on disk

## Status

Evaluation only. No production code changed. `apps/web/features/cleanup/screenshot-hybrid.ts`
is written and unit-tested but not imported by any live path. See the
proposal doc for the proposed (not built) architecture and what's
deliberately deferred.
