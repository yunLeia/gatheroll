# Offline event relevance evaluation

## Product correction — 2026-09-07

Participant selection is the first relevance filter. **All user-selected candidates**
is now the default and primary product baseline. Host-defined time/location boundaries
were an early hypothesis, rejected as primary membership criteria after refining the
workflow. Capture time/GPS are weak context, not ground truth. Exact bounds are optional
historical experiment inputs only. No new threshold tuning is being performed.
See [current product model](../docs/product/event-relevance.md) and
[ADR 005](../docs/adr/005-event-boundaries-are-not-membership.md).

The counterfactual all-selected comparator measures the risk of no relevance filtering;
it never authorizes sharing. Current uploads remain private pending explicit confirmation.

Read [labeling rules](../docs/eval/event-relevance-labeling.md) before labeling or
viewing predictions. Real golden dataset: **0 images supplied**. The committed
20-row fixture is synthetic metadata, not a collection of real photos or HEIC tests.

## Run the public regression example

From repository root (Node 20, existing web dependencies; no new dependency):

```bash
npm --prefix apps/web ci
npm --prefix apps/web run eval -- --manifest ../../eval/fixtures/synthetic-v1.json --out ../../eval_data/candidates-run-001
```

Every npm argument path is relative to `apps/web`. Use a new output directory per run:
existing directories are rejected to preserve results. This CLI is offline; no
R2, database, geocoding, image-content inference, production states or uploads.

Outputs: `results.json` (config, manifest hash, per-photo extracted metadata,
predictions, metrics, sweep), `comparison.csv`, `predictions.csv`, `errors.md`,
`sweep.csv`. An empty split produces null-denominator metrics, not fake success rates.
Normal terminal output contains aggregate metrics only. Outputs can contain private
GPS, timestamps and notes: keep them under ignored `eval_data/`, never CI artifacts.

## Add real examples incrementally

Copy `manifests/local-template.json` to ignored `eval_data/manifest.json` with your
editor. Put only intentionally supplied originals in `eval_data/photos/`.
Add an event and rows as follows (these values are fictitious):

```json
{
  "schema_version": 1,
  "dataset_version": "local-v1",
  "kind": "local_private",
  "events": [{ "event_id": "dinner_a" }],
  "examples": [{
    "photo_id": "eval_001",
    "event_id": "dinner_a",
    "source_file": "eval_001.jpg",
    "label": "belongs",
    "notes": "Confirmed dinner activity",
    "tags": ["indoor", "food", "JPEG"],
    "split": "development"
  }]
}
```

```bash
npm --prefix apps/web run eval -- --manifest ../../eval_data/manifest.json --root ../../eval_data/photos --out ../../eval_data/local-candidates-001
```

No need to enter photo EXIF manually: `local_private` forbids a `metadata` override
and always extracts the current source bytes. `source_file` is relative to explicit
`--root`; absolute paths, traversal/symlink escapes, unreadable files fail the run.
There is no directory crawler or production import. Add one row at a time, increment
dataset_version when labels/events/files change, retain the old manifest privately.
IDs are pseudonyms (letters/digits/underscore/hyphen), notes required, tags free-form.
The schema rejects unknown fields, duplicate IDs, invalid labels/dates/coordinates,
unknown events and mixed splits within one event. Preserve burst/edited pairs across
events manually too: identical content across differently named events is not detected.

`synthetic` instead requires `metadata` with nullable captured_at/latitude/longitude
and forbids source_file. This is deliberately a separate fixture mode. An empty
local template is valid to start collection, not evidence of a measured dataset.

## Current baseline / historical experiments / metrics contract

Default CLI and evaluate(): all_selected only. Event ID alone is sufficient; photo
capture time and event location are not gates. Production event_date is optional display
context and is deliberately not a relevance input. The evaluator's event schema is
not the production creation schema. To reproduce earlier fixed metadata comparisons,
explicitly add `--historical-metadata`; output marks them historical. Missing historical
bounds mean no time score, not an exclusion. Never fabricate timestamps to fit a new
real batch to the old experiment.

Historical `config/v1.json` remains preserved, **not tuned/validated on real data**:

- All selected: always selected, including absent metadata.
- Time only: inside inclusive event bounds = 1; linear decay to 0 over 30 minutes
  before/after. Zero grace means immediately 0 outside. Missing timestamp = absent.
- Time + GPS: Haversine meters, score 1 through 100m, linear decay to 0 at 1000m.
  Weights time=1/GPS=1 normalized over available signals only. GPS-only is allowed
  as an explicit experimental baseline; it can select a different date at same venue.
- Score ≥0.9 selected; ≥0.4 and <0.9 review; <0.4 excluded. No signals = review.
  These are evaluation states, not product decisions or probability estimates.

Time requires EXIF DateTimeOriginal + OffsetTimeOriginal. No offset → null, never
guess from machine timezone, file mtime, filename or GPS timestamp. Parser failure
and absent EXIF both become nullable fields, matching production. They are not
distinguished in this v1. UI decode may fill dimensions, but relevance ignores them.
Event coordinates are explicitly optional; current event UI supplies location_name,
not reliable coordinates. No map provider was added.

Strict positives = belongs; ambiguous excluded from precision/recall/FPR:
TP = belongs selected; FP = does_not_belong selected; FN = belongs review/excluded;
TN = does_not_belong review/excluded. Precision TP/(TP+FP), recall TP/(TP+FN),
FPR FP/(FP+TN). Rates selected/review/excluded divide by **all** rows including
ambiguous. Ambiguous counts by state are separate. Zero denominator → JSON null / CSV
blank, never 0 or 100%. FN splits review versus excluded so recovery workload is visible.

Historical `--historical-metadata --sweep` reproduces select={0.7,0.9,1}, review={0.2,0.4,0.6}: 9 configurations ×
2 metadata baselines. It reports all candidates, does not pick a winner or overwrite
config. Do not tune these further for the current product correction. Sweep
requires `--split development` (default); `--split test` and `all` allow fixed-config
evaluation only. Changing labels/config after seeing test is still leakage; the CLI
cannot prevent human misuse. Real holdout should be by event, not by burst frame.

## Code boundaries and CI

`apps/web/features/photos/metadata.ts` owns shared EXIF parsing; `selection.ts` owns
the existing timestamp parser. `apps/web/evaluation/` separates schema/loading,
scoring, metrics/reporting and CLI. TypeScript was chosen to reuse exifr exactly,
not to add a second Python EXIF implementation. `tsconfig.eval.json` uses the already
installed compiler to generate ignored `.eval-build/`; no runtime TS package needed.
No architectural service boundary changed, so this design note replaces a redundant ADR.

`npm --prefix apps/web test` builds the evaluator then runs deterministic unit and
public synthetic regression tests. CI already runs this command; it needs no private
originals or extra credentials. Full local golden evaluation is a separate intentional
command, never a mandatory PR job. See [measured report](../docs/reports/004-metadata-baseline.md).
