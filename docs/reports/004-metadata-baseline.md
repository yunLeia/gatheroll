# 004 — Metadata-only baseline implementation / measured synthetic regression

## Superseded primary hypothesis — 2026-09-07

Initial evaluation explored host-defined time/location boundaries as event relevance
signals. After refining the workflow, this was rejected as a primary product assumption:
participants already intentionally select candidate photos and gathering boundaries are
fuzzy. Time/GPS remain weak secondary context, never ground truth or production gates.
The current baseline is all user-selected candidates. Host creation needs no exact times.
See [ADR 005](../adr/005-event-boundaries-are-not-membership.md) and the
[current product model](../product/event-relevance.md).

Everything below is the preserved **2026-09-06 historical experiment report**, including
its measured synthetic results and then-current recommendations. It is not the current
product architecture or instruction to tune time thresholds further. Reproduction now
requires `--historical-metadata` in addition to the recorded command. No new sweep was
performed for this correction; no originals/labels/results were deleted or rewritten.

Date: 2026-09-06. **Golden dataset collection pending: 0 real photos evaluated.**
No production/R2 photo was read, copied or labeled. No AI/production decision field,
DB migration, shared album, review UI, geocoding or embedding dependency was added.

## Dataset and correctness

Label rules were written before creating fixtures or exploring thresholds:
[event-relevance-labeling.md](../eval/event-relevance-labeling.md). Human labels are
belongs / does_not_belong / ambiguous. Ambiguous means unresolved human context,
not a low-confidence model. Relatedness never substitutes for sharing consent.

Versioned JSON has schema_version, dataset_version, kind, events and examples.
Each local example records pseudonymous IDs, event relation, label, notes, tags,
split and relative source_file. Metadata is extracted, not manually duplicated.
Private files/manifests/results stay in ignored `eval_data/`; reviewed sanitized
metadata/labels can be published separately. Schema/commands/privacy: [eval guide](../../eval/README.md).

Executed fixture: `eval/fixtures/synthetic-v1.json`, **20 invented metadata rows,
1 invented event, all development**: 10 belongs, 8 does_not_belong, 2 ambiguous.
Signal composition: 11 time+GPS, 5 time-only, 2 GPS-only, 2 neither.
Tags exercise food/indoor/outdoor/day/night, burst, different date/group, before/after,
screenshot/downloaded/selfie, missing/incorrect metadata and edited cases. HEIC/JPEG
tags are scenario labels, NOT real files or decoding evidence. No real format or
population coverage is established; target 100–250 consented photos remains pending.

## Shared extraction and baseline definitions

`apps/web/features/photos/metadata.ts` now owns the existing exifr options and
normalization. Browser preparePhoto and offline loader call it. DateTimeOriginal
requires OffsetTimeOriginal; invalid/missing fields return null. No mtime, filename,
host-timezone or modified/export timestamp substitution. GPS is optional and range
checked. Parser failures remain indistinguishable from absent metadata, as in intake.
UI thumbnail dimension fallback is unchanged and not used in scoring.

`eval/config/v1.json` is explicitly **provisional**, not a tuned optimum:

1. All selected: every example selected.
2. Time only: inclusive start/end = 1; linear decay over 30 minutes before/after.
3. Time+GPS: above time score plus Haversine location score (full through 100m,
   zero from 1000m), equal weights normalized only over available signals.

GPS missing is not negative; GPS-only can score, no signals → review. At score ≥0.9
select, ≥0.4 review, below exclude. These names exist **offline only**. Event fixture
coordinates are manual; production UI location_name is not reliable lat/lon input.

## Actual computed results — synthetic only

Command from repository root:

```bash
npm --prefix apps/web run eval -- --manifest ../../eval/fixtures/synthetic-v1.json --out ../../eval_data/synthetic-v1-run --sweep
```

Local generated artifacts: results.json, comparison.csv, predictions.csv, errors.md,
sweep.csv under the output above. They are ignored deliberately. Re-run with a new
output directory. results.json records exact config, dataset version, manifest hash,
per-photo extracted metadata/scores/labels and all sweep candidates.

| System | TP | FP | FN | Precision | Recall | FPR | Auto-selected | Review |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| All selected | 10 | 8 | 0 | 55.56% | 100% | 100% | 100% | 0% |
| Time only | 5 | 4 | 5 | 55.56% | 50% | 50% | 45% | 40% |
| Time + GPS | 6 | 4 | 4 | 60% | 60% | 50% | 55% | 35% |

Strict precision/recall/FPR exclude 2 ambiguous rows (18 denominator population:
10 positives/8 negatives). FP means unrelated auto-selected. FN includes belongs
sent to review as well as excluded, not lost/deleted photos. All-row rates include
ambiguous (20 denominator). Zero denominators are null, never invented percentages.
Time-only FNs: 4 review + 1 excluded. Time+GPS FNs: 3 review + 1 excluded.
Ambiguous states: all-selected 2 selected; time-only 2 review; time+GPS 1 selected/1 review.

## Error analysis

Every FP/FN and ambiguous row is in the generated `errors.md`, with ID, label,
predicted state, signed minutes to boundary, GPS distance, available scoring signals,
and human note. Raw available metadata is in predictions.csv/results.json.

- `other_group`, `selfie`: time+GPS FP with Δ=0min and distance=0m. Their metadata
  is identical to true event pictures. Threshold cannot distinguish intent/activity.
- `screenshot`: time-only and combined FP, Δ=0 with no GPS. This fixture deliberately
  retains a timestamp; it does not claim typical screenshots contain DateTimeOriginal.
- `gps_only_other`: combined FP, timestamp missing, distance=0m. Normalizing to GPS
  alone removes a time constraint and admits a different-date scenario.
- `far`: time-only FP (Δ=0, distance≈157249m); combined review fixes that automatic
  selection, but the new GPS-only FP means total FP stays at 4.
- `after_confirmed`: belongs → review at +15min, 0m. `before_confirmed`: belongs →
  review at −5min, no GPS. Formal window and confirmed activity need not coincide.
- `no_metadata`: belongs → review, both signals absent. `wrong_time`: belongs →
  excluded, −1410min, no GPS. Missing evidence and misleading evidence differ.
- `no_time`: GPS-only recovers a true positive but also creates the risk above.
- `travel` and `after_unclear`: human boundary ambiguity; do not relabel them based
  on score. The combined model selects after_unclear; strict metrics do not hide its count.

These are deliberately constructed counterexamples, not discoveries about actual
Gatheroll users or measured real-world failure frequencies.

## Threshold sweep — no chosen winner

9 select/review configurations × 2 metadata baselines were computed; time/grace/
radius/weights fixed. CLI refuses sweeps on test/all. One slice of actual output:

| Time+GPS select threshold (review=0.4) | Precision | Recall | FP | Review | Auto-selected |
|---|---:|---:|---:|---:|---:|
| 0.7 | 66.67% | 80% | 4 | 25% | 65% |
| 0.9 | 60% | 60% | 4 | 35% | 55% |
| 1.0 | 55.56% | 50% | 4 | 45% | 45% |

Higher threshold did not reduce these FPs: all have score 1. It did remove TPs.
The sweep explores this same synthetic development set; it is not held-out validation.
For real collection, split by event, keep bursts/edited copies together, freeze labels
before reading predictions. The tool blocks mixed splits within one event, but cannot
detect a human duplicating content under different IDs/events or secretly tuning on test.

## Verification and previous intake follow-ups

- 13 new frontend tests (12 eval + 1 controlled original PUT failure); **30 total passed**.
  Coverage: time/location/missing cases, unequal available weights, exact boundaries,
  known Haversine distances, strict/ambiguous/zero metrics, frozen synthetic outcomes,
  schema validation and event split leakage, traversal/symlinks, CSV safety, shared
  normalization plus actual exifr parsing of a hand-built synthetic JPEG EXIF block;
  end-to-end CLI artifact generation, overwrite refusal, test-sweep refusal, empty split.
- `npm run lint`, `npm run typecheck`, default `npm run build` passed. Initial restricted
  Turbopack helper-port failure persisted in generated cache; preserving that cache in a
  temporary backup then rerunning with local helper-port permission passed. No source workaround.
- Backend unchanged; Ruff/mypy and **52 tests** passed on dedicated gatheroll_test
  PostgreSQL (Alembic-backed suite), with 2 existing upstream deprecation warnings.
- CI workflow already executes npm test, so public regression is covered without
  private originals. This working tree has **not been pushed**, so remote CI for these
  changes is not verified. Previous green CI does not prove this revision passed.
- HEIC real iPhone MIME/preview/original upload: not measured in this task; no supplied
  real HEIC or operable physical-device session. Prior core-flow user confirmation
  remains, but is not HEIC evidence.
- Controlled original PUT failure: three jobs, exactly one injected failure; peers
  complete; retry initializes only failed ID and adds only that PUT. Automated service
  injection, not a real phone/R2 network experiment. Completion/thumbnail failures
  and checkpoint recovery also remain covered by existing tests.
- Performance: preserved earlier desktop synthetic 10×12MP PNG prepare=1128ms;
  after removing one, 9 uploads=7.3s, 17,160,678 object bytes. No new phone jank/memory
  measurement, no 10-real-photo upload benchmark, no optimization without evidence.
- R2 learning note created with actual boto3/config/flow and privacy/failure/cost
  explanations. Full bucket CORS read returned AccessDenied; documented intended
  example + known LAN success separately, never claimed the example was a live export.

## What to understand / next smallest slice

Label quality, metadata availability and class prevalence determine what the metrics
mean. A 60% precision on invented cases says nothing about real user safety. Scores
are not probabilities, missing signals do not certify safety, and uploaded stays private.

Visual information is a plausible hypothesis for repeated same-metadata/different-
activity errors, but these fixtures alone do not justify implementing embeddings now.
Visual similarity might also fail on same-group private selfies; context/consent may
remain necessary. First collect and independently label one or two consented real
events (start small, grow toward 100–250), run fixed baselines and inspect errors.
Only then, if visual evidence could resolve a recurring error group, propose a bounded
metadata+embedding comparison against a frozen baseline. **No next slice implemented.**

## Created / changed files

- New: docs/eval/event-relevance-labeling.md; eval/README.md; eval/config/v1.json;
  eval/fixtures/synthetic-v1.json; eval/manifests/local-template.json.
- New: apps/web/evaluation/{dataset,scoring,reporting,cli}.ts;
  apps/web/features/photos/metadata.ts; apps/web/tsconfig.eval.json;
  apps/web/tests/evaluation.test.mjs.
- New: docs/learning/003-cloudflare-r2.md; docs/learning/004-event-relevance-eval.md;
  this report. Updated: docs/STATUS.md, README.md, docs/reports/003-private-photo-intake.md.
- Updated: prepare.ts shared extraction call, package.json build/run/pretest scripts,
  photos.test.mjs failure test, eslint generated-output ignore, .gitignore private data/build.
- No dependencies, infrastructure, DB migrations, AI fields or production behavior changes
  beyond semantics-preserving extraction refactoring. Design reasoning lives in eval/README
  rather than an unnecessary new ADR.
