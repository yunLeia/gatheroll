# Pre-upload Cleanup v1 — Smallest Measurable Experiments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Approved 2026-09-08 — proceeding with inline TDD implementation. Scope extended per approval: exact-duplicate detection added as Task 7 (near-duplicate/pHash stays out of scope).**

**Goal:** Build and *measure* (not yet ship as production decisions) four
pre-upload cleanup signals, in order: blur scoring, a screenshot heuristic
baseline, and a selfie-detection experiment comparing a simple heuristic
against SigLIP2 zero-shot classification. Each produces a real, testable
artifact and an evaluation report; none decide production behavior yet.

**Architecture:** Blur and screenshot detection are pure, cheap, model-free
functions that run in the browser during the existing `preparePhoto()` step
(same moment thumbnails/EXIF are already extracted) and are evaluated
offline via a new, minimal per-photo dataset schema and CLI — deliberately
not the event-relevance schema (ADR 007: relevance-specific shapes don't
fit single-photo properties). Selfie detection stays **entirely offline**
for v1: a Python face-detection heuristic and a Python SigLIP2 zero-shot
classifier are compared against the same labeled set; nothing about selfie
detection ships to the browser or a production path in this plan.

**Tech Stack:** TypeScript (existing `apps/web/evaluation/`), one new Node
dependency (`sharp`, eval-only, for decoding real photos to raw pixels
offline — never bundled into the Next.js app). Python (existing SigLIP2
environment pattern from `eval/embeddings/`, extended with `opencv-python-headless`
for the face heuristic) in a new isolated `eval/cleanup/` venv.

**Spec:** [docs/product/pre-upload-cleanup-v1-proposal.md](../../docs/product/pre-upload-cleanup-v1-proposal.md)
and [ADR 007](../../docs/adr/007-cleanup-first-ai-direction.md).

## Global Constraints

- Suggest-only: nothing here auto-removes or auto-decides. `possibly_blurry`,
  screenshot, and selfie signals are data for a future review UI, not
  enforcement.
- Blur and screenshot detection run in the **browser**. Selfie detection
  (both baselines) runs **offline/Python only** in this plan — do not
  decide browser-vs-backend for selfie inference yet; that decision waits
  on the comparison's precision/recall/latency/model-size evidence.
- No classification beyond these three signals, no duplicate detection, no
  OpenAI/Anthropic API calls, no event relevance, no clustering.
- `blur_score` stays a continuous number; `possibly_blurry` is derived from
  a versioned, evaluated, configurable threshold — never hardcoded inline.
- Face-detection heuristic and SigLIP2 zero-shot for selfies are both
  **evaluated as pretrained baselines** — no fine-tuning, no training loop.
- Reuse the existing eval harness's conventions (versioned JSON config,
  `local_private` dataset kind with path-traversal guards, gitignored
  `eval_data/`, no-overwrite output directories) without reusing its
  relevance-specific *code* (ADR 007's disposition).
- Web quality gates: `npm run lint`, `npm run typecheck`, `npm test`,
  `npm run build`. New Python code: no repo-wide lint config exists for
  `eval/` Python yet — run `python3 -m py_compile` at minimum and note this
  gap rather than inventing a new tool config.

---

## Task 1: Blur scoring — algorithm + browser wiring

**Files:**
- Create: `apps/web/features/cleanup/blur.ts`
- Modify: `apps/web/features/photos/prepare.ts`
- Modify: `apps/web/features/photos/types.ts`
- Test: `apps/web/tests/cleanup.test.mjs`

**Interfaces:**
- Produces: `PixelBuffer` type, `computeBlurScore(pixels: PixelBuffer): number`,
  `CleanupConfig` type, `possiblyBlurry(score, config): boolean` — consumed
  by Task 2's offline CLI (via a Node-decoded `PixelBuffer`) and by a future
  (not-this-plan) review UI. `PhotoInput.blur_score: number | null` — the
  browser-computed value, always present once thumbnail generation
  succeeds, `null` when it doesn't (never fabricated).

**Input/output contract:** input is decoded pixel data (RGB or RGBA,
interleaved, any source); output is a single non-negative `number` (Laplacian
variance — higher means sharper). No image format assumptions baked into the
scoring function itself; format-specific decoding happens at the call site
(canvas in the browser, `sharp` in the offline CLI in Task 2).

- [ ] **Step 1: Write the failing tests**

```js
// apps/web/tests/cleanup.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { computeBlurScore, possiblyBlurry } = require("../.eval-build/evaluation/../features/cleanup/blur.js");
// (Path shape confirmed/corrected in Step 2 once tsconfig.eval.json's include
// pattern for apps/web/features/cleanup is verified — see that step.)

function solid(width, height, value) {
  const data = new Uint8ClampedArray(width * height * 4).fill(value);
  return { data, width, height, channels: 4 };
}
function checkerboard(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const v = (x + y) % 2 === 0 ? 255 : 0;
    const o = (y * width + x) * 4;
    data[o] = data[o + 1] = data[o + 2] = v; data[o + 3] = 255;
  }
  return { data, width, height, channels: 4 };
}

test("a flat solid-color image has zero blur score (no edges)", () => {
  assert.equal(computeBlurScore(solid(8, 8, 128)), 0);
});
test("a checkerboard has a much higher blur score than a solid image of the same size", () => {
  const sharp = computeBlurScore(checkerboard(8, 8));
  const flat = computeBlurScore(solid(8, 8, 128));
  assert.ok(sharp > flat);
  assert.ok(sharp > 1000); // checkerboard Laplacian response is large by construction
});
test("works with 3-channel (no alpha) pixel buffers", () => {
  const data = new Uint8ClampedArray(4 * 4 * 3).fill(200);
  assert.equal(computeBlurScore({ data, width: 4, height: 4, channels: 3 }), 0);
});
test("a 1x1 or degenerate image returns 0, never NaN or throws", () => {
  assert.equal(computeBlurScore({ data: new Uint8ClampedArray(4), width: 1, height: 1, channels: 4 }), 0);
});
test("possiblyBlurry compares against the configured threshold, exclusive boundary", () => {
  const config = { version: "cleanup-blur-v1", blur_threshold: 100 };
  assert.equal(possiblyBlurry(50, config), true);
  assert.equal(possiblyBlurry(100, config), false);
  assert.equal(possiblyBlurry(150, config), false);
});
```

- [ ] **Step 2: Confirm the eval build picks up `features/cleanup/`**

Read `apps/web/tsconfig.eval.json`'s `include` — it currently compiles
`evaluation/` and (per the existing `metadata.ts` reuse) `features/photos/`.
Add `features/cleanup` to its `include` array so `blur.ts` compiles to
`.eval-build/features/cleanup/blur.js`, matching how `features/photos/metadata.ts`
already compiles alongside `evaluation/`. Fix the test's require path in
Step 1 to the real compiled path once confirmed (expected:
`../.eval-build/features/cleanup/blur.js`).

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm --prefix apps/web run eval:build && node --test apps/web/tests/cleanup.test.mjs`
Expected: FAIL — `blur.ts` does not exist yet.

- [ ] **Step 4: Implement `blur.ts`**

```ts
// apps/web/features/cleanup/blur.ts
export type PixelBuffer = {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
  channels: 3 | 4; // RGB or RGBA; alpha (if present) is ignored
};

// Laplacian-variance sharpness score: grayscale, apply a 4-neighbor
// discrete Laplacian, return the variance of the response. Higher = sharper.
// No model, no training — a standard, decades-old CV technique.
export function computeBlurScore(pixels: PixelBuffer): number {
  const { data, width, height, channels } = pixels;
  if (width < 3 || height < 3) return 0; // no interior pixels for a 3x3 kernel
  const gray = new Float64Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const o = i * channels;
    gray[i] = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
  }
  let sum = 0, sumSq = 0, count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const lap = gray[idx - width] + gray[idx + width] + gray[idx - 1] + gray[idx + 1] - 4 * gray[idx];
      sum += lap; sumSq += lap * lap; count++;
    }
  }
  const mean = sum / count;
  return sumSq / count - mean * mean;
}

export type CleanupConfig = { version: string; blur_threshold: number };

export function possiblyBlurry(blurScore: number, config: CleanupConfig): boolean {
  return blurScore < config.blur_threshold;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm --prefix apps/web run eval:build && node --test apps/web/tests/cleanup.test.mjs`
Expected: all PASS.

- [ ] **Step 6: Wire blur scoring into `preparePhoto()`**

In `apps/web/features/photos/prepare.ts`, the existing `thumbnail()` function
already draws the full image onto a canvas before converting it to a Blob —
reuse that same canvas's pixel data instead of decoding twice. Change its
return shape and call site:

```ts
import { computeBlurScore } from "../cleanup/blur";
// ...
async function thumbnail(
  file: File,
  meta: PhotoMetadata,
  maxBytes: number,
): Promise<{ blob: Blob; blurScore: number } | null> {
  // ... unchanged decode/canvas setup through ctx.drawImage(img, 0, 0, canvas.width, canvas.height) ...
  const blurScore = computeBlurScore({
    data: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
    width: canvas.width, height: canvas.height, channels: 4,
  });
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.75),
  );
  canvas.width = canvas.height = 0;
  return blob && blob.size <= maxBytes ? { blob, blurScore } : null;
  // (existing catch/finally unchanged)
}
```

Update `preparePhoto()`:

```ts
export async function preparePhoto(file: File, maxThumbnailBytes: number): Promise<PhotoJob> {
  const meta = await extractMetadata(file);
  const prepared = await thumbnail(file, meta, maxThumbnailBytes);
  return {
    input: {
      ...meta,
      client_id: clientId(),
      original_filename: file.name,
      content_type: contentType(file),
      file_size_bytes: file.size,
      thumbnail_size_bytes: prepared?.blob.size ?? null,
      blur_score: prepared?.blurScore ?? null,
    },
    file,
    thumbnail: prepared?.blob ?? null,
    preview: prepared ? URL.createObjectURL(prepared.blob) : null,
    state: "selected",
    originalUploaded: false,
    thumbnailUploaded: false,
  };
}
```

In `apps/web/features/photos/types.ts`, add `blur_score: number | null;` to
`PhotoInput`. This is intentionally the full extent of the "UI integration
boundary" for this plan: the score is computed and available on every
`PhotoJob`, but no review/exclude UI reads it yet — that is a deliberate
follow-up once a threshold is evaluated (Task 2), not part of this
experiment.

- [ ] **Step 7: Run the full frontend quality gate**

Run: `npm --prefix apps/web run lint && npm --prefix apps/web run typecheck && npm --prefix apps/web test && npm --prefix apps/web run build`
Expected: all clean. (`photos.test.mjs`'s existing `preparePhoto`-adjacent
tests, if any construct `PhotoInput` object literals directly, may need
`blur_score` added — check and fix as part of this step, not a separate task.)

- [ ] **Step 8: Commit**

```bash
git add apps/web/features/cleanup/blur.ts apps/web/features/photos/prepare.ts \
  apps/web/features/photos/types.ts apps/web/tests/cleanup.test.mjs apps/web/tsconfig.eval.json
git commit -m "Add Laplacian-variance blur scoring, computed during photo prepare"
```

---

## Task 2: Blur — offline evaluation harness (dataset schema + CLI)

**Files:**
- Create: `apps/web/evaluation/cleanup-dataset.ts`
- Create: `apps/web/evaluation/cleanup-reporting.ts`
- Create: `apps/web/evaluation/cleanup-cli.ts`
- Create: `eval/config/cleanup-blur-v1.json`
- Modify: `apps/web/package.json` (new `eval:cleanup` script, new `sharp` devDependency)
- Test: extend `apps/web/tests/cleanup.test.mjs`

**Interfaces:**
- Produces: `CleanupExample` type (`{ photo_id, source_file, notes,
  is_blurry, is_screenshot, is_selfie }`, each label nullable — Task 3
  populates `is_screenshot`, this task only needs `is_blurry`),
  `validateCleanupDataset`, `loadCleanupExamples` (mirrors `dataset.ts`'s
  traversal guard, but no per-example metadata extraction — cleanup examples
  need raw pixels, not EXIF), `binaryMetrics(rows: {label, predicted}[])`,
  `cleanupCsv` (reuses the existing generic `csv()` from `reporting.ts`
  directly — no new CSV formatter needed).
- Consumes: `computeBlurScore`/`possiblyBlurry`/`PixelBuffer` from Task 1.

**Evaluation fixture/data needed:** a small manifest of real photos labeled
`is_blurry: true/false` by a human — suggest ~15-20 clearly sharp + ~15-20
clearly blurry, plus a few deliberately ambiguous ones (soft bokeh, low-detail
scenes) noted in `notes` even though this schema has no `ambiguous` tier
(binary only; put nuance in the free-text note instead, matching how
`notes` is already required text on every example).

**Metrics:** precision/recall/false-positive-rate/accuracy over
`possibly_blurry` vs `is_blurry`, computed at the configured threshold, plus
a **threshold sweep** (same spirit as the relevance CLI's `--sweep`, since
`blur_threshold` is exactly the kind of value that needs real data to pick,
not a guess).

**Threshold/config handling:** `eval/config/cleanup-blur-v1.json` holds
`{ "version": "cleanup-blur-v1-provisional", "blur_threshold": <placeholder> }`
— explicitly provisional until the sweep runs against real labeled photos;
matches the existing `-provisional` naming convention.

- [ ] **Step 1: Add the `sharp` devDependency**

```bash
cd apps/web && npm install --save-dev sharp
```
`sharp` is eval-only (imported only from `cleanup-cli.ts`, never from
anything under `app/` or `features/photos/`) — confirm this with a grep
before committing, since an accidental import from production code would
pull a native binary into the Next.js bundle.

- [ ] **Step 2: Write the failing tests**

```js
// apps/web/tests/cleanup.test.mjs (additions)
const { validateCleanupDataset, binaryMetrics } = require("../.eval-build/evaluation/cleanup-dataset.js");

test("binaryMetrics computes precision/recall/fpr the same way the relevance metrics() does, for boolean labels", () => {
  const m = binaryMetrics([
    { label: true, predicted: true }, { label: true, predicted: false },
    { label: false, predicted: true }, { label: false, predicted: false },
  ]);
  assert.equal(m.tp, 1); assert.equal(m.fn, 1); assert.equal(m.fp, 1); assert.equal(m.tn, 1);
  assert.equal(m.precision, 0.5); assert.equal(m.recall, 0.5);
  assert.equal(binaryMetrics([]).precision, null); // null denominator, never 0
});

test("cleanup dataset validation requires photo_id/source_file/notes and rejects unknown fields", () => {
  const valid = { schema_version: 1, dataset_version: "local-v1", examples: [
    { photo_id: "a", source_file: "a.jpg", notes: "sharp indoor photo", is_blurry: false, is_screenshot: null, is_selfie: null },
  ] };
  assert.doesNotThrow(() => validateCleanupDataset(valid));
  const missingNotes = structuredClone(valid); missingNotes.examples[0].notes = "";
  assert.throws(() => validateCleanupDataset(missingNotes));
  const extraField = structuredClone(valid); extraField.examples[0].unexpected = 1;
  assert.throws(() => validateCleanupDataset(extraField));
  const duplicateId = { ...valid, examples: [valid.examples[0], valid.examples[0]] };
  assert.throws(() => validateCleanupDataset(duplicateId));
});
```

- [ ] **Step 3: Run to verify failure, then implement `cleanup-dataset.ts`**

```ts
// apps/web/evaluation/cleanup-dataset.ts
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

export type CleanupExample = {
  photo_id: string; source_file: string; notes: string;
  is_blurry: boolean | null; is_screenshot: boolean | null; is_selfie: boolean | null;
};
export type CleanupDataset = { schema_version: 1; dataset_version: string; examples: CleanupExample[] };

function check(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
function object(value: unknown): asserts value is Record<string, unknown> {
  check(value !== null && typeof value === "object" && !Array.isArray(value), "Expected JSON object");
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  check(Object.keys(value).every((k) => allowed.includes(k)), "Unknown field (check schema spelling)");
}
function id(value: unknown) {
  check(typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value), "IDs/versions must be short pseudonymous identifiers");
}
function boolOrNull(value: unknown) {
  check(value === null || typeof value === "boolean", "Label must be true/false/null");
}

export function validateCleanupDataset(value: unknown): CleanupDataset {
  object(value);
  keys(value, ["schema_version", "dataset_version", "examples"]);
  check(value.schema_version === 1, "Unsupported schema version");
  id(value.dataset_version);
  check(Array.isArray(value.examples), "examples array required");
  const photos = new Set<string>();
  for (const example of value.examples) {
    object(example);
    keys(example, ["photo_id", "source_file", "notes", "is_blurry", "is_screenshot", "is_selfie"]);
    id(example.photo_id);
    check(!photos.has(example.photo_id as string), "Duplicate photo ID");
    photos.add(example.photo_id as string);
    check(typeof example.source_file === "string" && example.source_file.length > 0 && !path.isAbsolute(example.source_file), "Relative source_file required");
    check(typeof example.notes === "string" && example.notes.trim().length > 0, "Human labeling note required");
    boolOrNull(example.is_blurry); boolOrNull(example.is_screenshot); boolOrNull(example.is_selfie);
  }
  return value as CleanupDataset;
}

// Mirrors dataset.ts's realpath-based traversal guard exactly (no
// generalized shared helper yet — two call sites doesn't justify one).
export async function resolveCleanupPhoto(root: string, sourceFile: string): Promise<string> {
  const base = await realpath(root);
  const file = await realpath(path.resolve(base, sourceFile));
  const relative = path.relative(base, file);
  check(relative !== "" && relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative), "Source escapes photo root");
  return file;
}

export async function loadCleanupDataset(manifestPath: string): Promise<CleanupDataset> {
  return validateCleanupDataset(JSON.parse(await readFile(manifestPath, "utf8")));
}
```

Add `binaryMetrics` to `apps/web/evaluation/cleanup-reporting.ts`:

```ts
// apps/web/evaluation/cleanup-reporting.ts
const ratio = (n: number, d: number) => (d ? n / d : null);

export type BinaryRow = { label: boolean; predicted: boolean };

export function binaryMetrics(rows: BinaryRow[]) {
  const tp = rows.filter((r) => r.label && r.predicted).length;
  const fn = rows.filter((r) => r.label && !r.predicted).length;
  const fp = rows.filter((r) => !r.label && r.predicted).length;
  const tn = rows.filter((r) => !r.label && !r.predicted).length;
  return {
    total: rows.length, tp, fp, fn, tn,
    precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn),
    fpr: ratio(fp, fp + tn), accuracy: ratio(tp + tn, rows.length),
  };
}
```

(A fresh, boolean-shaped metrics function, not a reuse of relevance's
3-state `metrics()` — the label/prediction shapes genuinely differ, and
forcing a shared function here would be the premature-abstraction the
project's own conventions warn against.)

- [ ] **Step 4: Run to verify pass**

Run: `npm --prefix apps/web run eval:build && node --test apps/web/tests/cleanup.test.mjs`
Expected: PASS.

- [ ] **Step 5: Write `eval/config/cleanup-blur-v1.json`**

```json
{
  "version": "cleanup-blur-v1-provisional",
  "blur_threshold": 100
}
```
(Placeholder value — the sweep in Step 7 exists specifically to replace this
with an evaluated number once real labeled photos are available.)

- [ ] **Step 6: Write `cleanup-cli.ts`**

```ts
// apps/web/evaluation/cleanup-cli.ts
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { computeBlurScore, possiblyBlurry, type CleanupConfig } from "../features/cleanup/blur";
import { loadCleanupDataset, resolveCleanupPhoto } from "./cleanup-dataset";
import { binaryMetrics } from "./cleanup-reporting";
import { csv } from "./reporting";

async function pixelsFromFile(file: string) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels as 3 | 4 };
}

async function main() {
  const { values } = parseArgs({ options: {
    manifest: { type: "string" }, root: { type: "string" },
    config: { type: "string", default: "../../eval/config/cleanup-blur-v1.json" },
    out: { type: "string", default: "../../eval_data/cleanup-blur-results" },
    sweep: { type: "boolean", default: false }, help: { type: "boolean", default: false },
  } });
  if (values.help) {
    console.log("npm run eval:cleanup -- --manifest PATH --root PHOTO_ROOT [--config PATH] [--out NEW_DIR] [--sweep]\nEvaluates blur_score/possibly_blurry against human is_blurry labels. Output directory must not exist.");
    return;
  }
  if (!values.manifest || !values.root) throw new Error("--manifest and --root required");
  const dataset = await loadCleanupDataset(values.manifest);
  const config: CleanupConfig = JSON.parse(await readFile(values.config!, "utf8"));
  const labeled = dataset.examples.filter((e) => e.is_blurry !== null);
  if (!labeled.length) throw new Error("No examples have is_blurry labeled");

  const rows = await Promise.all(labeled.map(async (e) => {
    const file = await resolveCleanupPhoto(values.root!, e.source_file);
    const pixels = await pixelsFromFile(file);
    const blur_score = computeBlurScore(pixels);
    return { photo_id: e.photo_id, label: e.is_blurry!, blur_score, predicted: possiblyBlurry(blur_score, config), notes: e.notes };
  }));
  const metrics = binaryMetrics(rows);

  const sweep = values.sweep
    ? [20, 50, 100, 150, 200, 300, 500].map((blur_threshold) => ({
        blur_threshold,
        ...binaryMetrics(rows.map((r) => ({ label: r.label, predicted: possiblyBlurry(r.blur_score, { ...config, blur_threshold }) }))),
      }))
    : [];

  const out = path.resolve(values.out!);
  await mkdir(path.dirname(out), { recursive: true });
  await mkdir(out, { mode: 0o700 });
  await Promise.all([
    ["results.json", JSON.stringify({ config, metrics, rows, sweep }, null, 2) + "\n"],
    ["predictions.csv", csv(rows)], ["sweep.csv", csv(sweep)],
  ].map(([name, content]) => writeFile(path.join(out, name), content, { mode: 0o600, flag: "wx" })));
  console.table({ blur: metrics });
  console.log(`Wrote results.json, predictions.csv, sweep.csv to ${out}. Treat output as private.`);
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Cleanup evaluation failed.");
  process.exitCode = 1;
});
```

Add to `apps/web/package.json` scripts: `"eval:cleanup": "npm run eval:build && node .eval-build/evaluation/cleanup-cli.js"`.

- [ ] **Step 7: Smoke-test end to end with synthetic images**

Generate 2-3 tiny real PNGs with `sharp` itself in a scratch script (one
solid color = "sharp: false" i.e. blurry, one checkerboard/noise pattern =
sharp), hand-write a matching manifest, run
`npm --prefix apps/web run eval:cleanup -- --manifest ... --root ... --out ... --sweep`,
confirm `results.json`/`predictions.csv`/`sweep.csv` are written and the
metrics match hand-computed expectations. Not a committed test — a manual
verification step, matching how Task 1/2's Python smoke tests in the prior
plan were run-and-inspected rather than asserted in CI (no real labeled
photos exist yet to make this a real regression test).

- [ ] **Step 8: Run the full frontend quality gate**

Run: `npm --prefix apps/web run lint && npm --prefix apps/web run typecheck && npm --prefix apps/web test && npm --prefix apps/web run build`

- [ ] **Step 9: Commit**

```bash
git add apps/web/evaluation/cleanup-dataset.ts apps/web/evaluation/cleanup-reporting.ts \
  apps/web/evaluation/cleanup-cli.ts eval/config/cleanup-blur-v1.json \
  apps/web/package.json apps/web/tests/cleanup.test.mjs
git commit -m "Add offline blur evaluation harness (dataset schema, CLI, sweep)"
```

---

## Task 3: Screenshot heuristic baseline

**Files:**
- Create: `apps/web/features/cleanup/screenshot.ts`
- Create: `eval/config/cleanup-screenshot-v1.json`
- Modify: `apps/web/features/photos/prepare.ts`, `types.ts`
- Modify: `apps/web/evaluation/cleanup-cli.ts` (new subcommand/flag)
- Test: extend `apps/web/tests/cleanup.test.mjs`

**Interfaces:**
- Produces: `ScreenshotConfig` type, `isLikelyScreenshot(input, config): boolean`.
- Input/output contract: input is `{ content_type: string; width: number | null;
  height: number | null; has_camera_exif: boolean }` (all already extracted
  by the existing `metadata.ts`/`contentType()` — no new extraction code, no
  pixel access needed at all for this detector); output is a plain boolean
  (deterministic, not threshold-tunable in the continuous sense blur is —
  see config below).

**This task is the metadata/format heuristic only** — the "lightweight
visual/zero-shot approach if needed" from the proposal is explicitly **not**
implemented here; it stays a follow-up, gated on whether this baseline's
measured precision/recall on the labeled set below turns out insufficient.
Do not add it speculatively.

**Evaluation fixture/data needed:** ~15 real screenshots (mix of iOS/Android
if available) + ~15 real camera photos, labeled `is_screenshot`, reusing the
same `CleanupExample`/manifest shape from Task 2 (the `is_blurry` field can
stay `null` on these rows, or be double-labeled if convenient — no schema
change needed).

**Threshold/config handling:** unlike blur, there's no single numeric
threshold — the "configurable" part is the known-screenshot-dimensions list
and whether missing camera EXIF is required in addition to format/dimensions.
`eval/config/cleanup-screenshot-v1.json`:

```json
{
  "version": "cleanup-screenshot-v1-provisional",
  "require_png": true,
  "require_missing_camera_exif": false,
  "known_dimensions": [
    { "width": 1170, "height": 2532 }, { "width": 1179, "height": 2556 },
    { "width": 1284, "height": 2778 }, { "width": 1290, "height": 2796 },
    { "width": 1080, "height": 2340 }, { "width": 828, "height": 1792 },
    { "width": 750, "height": 1334 }, { "width": 1242, "height": 2688 }
  ]
}
```
(A handful of common iPhone screen resolutions to start; explicitly marked
provisional/incomplete — Android coverage is weaker and noted as a known
gap, matching the proposal's own framing rather than pretending completeness.)

- [ ] **Step 1: Write the failing tests**

```js
// apps/web/tests/cleanup.test.mjs (additions)
const { isLikelyScreenshot } = require("../.eval-build/features/cleanup/screenshot.js");

const SCREENSHOT_CONFIG = {
  version: "cleanup-screenshot-v1-provisional", require_png: true,
  require_missing_camera_exif: false,
  known_dimensions: [{ width: 1170, height: 2532 }],
};

test("PNG at a known device screenshot resolution is flagged", () => {
  assert.equal(isLikelyScreenshot({ content_type: "image/png", width: 1170, height: 2532, has_camera_exif: false }, SCREENSHOT_CONFIG), true);
});
test("JPEG at the same resolution is not flagged (wrong format)", () => {
  assert.equal(isLikelyScreenshot({ content_type: "image/jpeg", width: 1170, height: 2532, has_camera_exif: false }, SCREENSHOT_CONFIG), false);
});
test("PNG at an unrecognized resolution is not flagged", () => {
  assert.equal(isLikelyScreenshot({ content_type: "image/png", width: 500, height: 500, has_camera_exif: false }, SCREENSHOT_CONFIG), false);
});
test("missing width/height never throws, treated as not matching", () => {
  assert.equal(isLikelyScreenshot({ content_type: "image/png", width: null, height: null, has_camera_exif: false }, SCREENSHOT_CONFIG), false);
});
test("require_missing_camera_exif, when true, also requires absent camera EXIF", () => {
  const strict = { ...SCREENSHOT_CONFIG, require_missing_camera_exif: true };
  assert.equal(isLikelyScreenshot({ content_type: "image/png", width: 1170, height: 2532, has_camera_exif: true }, strict), false);
  assert.equal(isLikelyScreenshot({ content_type: "image/png", width: 1170, height: 2532, has_camera_exif: false }, strict), true);
});
```

- [ ] **Step 2: Run to verify failure, then implement `screenshot.ts`**

```ts
// apps/web/features/cleanup/screenshot.ts
export type ScreenshotConfig = {
  version: string;
  require_png: boolean;
  require_missing_camera_exif: boolean;
  known_dimensions: { width: number; height: number }[];
};

export type ScreenshotInput = {
  content_type: string;
  width: number | null;
  height: number | null;
  has_camera_exif: boolean;
};

export function isLikelyScreenshot(input: ScreenshotInput, config: ScreenshotConfig): boolean {
  if (config.require_png && input.content_type !== "image/png") return false;
  if (input.width === null || input.height === null) return false;
  const knownSize = config.known_dimensions.some(
    (d) => (d.width === input.width && d.height === input.height) ||
           (d.width === input.height && d.height === input.width), // portrait/landscape
  );
  if (!knownSize) return false;
  if (config.require_missing_camera_exif && input.has_camera_exif) return false;
  return true;
}
```

- [ ] **Step 3: Run to verify pass**

Run: `npm --prefix apps/web run eval:build && node --test apps/web/tests/cleanup.test.mjs`

- [ ] **Step 4: Wire into `preparePhoto()`**

`metadata.ts`'s `extractMetadata()` already parses EXIF — check whether it
currently exposes enough to derive `has_camera_exif` (presence of a
`Make`/`Model` or `DateTimeOriginal`-bearing EXIF block versus none at all).
If it only returns the already-normalized `captured_at`/`latitude`/
`longitude` fields, add a minimal `has_camera_exif: boolean` alongside them
in the same extraction pass — do not re-parse EXIF a second time.

In `prepare.ts`:
```ts
import { isLikelyScreenshot } from "../cleanup/screenshot";
import screenshotConfig from "../../../../eval/config/cleanup-screenshot-v1.json"; // or fetched/inlined default — confirm bundler JSON-import support during implementation
// ...
const is_likely_screenshot = isLikelyScreenshot(
  { content_type: contentType(file), width: meta.width, height: meta.height, has_camera_exif: meta.has_camera_exif },
  screenshotConfig,
);
```
Add `is_likely_screenshot: boolean` to `PhotoInput` in `types.ts`. Same
"data available, no review UI yet" boundary as Task 1's `blur_score`.

**Open implementation question to resolve during this step, not before:**
whether the browser bundle should import `eval/config/cleanup-screenshot-v1.json`
directly (simplest, but couples app code to an `eval/`-rooted path) or the
config should be duplicated/relocated to something like
`apps/web/config/cleanup-screenshot.json` with the `eval/` copy becoming the
canonical source the app one is generated from. Prefer the simplest (direct
import) unless the build actually complains — do not add a generation step
speculatively.

- [ ] **Step 5: Extend `cleanup-cli.ts` with a screenshot mode**

Add a `--detector blur|screenshot` flag (default `blur`, matching Task 2's
existing behavior when omitted). When `screenshot`: skip pixel decoding
entirely (no `sharp` call needed — `isLikelyScreenshot` only needs
format/dimensions/EXIF, all cheap to get via `sharp(file).metadata()`
instead of `.raw().toBuffer()`), filter to `is_screenshot !== null` examples,
run `isLikelyScreenshot` per row, report `binaryMetrics`. No sweep needed
(no continuous threshold to sweep) — `--sweep` is a no-op with a warning if
passed alongside `--detector screenshot`.

- [ ] **Step 6: Full quality gate + commit**

```bash
npm --prefix apps/web run lint && npm --prefix apps/web run typecheck && npm --prefix apps/web test && npm --prefix apps/web run build
git add apps/web/features/cleanup/screenshot.ts eval/config/cleanup-screenshot-v1.json \
  apps/web/features/photos/prepare.ts apps/web/features/photos/types.ts \
  apps/web/evaluation/cleanup-cli.ts apps/web/tests/cleanup.test.mjs
git commit -m "Add screenshot format/EXIF heuristic baseline (browser + offline eval)"
```

---

## Task 4: Selfie experiment — face-heuristic baseline (Python, offline only)

**Files:**
- Create: `eval/cleanup/requirements.txt`
- Create: `eval/cleanup/face_heuristic.py`
- Create: `eval/cleanup/README.md`

**Interfaces:**
- Consumes: a `CleanupDataset`-shaped manifest (Task 2's schema; reads
  `photo_id`/`source_file` only, ignores labels — this script only scores).
- Produces: a JSON artifact `{ "<photo_id>": { "face_count": int,
  "largest_face_area_ratio": float, "centered": bool } }`, written under
  `eval_data/` (gitignored), consumed by Task 6's comparison report.

**Input/output contract:** input is a real local photo file path; output is
face geometry (count, largest face's area as a fraction of the whole image,
whether that face's center falls within a configurable central region) —
**not yet a selfie/not-selfie boolean**. The heuristic's actual
selfie-or-not decision (e.g. "≥1 face AND largest face area ratio above some
cutoff AND centered") is deliberately left to Task 6's comparison step, so
the same raw geometry can be threshold-swept without re-running face
detection.

**Why this is the simplest baseline:** OpenCV's bundled Haar Cascade face
detector (`opencv-python-headless`) ships the trained cascade file with the
package — no separate model download, no GPU, fast on CPU, decades-proven.
This is explicitly a baseline to compare against, not a candidate for
production shipping as-is (per the proposal's own framing: it will likely
confuse portraits/group photos/photos-taken-by-others, which is exactly
what Task 6 measures).

- [ ] **Step 1: Write `requirements.txt`**

```
opencv-python-headless>=4.10,<5
```
(`-headless` avoids pulling in GUI/Qt dependencies not needed for batch
scoring — smaller install, same detection API.)

- [ ] **Step 2: Set up the isolated venv**

```bash
cd eval/cleanup
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

- [ ] **Step 3: Write `face_heuristic.py`**

```python
#!/usr/bin/env python3
"""Face-geometry baseline for the selfie-detection experiment.

Reads only local files named in the manifest. Never uploads or transmits
images. Writes face count/size/centering per photo — not yet a selfie
decision; that's derived later against labels, so thresholds can be swept
without re-running detection.
"""

import argparse
import json
import sys
from pathlib import Path

import cv2

CASCADE = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"


def load_manifest(manifest_path: Path) -> list[tuple[str, str]]:
    data = json.loads(manifest_path.read_text())
    return [(row["photo_id"], row["source_file"]) for row in data["examples"]]


def resolve_source(root: Path, source_file: str) -> Path:
    root_resolved = root.resolve()
    resolved = (root_resolved / source_file).resolve()
    if resolved != root_resolved and root_resolved not in resolved.parents:
        raise SystemExit(f"Source escapes photo root: {source_file}")
    return resolved


def analyze(path: Path, detector: "cv2.CascadeClassifier") -> dict:
    image = cv2.imread(str(path))
    if image is None:
        return {"face_count": 0, "largest_face_area_ratio": 0.0, "centered": False, "error": "undecodable"}
    height, width = image.shape[:2]
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    faces = detector.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(40, 40))
    if len(faces) == 0:
        return {"face_count": 0, "largest_face_area_ratio": 0.0, "centered": False}
    fx, fy, fw, fh = max(faces, key=lambda f: f[2] * f[3])
    area_ratio = (fw * fh) / (width * height)
    face_center_x, face_center_y = fx + fw / 2, fy + fh / 2
    centered = (
        0.25 * width <= face_center_x <= 0.75 * width
        and 0.15 * height <= face_center_y <= 0.85 * height
    )
    return {"face_count": int(len(faces)), "largest_face_area_ratio": float(area_ratio), "centered": bool(centered)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()

    if args.out.exists():
        raise SystemExit(f"Refusing to overwrite existing artifact: {args.out}")

    detector = cv2.CascadeClassifier(CASCADE)
    if detector.empty():
        raise SystemExit("Failed to load bundled Haar Cascade — check opencv-python-headless install")

    results = {}
    for photo_id, source_file in load_manifest(args.manifest):
        path = resolve_source(args.root, source_file)
        results[photo_id] = analyze(path, detector)
        print(f"analyzed {photo_id}: {results[photo_id]}", file=sys.stderr)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps({"technique": "haar_cascade_frontalface", "results": results}, indent=2) + "\n")
    print(f"Wrote {len(results)} face-geometry results to {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Write `eval/cleanup/README.md`**

Document setup, invocation
(`python3 face_heuristic.py --manifest ../../eval_data/cleanup-manifest.json --root ../../eval_data/photos --out ../../eval_data/face-heuristic-v1.json`),
and that this is a **baseline for comparison**, explicitly not a production
candidate — link to the proposal doc's named failure classes (portraits,
group photos, photos taken by someone else).

- [ ] **Step 5: Smoke-test against 2-3 real or synthetic face photos**

Run it against a handful of real photos (a face, a group, a scenery photo
with no face) and eyeball the output for sanity (face_count/area/centered
look directionally right) before relying on it for the real comparison in
Task 6. No committed test — same reasoning as Task 2 Step 7 (no real labeled
photos exist yet in this repo to make this a CI regression test).

- [ ] **Step 6: Commit**

```bash
git add eval/cleanup/requirements.txt eval/cleanup/face_heuristic.py eval/cleanup/README.md
git commit -m "Add OpenCV Haar Cascade face-geometry baseline for selfie experiment"
```

---

## Task 5: Selfie experiment — SigLIP2 zero-shot baseline (Python, offline only)

**Files:**
- Modify: `eval/cleanup/requirements.txt` (add `transformers`, `torch`, `pillow`)
- Create: `eval/cleanup/selfie_zero_shot.py`

**Interfaces:**
- Consumes: same manifest shape as Task 4.
- Produces: a JSON artifact `{ "<photo_id>": { "selfie": float, "portrait_by_other": float,
  "group_photo": float, "predicted_label": "selfie"|"portrait_by_other"|"group_photo" } }`
  — per-prompt zero-shot similarity scores plus the argmax, consumed by
  Task 6.

**Input/output contract:** input is a real local photo file path plus the
three fixed text prompts below; output is one similarity score per prompt
(SigLIP's sigmoid-based image-text score, not a softmax-normalized
probability — report the raw per-prompt scores, do not force them to sum to
1) and the argmax label. This is genuinely a **different** technique from
Task 4 (image-text zero-shot matching vs. pure geometric face detection),
which is the point of the comparison.

**We are evaluating a pretrained model, not training one** — no fine-tuning,
no gradient updates; `AutoModel.from_pretrained` in eval (inference) mode
only, mirroring `eval/embeddings/generate.py`'s existing pattern exactly.

- [ ] **Step 1: Extend `requirements.txt`**

```
opencv-python-headless>=4.10,<5
transformers>=4.45,<5
torch>=2.4,<3
pillow>=10,<12
```

- [ ] **Step 2: Reinstall into the same `eval/cleanup/.venv`**

```bash
cd eval/cleanup && source .venv/bin/activate && pip install -r requirements.txt
```

- [ ] **Step 3: Write `selfie_zero_shot.py`**

```python
#!/usr/bin/env python3
"""SigLIP2 zero-shot baseline for the selfie-detection experiment.

Reads only local files named in the manifest. Never uploads or transmits
images. Uses a pretrained SigLIP2 checkpoint's image and text encoders
directly (zero-shot) -- no fine-tuning, no training loop.
"""

import argparse
import json
import sys
from pathlib import Path

DEFAULT_MODEL = "google/siglip2-base-patch16-224"

# Prompt wording matters for zero-shot quality; these three are deliberately
# mutually exclusive framings of "who is this photo of, from whose camera."
PROMPTS = {
    "selfie": "a selfie photograph taken by the person who appears in it, arm's length or mirror",
    "portrait_by_other": "a portrait photograph of one person, taken by someone else holding the camera",
    "group_photo": "a group photo of multiple people posing together",
}


def load_manifest(manifest_path: Path) -> list[tuple[str, str]]:
    data = json.loads(manifest_path.read_text())
    return [(row["photo_id"], row["source_file"]) for row in data["examples"]]


def resolve_source(root: Path, source_file: str) -> Path:
    root_resolved = root.resolve()
    resolved = (root_resolved / source_file).resolve()
    if resolved != root_resolved and root_resolved not in resolved.parents:
        raise SystemExit(f"Source escapes photo root: {source_file}")
    return resolved


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--model", default=DEFAULT_MODEL, help="Hugging Face checkpoint id")
    args = parser.parse_args()

    if args.out.exists():
        raise SystemExit(f"Refusing to overwrite existing artifact: {args.out}")

    import torch
    from PIL import Image
    from transformers import AutoModel, AutoProcessor

    processor = AutoProcessor.from_pretrained(args.model)
    model = AutoModel.from_pretrained(args.model)
    model.eval()

    labels = list(PROMPTS.keys())
    texts = [PROMPTS[label] for label in labels]

    results = {}
    with torch.no_grad():
        text_inputs = processor(text=texts, padding="max_length", return_tensors="pt")
        text_features = model.get_text_features(**text_inputs)
        for photo_id, source_file in load_manifest(args.manifest):
            path = resolve_source(args.root, source_file)
            image = Image.open(path).convert("RGB")
            image_inputs = processor(images=image, return_tensors="pt")
            image_features = model.get_image_features(**image_inputs)
            logits = (image_features @ text_features.T)[0]
            scores = {label: float(score) for label, score in zip(labels, logits.tolist())}
            predicted = max(scores, key=scores.get)
            results[photo_id] = {**scores, "predicted_label": predicted}
            print(f"scored {photo_id}: {predicted}", file=sys.stderr)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps({"model": args.model, "prompts": PROMPTS, "results": results}, indent=2) + "\n")
    print(f"Wrote {len(results)} zero-shot results to {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
```

Model checkpoint stays a CLI flag (`--model`), same reproducibility pattern
as `eval/embeddings/generate.py`'s `DEFAULT_MODEL` constant + recorded
`model` field in the output artifact — no caching layer this time (the
existing `generate.py` already proves that pattern; adding it here too,
for a one-off ~30-50-photo comparison run, is premature — revisit if this
script starts being re-run often enough for cache misses to matter).

- [ ] **Step 4: Smoke-test against the same photos used in Task 4**

Run it against the same 2-3 photos, confirm the output shape and that
`predicted_label` looks directionally sane (a real selfie photo scores
highest on the `selfie` prompt, etc.). Same "no committed test, no real
labels yet" reasoning as Task 4 Step 5.

- [ ] **Step 5: Commit**

```bash
git add eval/cleanup/requirements.txt eval/cleanup/selfie_zero_shot.py
git commit -m "Add SigLIP2 zero-shot baseline for selfie experiment (evaluation only, no fine-tuning)"
```

---

## Task 6: Selfie experiment — comparison reporting (Node/TypeScript)

**Files:**
- Create: `apps/web/evaluation/cleanup-selfie-compare.ts`
- Modify: `apps/web/evaluation/cleanup-cli.ts` (or a small dedicated script —
  decide based on how much this shares with the existing `--detector` flag
  pattern; likely simplest as its own small script since inputs are two
  pre-computed JSON artifacts, not a live pixel-decode pass like blur/screenshot)
- Test: extend `apps/web/tests/cleanup.test.mjs`

**Interfaces:**
- Consumes: Task 4's face-geometry artifact, Task 5's zero-shot artifact,
  and the `CleanupDataset`'s `is_selfie` labels (extend `CleanupExample`'s
  existing nullable `is_selfie` field — already present in the schema from
  Task 2, just populated now).
- Produces: a comparison report — for the face-heuristic baseline, a
  **threshold sweep** over `largest_face_area_ratio` (since Task 4
  deliberately left the geometry un-thresholded); for the SigLIP2 baseline,
  a fixed decision (`predicted_label === "selfie"`, no threshold to sweep —
  it's already an argmax over three prompts). Both reported through the same
  `binaryMetrics` from Task 2 side by side, so the two techniques are
  genuinely comparable on the same metric.

**Metrics:** `binaryMetrics` per technique (precision/recall/FPR/accuracy),
plus the face-heuristic's full sweep table, written to
`eval_data/cleanup-selfie-compare/` (`comparison.csv`, `predictions.csv`) —
matching the existing output-directory-must-not-exist convention.

**Threshold/config handling:** the face-heuristic decision rule
(`face_count >= 1 AND largest_face_area_ratio >= threshold [AND centered]`)
stays a sweep parameter here, not a fixed config file yet — there is no
production classifier decision to configure until this comparison's results
say which technique (if either) is worth deploying, and how.

**UI integration boundary:** **none, deliberately.** No browser code, no
`PhotoInput` field, no production path. This task's entire deliverable is a
report a human reads to decide (a) whether selfie detection is worth
pursuing at all given the false-positive classes named in the proposal, and
(b) if so, whether the cheap heuristic is good enough or SigLIP2's added
weight is justified — that decision, and any resulting browser-vs-backend
call, is explicitly out of scope for this plan.

- [ ] **Step 1: Write the failing tests**

```js
// apps/web/tests/cleanup.test.mjs (additions)
const { faceHeuristicDecision, compareSelfieBaselines } = require("../.eval-build/evaluation/cleanup-selfie-compare.js");

test("faceHeuristicDecision requires at least one centered, sufficiently large face", () => {
  assert.equal(faceHeuristicDecision({ face_count: 1, largest_face_area_ratio: 0.3, centered: true }, 0.2), true);
  assert.equal(faceHeuristicDecision({ face_count: 1, largest_face_area_ratio: 0.1, centered: true }, 0.2), false);
  assert.equal(faceHeuristicDecision({ face_count: 0, largest_face_area_ratio: 0, centered: false }, 0.2), false);
  assert.equal(faceHeuristicDecision({ face_count: 1, largest_face_area_ratio: 0.5, centered: false }, 0.2), false);
});

test("compareSelfieBaselines reports both techniques over the same labeled rows", () => {
  const dataset = { examples: [
    { photo_id: "a", is_selfie: true }, { photo_id: "b", is_selfie: false },
  ] };
  const faceArtifact = { results: {
    a: { face_count: 1, largest_face_area_ratio: 0.4, centered: true },
    b: { face_count: 2, largest_face_area_ratio: 0.1, centered: false },
  } };
  const siglipArtifact = { results: {
    a: { selfie: 5, portrait_by_other: 1, group_photo: 0, predicted_label: "selfie" },
    b: { selfie: 0, portrait_by_other: 1, group_photo: 4, predicted_label: "group_photo" },
  } };
  const report = compareSelfieBaselines(dataset, faceArtifact, siglipArtifact, 0.2);
  assert.equal(report.face_heuristic.tp, 1); assert.equal(report.face_heuristic.tn, 1);
  assert.equal(report.siglip_zero_shot.tp, 1); assert.equal(report.siglip_zero_shot.tn, 1);
});
```

- [ ] **Step 2: Run to verify failure, then implement `cleanup-selfie-compare.ts`**

```ts
// apps/web/evaluation/cleanup-selfie-compare.ts
import { binaryMetrics } from "./cleanup-reporting";
import type { CleanupDataset } from "./cleanup-dataset";

export type FaceGeometry = { face_count: number; largest_face_area_ratio: number; centered: boolean };
export type FaceArtifact = { results: Record<string, FaceGeometry> };
export type SiglipResult = { selfie: number; portrait_by_other: number; group_photo: number; predicted_label: string };
export type SiglipArtifact = { results: Record<string, SiglipResult> };

export function faceHeuristicDecision(geometry: FaceGeometry, areaThreshold: number): boolean {
  return geometry.face_count >= 1 && geometry.centered && geometry.largest_face_area_ratio >= areaThreshold;
}

export function compareSelfieBaselines(
  dataset: Pick<CleanupDataset, "examples">,
  faceArtifact: FaceArtifact,
  siglipArtifact: SiglipArtifact,
  faceAreaThreshold: number,
) {
  const labeled = dataset.examples.filter((e) => e.is_selfie !== null);
  const faceRows = labeled.map((e) => ({
    label: e.is_selfie!,
    predicted: faceHeuristicDecision(faceArtifact.results[e.photo_id], faceAreaThreshold),
  }));
  const siglipRows = labeled.map((e) => ({
    label: e.is_selfie!,
    predicted: siglipArtifact.results[e.photo_id].predicted_label === "selfie",
  }));
  return { face_heuristic: binaryMetrics(faceRows), siglip_zero_shot: binaryMetrics(siglipRows) };
}
```

- [ ] **Step 3: Run to verify pass**

Run: `npm --prefix apps/web run eval:build && node --test apps/web/tests/cleanup.test.mjs`

- [ ] **Step 4: Wire a small CLI entrypoint**

Add a `cleanup-selfie-cli.ts` (or extend `cleanup-cli.ts` with a
`--detector selfie --face-artifact PATH --siglip-artifact PATH
--face-area-threshold N` mode — prefer extending the existing CLI unless it
gets unwieldy, matching "avoid premature abstraction" — decide during
implementation which reads cleaner) that loads the manifest + both
artifacts, sweeps `faceAreaThreshold` over a small fixed set (e.g. `[0.05,
0.1, 0.15, 0.2, 0.3]`) for the face heuristic, computes the fixed SigLIP
metrics once, and writes `comparison.csv`/`predictions.csv` to `--out`.

- [ ] **Step 5: Full quality gate + commit**

```bash
npm --prefix apps/web run lint && npm --prefix apps/web run typecheck && npm --prefix apps/web test && npm --prefix apps/web run build
git add apps/web/evaluation/cleanup-selfie-compare.ts apps/web/evaluation/cleanup-cli.ts apps/web/tests/cleanup.test.mjs
git commit -m "Add face-heuristic vs SigLIP2 zero-shot comparison for selfie experiment"
```

---

## Task 7: Exact duplicate detection (content hash)

**Files:**
- Create: `apps/web/features/cleanup/duplicates.ts`
- Modify: `apps/web/features/photos/prepare.ts`, `types.ts`
- Modify: `apps/web/evaluation/cleanup-dataset.ts` (no new field needed —
  see below), `apps/web/evaluation/cleanup-cli.ts` (new `--detector duplicates` mode)
- Test: extend `apps/web/tests/cleanup.test.mjs`

**Why this fits the "smallest deterministic capability" bar:** SHA-256
content-hash equality is not an approximation of a fuzzy human judgment the
way blur/screenshot/selfie are — two files with the same hash are the same
bytes, full stop. There is no precision/recall question, no labeled dataset,
no threshold. This task is pure plumbing: compute a hash, group by it.

**Product tie-in (context, not built here):** this is the primitive the
future "Download all excludes photos I already have" promise needs
server-side. This task only builds the browser-side computation and a
same-batch grouping function — it does **not** touch `apps/api`, the
`photos` table, or any cross-participant/download logic. That remains
explicitly future work; recording the hash durably server-side is a
backend task or its own future slice, not part of this browser-only
cleanup phase.

**Interfaces:**
- Produces: `contentHash(bytes: ArrayBuffer): Promise<string>` (SHA-256
  hex, via Web Crypto `crypto.subtle.digest` in the browser), `groupExactDuplicates(items:
  { id: string; content_hash: string }[]): Map<string, string[]>` (groups
  ≥2, singletons omitted). `PhotoInput.content_hash: string | null`
  (`null` only if hashing itself fails, e.g. unreadable file — never
  fabricated).

**Input/output contract:** input is the original file's raw bytes (not the
thumbnail — duplicate detection must operate on what will actually be
uploaded, unlike blur scoring which can reuse the downscaled canvas);
output is a lowercase hex SHA-256 string, and a grouping of `id`s sharing an
identical hash.

**Evaluation fixture/data needed:** none in the precision/recall sense.
For a smoke check: 2-3 real photos where one is a byte-identical copy of
another (e.g. the same file selected twice, or saved twice without
re-encoding) — confirms the grouping function actually groups them and
leaves genuinely different photos alone. As a **descriptive** (not
accuracy) measurement worth including in the Task 8 report: run the hasher
over the full `eval_data/photos/` set and report how many exact-duplicate
groups exist, if any — an interesting real number for the write-up, not a
metric being optimized.

**Metrics:** none (deterministic, not a classifier) — Task 8's report notes
this explicitly rather than manufacturing a precision/recall table that
wouldn't mean anything here.

**Threshold/config handling:** none — there is no threshold. (Documenting
the *absence* of one is itself part of "keep scoring and model versions
explainable," matching the project's existing principles: not every
cleanup signal needs a config file, and forcing one here would be the kind
of overbuilding the project's conventions warn against.)

**UI integration boundary:** same as blur/screenshot — `content_hash` is
computed and available on every `PhotoJob`, exposed for a future "you
selected this twice" or "you already uploaded this" UI; no review UI built
in this task.

- [ ] **Step 1: Write the failing tests**

```js
// apps/web/tests/cleanup.test.mjs (additions)
const { groupExactDuplicates } = require("../.eval-build/features/cleanup/duplicates.js");

test("groupExactDuplicates groups items sharing a hash and omits singletons", () => {
  const items = [
    { id: "a", content_hash: "h1" }, { id: "b", content_hash: "h1" },
    { id: "c", content_hash: "h2" },
  ];
  const groups = groupExactDuplicates(items);
  assert.deepEqual([...groups.keys()], ["h1"]);
  assert.deepEqual(groups.get("h1"), ["a", "b"]);
});
test("groupExactDuplicates returns an empty map when nothing repeats", () => {
  assert.equal(groupExactDuplicates([{ id: "a", content_hash: "h1" }]).size, 0);
});
```

`contentHash()` itself uses `crypto.subtle`, a browser/secure-context-only
API not available under plain Node `--test` — cover it with a manual
smoke check (Step 3) rather than a unit test, matching how `clientId()`
elsewhere in `prepare.ts` (also `crypto.getRandomValues`-based) has no
direct unit test either; `groupExactDuplicates` (pure, Node-testable) is
what actually needs and gets unit coverage here.

- [ ] **Step 2: Run to verify failure, then implement `duplicates.ts`**

```ts
// apps/web/features/cleanup/duplicates.ts
export async function contentHash(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function groupExactDuplicates<T extends { id: string; content_hash: string }>(
  items: T[],
): Map<string, string[]> {
  const byHash = new Map<string, string[]>();
  for (const item of items) {
    const list = byHash.get(item.content_hash) ?? [];
    list.push(item.id);
    byHash.set(item.content_hash, list);
  }
  for (const [hash, ids] of byHash) if (ids.length < 2) byHash.delete(hash);
  return byHash;
}
```

- [ ] **Step 3: Wire into `preparePhoto()` and smoke-test**

```ts
// prepare.ts
import { contentHash } from "../cleanup/duplicates";
// ...
export async function preparePhoto(file: File, maxThumbnailBytes: number): Promise<PhotoJob> {
  const meta = await extractMetadata(file);
  const prepared = await thumbnail(file, meta, maxThumbnailBytes);
  const content_hash = await contentHash(await file.arrayBuffer()).catch(() => null);
  return {
    input: {
      ...meta,
      client_id: clientId(),
      original_filename: file.name,
      content_type: contentType(file),
      file_size_bytes: file.size,
      thumbnail_size_bytes: prepared?.blob.size ?? null,
      blur_score: prepared?.blurScore ?? null,
      is_likely_screenshot, // from Task 3
      content_hash,
    },
    // ... unchanged
  };
}
```
Add `content_hash: string | null;` to `PhotoInput` in `types.ts`. Manually
verify in a browser (dev server, not a headless test) that selecting the
same file twice produces matching `content_hash` values — `crypto.subtle`
needs a real secure-context browser environment.

- [ ] **Step 4: Add the CLI descriptive-stat mode**

Extend `cleanup-cli.ts` with `--detector duplicates`: read every example's
`source_file`, compute a Node-side SHA-256 (`node:crypto`'s
`createHash("sha256")` over the file bytes — deliberately **not** reusing
`contentHash()`, which is `crypto.subtle`-based and browser-only; same
algorithm, different API, matching how blur's browser path uses Canvas
while its CLI path uses `sharp` for the same underlying computation), group
with `groupExactDuplicates`, and print the group count and sizes — no
`results.json`/metrics files needed (there's no metric), just a console
report.

- [ ] **Step 5: Full quality gate + commit**

```bash
npm --prefix apps/web run lint && npm --prefix apps/web run typecheck && npm --prefix apps/web test && npm --prefix apps/web run build
git add apps/web/features/cleanup/duplicates.ts apps/web/features/photos/prepare.ts \
  apps/web/features/photos/types.ts apps/web/evaluation/cleanup-cli.ts apps/web/tests/cleanup.test.mjs
git commit -m "Add exact-duplicate detection via SHA-256 content hash"
```

---

## Task 8: Documentation

**Files:**
- Modify: `docs/STATUS.md`
- Create: `docs/eval/003-cleanup-v1-experiments.md` (mirrors the existing
  `docs/eval/002-relevance-embedding-experiment-design.md` numbering)
- Create: `docs/reports/006-cleanup-v1-smoke-evidence.md` (measured smoke-test
  evidence, explicitly not real precision/recall — that needs the labeled
  fixtures this report names as still pending)
- Create: `docs/learning/007-cleanup-v1-techniques.md` (Korean, matching
  existing learning-note convention; interview-ready reasoning per technique)

- [ ] **Step 1: Write `docs/eval/003-cleanup-v1-experiments.md`**

Document, for each of the four signals (including duplicates): the exact
evaluation fixture needed (counts/composition, matching this plan's
per-task specs — none for duplicates, by design), how to run each CLI mode,
what the output means, and — explicitly — that no threshold or model choice
is a production decision until real labeled data has been run through it.
State plainly: face-heuristic and SigLIP2 results are pretrained baselines
being compared, not models being trained; duplicate detection has no
metrics because hash equality isn't a judgment call.

- [ ] **Step 2: Write `docs/reports/006-cleanup-v1-smoke-evidence.md`**

Record what was actually run and observed while implementing Tasks 1-7:
smoke-test commands and their real output (blur scores on the synthetic
solid/checkerboard images and any real photos eyeballed; screenshot
heuristic on any real screenshots/photos checked; face-heuristic and
SigLIP2 outputs on the 2-3 photos used in Tasks 4-5; the duplicate-group
count over `eval_data/photos/`, if run). Follow the existing report
convention exactly (`docs/reports/004-metadata-baseline.md`,
`docs/reports/005-event-context-correction.md`): measured evidence only,
explicitly labeled as smoke/plumbing verification, not accuracy metrics —
real precision/recall for blur/screenshot/selfie still needs the labeled
fixtures this task cannot manufacture.

- [ ] **Step 3: Write `docs/learning/007-cleanup-v1-techniques.md`**

Korean, matching the existing learning-note convention and tone (see
`docs/learning/006-vision-ai-direction-pivot.md` for the immediately
preceding one). Cover, per technique, tied to the actual files: why
Laplacian variance needs no model; why screenshot detection is a metadata
problem, not a vision problem; why selfie detection is being evaluated as
two pretrained baselines instead of assumed; why SHA-256 needs no evaluation
at all while the other three do; and why near-duplicate detection
(pHash/embedding similarity) is a deliberately separate, deferred problem
from exact-duplicate. Include an English interview-ready paragraph or two
for the most quotable decisions (mirroring learning note 006's format),
particularly: "why we evaluate selfie detection as a comparison between a
cheap heuristic and a pretrained vision-language model instead of assuming
which is right."

- [ ] **Step 4: Update `docs/STATUS.md`**

Add an `## Implemented` bullet describing what Tasks 1-7 build (blur
scoring + eval, screenshot heuristic + eval, selfie face-heuristic and
SigLIP2 zero-shot baselines + comparison, exact-duplicate content hashing —
all pending real labeled data for blur/screenshot/selfie to produce actual
measured numbers; duplicates need no labels). Update `## Next step` to state
that real measurement requires the labeled fixtures described in
`docs/eval/003-cleanup-v1-experiments.md`, that browser deployment of
selfie detection remains an open, evidence-gated decision, and that
near-duplicate detection and server-side duplicate storage (for the future
download-exclude promise) are deferred, separate future work.

- [ ] **Step 5: Commit**

```bash
git add docs/eval/003-cleanup-v1-experiments.md docs/reports/006-cleanup-v1-smoke-evidence.md \
  docs/learning/007-cleanup-v1-techniques.md docs/STATUS.md
git commit -m "Document Pre-upload Cleanup v1 techniques, smoke evidence, and open questions"
```

---

## Self-Review Notes

- **Spec coverage:** blur (Tasks 1-2), screenshot heuristic baseline only,
  not the zero-shot comparison (Task 3, per "if needed" — deferred pending
  Task 3's own measured results), selfie heuristic-vs-SigLIP2 comparison
  (Tasks 4-6, offline only, no browser deployment decided). Threshold/config
  handling addressed per-task (continuous+config for blur, config-driven
  format/dimension list for screenshot, deliberately un-configured sweep
  parameter for selfie since no production decision exists yet). UI
  integration boundary is explicit and minimal for blur/screenshot (data
  computed and exposed on `PhotoJob`, no review UI built) and explicitly
  none for selfie.
- **Known open decisions, not blocking, flagged for implementation time:**
  Task 3's JSON-config-import mechanism into the browser bundle (direct
  import vs. a generated copy); Task 6's CLI shape (extend `cleanup-cli.ts`
  vs. a dedicated script).
- **Explicitly not in this plan, matching the instruction:** any production
  classifier decision, duplicate detection, API calls, event relevance,
  clustering, or a review/exclude UI component.
