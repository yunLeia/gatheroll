# Cleanup v1 Real-Evaluation Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Presented for review/approval first, per explicit user instruction — do not dispatch yet.**

**Goal:** Respond to real evaluation results from the user's own labeled
49-photo set (`eval_data/cleanup-manifest.json`): (1) add a SigLIP2
zero-shot visual experiment for screenshot detection, since the metadata
heuristic measured 0% recall on real screenshots; (2) add an eval-only path
so blur evaluation can actually score HEIC photos instead of silently
excluding 15/49 (31%) of the labeled set; (3) record all three real findings
(screenshot heuristic failure, blur HEIC blocker, duplicate scan clean) in
the existing docs. No production behavior changes.

**Root causes, confirmed by direct reproduction, not assumed:**
- Screenshot: all 24 real screenshots have `content_type: image/png`
  (format check passed) at **1206×2622** — a real device resolution not in
  `DEFAULT_SCREENSHOT_CONFIG.known_dimensions` (8 guessed iPhone sizes).
  Confirms the proposal's own framing: a hardcoded device-resolution list is
  structurally fragile, not a bug to patch with a 9th entry.
- Blur/HEIC: `sharp(...).raw().toBuffer()` fails on **15/15** real labeled
  HEIC files with `heif: Decoder plugin generated an error` — a systematic
  libvips/heif-plugin limitation in this environment, not per-file
  corruption (every file fails identically).

**Architecture:** Screenshot gets a second offline Python baseline
(`screenshot_zero_shot.py`), mirroring `selfie_zero_shot.py`'s exact
pattern (2 prompts instead of 3), plus a TS comparison extension to the
existing `--detector screenshot` CLI mode — reusing infrastructure, not
duplicating it. Blur gets a small eval-only HEIC→JPEG bridge in
`cleanup-cli.ts` using `sips` (already present on this macOS dev machine,
zero new dependency), writing cached copies under gitignored `eval_data/`,
with a fallback to "mark undecodable, exclude from metrics, report the
count" when conversion isn't available — never touching
`computeBlurScore` or the original HEIC files.

**Spec:** This plan responds directly to the user's message reporting real
results; no separate design doc — the findings above are the design basis.

## Global Constraints

- Do not change `computeBlurScore` or `isLikelyScreenshot` (the algorithms
  themselves) — this plan adds an eval-only decode bridge and a second
  baseline to compare against, not algorithm tuning.
- Do not tune `known_dimensions` further (adding the one missing resolution
  would "fix" this specific set without addressing the structural problem
  the user identified — the metadata heuristic is being retired as a
  screenshot *decision*, not patched).
- Original HEIC files are never modified, moved, or deleted. Any JPEG copy
  is a cache artifact under gitignored `eval_data/`.
- Selfie detection stays offline-only (unchanged from before) — not
  touched by this plan.
- Still no production/browser wiring for screenshot's new SigLIP2 baseline,
  matching the existing selfie precedent (evaluation only, no shipping
  decision made here).
- Web quality gates: `npm run lint`, `npm run typecheck`, `npm test`,
  `npm run build`.

---

## Task 1: Screenshot SigLIP2 zero-shot baseline (Python, offline)

**Files:**
- Create: `eval/cleanup/screenshot_zero_shot.py`
- Modify: `eval/cleanup/README.md`

**Interfaces:**
- Consumes: a `CleanupDataset`-shaped manifest (same as `selfie_zero_shot.py`).
- Produces: JSON artifact `{ "<photo_id>": { "screenshot": float,
  "camera_photo": float, "predicted_label": "screenshot"|"camera_photo" } }`,
  consumed by Task 2.

**Input/output contract:** identical shape/pattern to `selfie_zero_shot.py`
(same `DEFAULT_MODEL`, same `AutoModel.from_pretrained` eval-mode-only
usage — no fine-tuning here either), except two prompts instead of three:

```python
PROMPTS = {
    "screenshot": "a screenshot of a mobile app or phone screen",
    "camera_photo": "a natural photograph taken with a camera",
}
```

- [ ] **Step 1: Write `screenshot_zero_shot.py`**

Copy `selfie_zero_shot.py` verbatim except: module docstring says
"screenshot-detection experiment" instead of "selfie-detection experiment";
`PROMPTS` is the two-entry dict above; nothing else changes (same
`load_manifest`, `resolve_source`, `main` structure, same `--model` flag,
same traversal guard, same refuse-to-overwrite `--out` check).

- [ ] **Step 2: Smoke-test against a handful of real labeled screenshots and camera photos**

```bash
cd eval/cleanup && source .venv/bin/activate
python3 screenshot_zero_shot.py --manifest ../../eval_data/cleanup-manifest.json --root ../../eval_data/photos --out ../../eval_data/screenshot-zero-shot-v1.json
```
Confirm the output shape and that a few known screenshots/camera photos get
plausible `predicted_label` values (spot-check only — the real precision/
recall comes from Task 2's CLI over the *full* labeled set, not eyeballing).

- [ ] **Step 3: Update `eval/cleanup/README.md`**

Add a short section for `screenshot_zero_shot.py`, matching the existing
face-heuristic/selfie-zero-shot sections' structure, and note it exists
specifically because the metadata heuristic measured 0% recall on the real
set (link to the report Task 3 will update).

- [ ] **Step 4: Commit**

```bash
git add eval/cleanup/screenshot_zero_shot.py eval/cleanup/README.md
git commit -m "Add SigLIP2 zero-shot baseline for screenshot experiment (evaluation only)"
```

---

## Task 2: Wire the screenshot comparison + fix blur's HEIC handling (TypeScript CLI)

**Files:**
- Modify: `apps/web/evaluation/cleanup-reporting.ts` (new shared error-listing helper)
- Modify: `apps/web/evaluation/cleanup-cli.ts` (screenshot SigLIP comparison; blur HEIC bridge)
- Test: extend `apps/web/tests/cleanup.test.mjs`

### 2a. Shared FP/FN error listing (reused by screenshot comparison, and
useful for any future binary-label detector)

**Interfaces:**
- Produces: `BinaryErrorRow`, `binaryErrorKind(row): "FP" | "FN" | null`,
  `binaryErrorsMarkdown(rows, title): string`.

- [ ] **Step 1: Write the failing test**

```js
// apps/web/tests/cleanup.test.mjs (additions)
const { binaryErrorKind, binaryErrorsMarkdown } = require("../.eval-build/evaluation/cleanup-reporting.js");

test("binaryErrorKind classifies FP/FN, null when correct", () => {
  assert.equal(binaryErrorKind({ label: false, predicted: true }), "FP");
  assert.equal(binaryErrorKind({ label: true, predicted: false }), "FN");
  assert.equal(binaryErrorKind({ label: true, predicted: true }), null);
  assert.equal(binaryErrorKind({ label: false, predicted: false }), null);
});
test("binaryErrorsMarkdown lists only FP/FN rows with the given title", () => {
  const md = binaryErrorsMarkdown(
    [
      { photo_id: "a", label: true, predicted: false, notes: "missed screenshot" },
      { photo_id: "b", label: true, predicted: true, notes: "correct" },
    ],
    "Screenshot SigLIP2 errors",
  );
  assert.ok(md.includes("Screenshot SigLIP2 errors"));
  assert.ok(md.includes("missed screenshot"));
  assert.ok(!md.includes("correct"));
});
```

- [ ] **Step 2: Run to verify failure, then implement in `cleanup-reporting.ts`**

```ts
export type BinaryErrorRow = { photo_id: string; label: boolean; predicted: boolean; notes: string };

export function binaryErrorKind(row: Pick<BinaryErrorRow, "label" | "predicted">): "FP" | "FN" | null {
  if (!row.label && row.predicted) return "FP";
  if (row.label && !row.predicted) return "FN";
  return null;
}

export function binaryErrorsMarkdown(rows: BinaryErrorRow[], title: string): string {
  const safe = (v: unknown) =>
    String(v ?? "missing").replaceAll("|", "\\|").replace(/[\r\n]/g, " ").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const header = `# ${title}\n\n| ID | Label | Predicted | Error | Note |\n|---|---|---|---|---|\n`;
  return (
    header +
    rows
      .filter((r) => binaryErrorKind(r))
      .map((r) => `| ${safe(r.photo_id)} | ${r.label} | ${r.predicted} | ${binaryErrorKind(r)} | ${safe(r.notes)} |`)
      .join("\n") +
    "\n"
  );
}
```

- [ ] **Step 3: Run to verify pass**

Run: `npm --prefix apps/web run eval:build && node --test apps/web/tests/cleanup.test.mjs`

### 2b. Screenshot SigLIP2 comparison in `cleanup-cli.ts`

**Interfaces:**
- Consumes: Task 1's artifact via a new `--siglip-artifact` flag on
  `--detector screenshot` (same flag name already used by `--detector
  selfie`, reused rather than inventing a new one).
- Produces: when `--siglip-artifact` is supplied, an additional
  `siglip_zero_shot` metrics block in `results.json`, a
  `screenshot-siglip-errors.md` file, and a console table showing **both**
  techniques side by side (metadata heuristic vs. SigLIP2) for direct
  comparison.

- [ ] **Step 1: Extend `runScreenshot`**

```ts
async function runScreenshot(values: ReturnType<typeof parseArgs>["values"]) {
  const dataset = await loadCleanupDataset(values.manifest as string);
  const config: ScreenshotConfig = JSON.parse(await readFile(values.config as string, "utf8"));
  const labeled = dataset.examples.filter((e) => e.is_screenshot !== null);
  if (!labeled.length) throw new Error("No examples have is_screenshot labeled");

  const rows = await Promise.all(
    labeled.map(async (e) => {
      const file = await resolveCleanupPhoto(values.root as string, e.source_file);
      const meta = await sharp(file).metadata();
      const content_type = meta.format ? `image/${meta.format === "jpeg" ? "jpeg" : meta.format}` : "";
      const predicted = isLikelyScreenshot(
        { content_type, width: meta.width ?? null, height: meta.height ?? null, has_camera_exif: meta.exif !== undefined },
        config,
      );
      return { photo_id: e.photo_id, label: e.is_screenshot!, predicted, content_type, notes: e.notes };
    }),
  );
  const metrics = binaryMetrics(rows);

  let siglipMetrics = null;
  let siglipRows: { photo_id: string; label: boolean; predicted: boolean; notes: string }[] = [];
  if (values["siglip-artifact"]) {
    const siglipArtifact = JSON.parse(await readFile(values["siglip-artifact"] as string, "utf8"));
    siglipRows = labeled.map((e) => ({
      photo_id: e.photo_id,
      label: e.is_screenshot!,
      predicted: siglipArtifact.results[e.photo_id]?.predicted_label === "screenshot",
      notes: e.notes,
    }));
    siglipMetrics = binaryMetrics(siglipRows);
  }

  const out = path.resolve(values.out as string);
  await mkdir(path.dirname(out), { recursive: true });
  await mkdir(out, { mode: 0o700 });
  const files: [string, string][] = [
    ["results.json", JSON.stringify({ config, metrics, rows, siglip_zero_shot: siglipMetrics }, null, 2) + "\n"],
    ["predictions.csv", csv(rows)],
  ];
  if (siglipMetrics) {
    files.push(["siglip-predictions.csv", csv(siglipRows)]);
    files.push(["screenshot-siglip-errors.md", binaryErrorsMarkdown(siglipRows, "Screenshot SigLIP2 zero-shot errors")]);
  }
  await Promise.all(files.map(([name, content]) => writeFile(path.join(out, name), content, { mode: 0o600, flag: "wx" })));
  console.table({ metadata_heuristic: metrics, ...(siglipMetrics ? { siglip_zero_shot: siglipMetrics } : {}) });
  console.log(`Wrote ${files.map(([name]) => name).join(", ")} to ${out}. Treat output as private.`);
}
```

Add `"siglip-artifact": { type: "string" }` to `parseArgs` options (the
existing `--face-artifact`/`--siglip-artifact` pair from selfie mode already
covers the flag name; no new option needed beyond what selfie already
declares, since `parseArgs`'s options object is shared across detectors).

- [ ] **Step 2: Full quality gate**

Run: `npm --prefix apps/web run lint && npm --prefix apps/web run typecheck && npm --prefix apps/web test && npm --prefix apps/web run build`

### 2c. Blur eval-only HEIC bridge

**Interfaces:**
- Produces: `ensureJpegEvalCopy(originalPath, cacheDir): Promise<string | null>`
  (returns a decodable path — the original if already JPEG/PNG/etc., a
  cached JPEG conversion if HEIC/HEIF and conversion succeeds, or `null` if
  conversion isn't possible) — used only inside `runBlur`, not exported for
  reuse elsewhere (this is a narrow eval-CLI concern, not a general utility).

**Input/output contract:** input is a resolved absolute file path; output
is either a path to a JPEG `sharp` can decode, or `null` meaning "genuinely
undecodable in this environment, do not fabricate a score." Never modifies
or moves the original file — writes only into a new cache directory.

- [ ] **Step 1: Implement the bridge in `cleanup-cli.ts`**

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, mkdir as mkdirAsync } from "node:fs/promises";
const execFileAsync = promisify(execFile);

const HEIC_JPEG_CACHE_DIR = path.resolve("../../eval_data/.heic-jpeg-cache");

// Eval-only bridge: sharp/libvips's heif plugin fails on real HEIC files in
// this environment (confirmed: 15/15 real labeled HEIC files, all with the
// same "Decoder plugin generated an error" failure -- a systematic
// limitation, not per-file corruption). Uses macOS's built-in `sips` to
// produce a cached JPEG copy for evaluation only; the original HEIC is
// never touched. Falls back to null (caller marks the row undecodable) if
// sips is unavailable (e.g. non-macOS) or conversion itself fails -- never
// throws, never blocks the rest of the run.
async function ensureJpegEvalCopy(originalPath: string): Promise<string | null> {
  if (!/\.(heic|heif)$/i.test(originalPath)) return originalPath;
  await mkdirAsync(HEIC_JPEG_CACHE_DIR, { recursive: true });
  const cached = path.join(HEIC_JPEG_CACHE_DIR, path.basename(originalPath) + ".jpg");
  try {
    await access(cached);
    return cached; // already converted in a prior run
  } catch {
    /* not cached yet */
  }
  try {
    await execFileAsync("sips", ["-s", "format", "jpeg", originalPath, "--out", cached]);
    return cached;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Use it in `runBlur`, tracking undecodable rows separately from scored rows**

```ts
async function runBlur(values: ReturnType<typeof parseArgs>["values"]) {
  const dataset = await loadCleanupDataset(values.manifest as string);
  const config: CleanupConfig = JSON.parse(await readFile(values.config as string, "utf8"));
  const labeled = dataset.examples.filter((e) => e.is_blurry !== null);
  if (!labeled.length) throw new Error("No examples have is_blurry labeled");

  const scored: { photo_id: string; label: boolean; blur_score: number; predicted: boolean; notes: string }[] = [];
  const undecodable: { photo_id: string; source_file: string; notes: string }[] = [];
  for (const e of labeled) {
    const file = await resolveCleanupPhoto(values.root as string, e.source_file);
    const evalPath = await ensureJpegEvalCopy(file);
    if (evalPath === null) {
      undecodable.push({ photo_id: e.photo_id, source_file: e.source_file, notes: e.notes });
      continue;
    }
    const pixels = await pixelsFromFile(evalPath);
    const blur_score = computeBlurScore(pixels);
    scored.push({ photo_id: e.photo_id, label: e.is_blurry!, blur_score, predicted: possiblyBlurry(blur_score, config), notes: e.notes });
  }
  if (undecodable.length) {
    console.warn(
      `${undecodable.length}/${labeled.length} labeled photo(s) could not be decoded for blur scoring and were excluded from metrics: ` +
        undecodable.map((u) => u.photo_id).join(", "),
    );
  }
  const metrics = binaryMetrics(scored);
  // ... sweep/output logic unchanged except it maps over `scored`, and the
  // written results.json additionally includes `undecodable` and
  // `undecodable_count` so this is visible in the artifact, not just stderr.
```

The rest of `runBlur` (sweep, file writes, console table) stays structurally
the same, operating on `scored` instead of the previous unconditional `rows`,
plus `undecodable`/`undecodable_count` added to the `results.json` payload.

- [ ] **Step 3: Extend the tests**

```js
// apps/web/tests/cleanup.test.mjs -- these test the pure pieces reachable
// without shelling out to sips (that path is exercised by the real smoke
// test in Step 4, not unit tests, matching how the Python scripts' HEIC
// handling was never unit-tested either -- it's an environment-dependent
// integration concern).
```
(No new unit test is added purely for `ensureJpegEvalCopy` itself, since it
shells out to a system binary — matching the existing precedent that
`contentHash()`/`crypto.subtle` and other environment-dependent pieces are
smoke-tested, not unit-tested. The `binaryMetrics`/`groupExactDuplicates`-style
pure logic this task touches is already covered by Task 2a's tests plus the
existing blur suite.)

- [ ] **Step 4: Real smoke test against the actual labeled HEIC files**

```bash
npm --prefix apps/web run eval:cleanup -- \
  --manifest ../../eval_data/cleanup-manifest.json --root ../../eval_data/photos \
  --detector blur --sweep
```
Confirm: `sips` availability is detected (this is macOS), all 15 previously-
undecodable HEIC rows now produce real `blur_score` values, `results.json`
reports `undecodable_count: 0` (or names whichever specific files still
fail, if any — do not assume 100% recovery without checking), and the
metrics now reflect the full 49-photo set rather than 34.

- [ ] **Step 5: Full quality gate + commit**

```bash
npm --prefix apps/web run lint && npm --prefix apps/web run typecheck && npm --prefix apps/web test && npm --prefix apps/web run build
git add apps/web/evaluation/cleanup-reporting.ts apps/web/evaluation/cleanup-cli.ts apps/web/tests/cleanup.test.mjs
git commit -m "Add screenshot SigLIP2 comparison and an eval-only HEIC bridge for blur scoring"
```

Also add `eval_data/.heic-jpeg-cache/` to nothing new in `.gitignore` — it's
already covered by the existing blanket `eval_data/` ignore rule; confirm
this with `git status` rather than assuming, and only add an explicit
entry if the blanket rule somehow doesn't cover it.

---

## Task 3: Record the real findings in the existing docs

**Files:**
- Create: `docs/reports/007-cleanup-v1-real-evaluation.md` (real measured
  accuracy — a new milestone distinct from report 006, which was explicitly
  "smoke evidence, not accuracy metrics"; this one has actual precision/
  recall on a real 49-photo labeled set)
- Modify: `docs/learning/007-cleanup-v1-techniques.md` (dated addendum
  section — same file, continuing the same topic, not a new number)
- Modify: `docs/eval/003-cleanup-v1-experiments.md` (add the screenshot
  zero-shot run instructions; note the blur HEIC bridge)
- Modify: `docs/STATUS.md`

- [ ] **Step 1: Write `docs/reports/007-cleanup-v1-real-evaluation.md`**

Structure, matching the existing report format:
- **Screenshot metadata heuristic: real result.** 49 total, 24 real
  screenshots. TP 0, FP 0, FN 24, TN 25. Recall 0%, FPR 0%, precision null
  (0/0, not fabricated as 0). Root cause, confirmed by direct inspection:
  every real screenshot's `content_type` correctly resolved to `image/png`
  (the format check works), but their actual resolution (1206×2532 or
  whatever Task 1/2's real run confirms) is not in the hardcoded
  `known_dimensions` list. State plainly: this is retired as a production
  candidate, not scheduled for further tuning (adding one more resolution
  to the list would not fix the structural problem — a new device model
  breaks it again).
- **Screenshot SigLIP2 zero-shot: real result.** Precision/recall/FPR from
  Task 2's actual run against the same 49-photo set, plus the main FP/FN
  photo_ids and notes from `screenshot-siglip-errors.md` (do not
  editorialize about why specific errors happened beyond what the note
  field and predicted label actually show).
- **Blur: HEIC blocker and its resolution.** 15/15 real labeled HEIC files
  failed to decode via `sharp` (`heif: Decoder plugin generated an error`)
  before this fix — a systematic environment limitation, not per-file
  corruption. After the `sips`-based eval-only JPEG bridge (Task 2c): real
  precision/recall/sweep numbers from the now-complete 49-photo run (or the
  actual smaller number if any HEIC files still fail — report exactly what
  happened, not an assumed 100% recovery).
- **Duplicates: confirmed no changes needed.** 0 exact-duplicate groups in
  the real set (already measured in report 006) — restate briefly with a
  cross-reference rather than re-deriving.

- [ ] **Step 2: Add a dated addendum to `docs/learning/007-cleanup-v1-techniques.md`**

Korean, matching the file's existing tone. Cover: the screenshot section's
prediction ("하드코딩된 해상도 목록은 fragile하다") was directly confirmed by
real data, not just reasoned about in the abstract — state the real 0%
recall number and the real resolution that was missing. Add why SigLIP2
zero-shot is structurally a better fit for screenshot detection than
extending the dimension list (content-based, not enumeration-based — a new
phone model doesn't break it). Note the HEIC finding as a separate,
unrelated-to-the-AI-direction environment/tooling lesson (a local library
limitation, not a product decision).

- [ ] **Step 3: Update `docs/eval/003-cleanup-v1-experiments.md`**

In the screenshot section, add the `screenshot_zero_shot.py` +
`--detector screenshot --siglip-artifact PATH` run instructions (mirroring
the selfie section's two-script-then-compare pattern). In the blur section,
note that HEIC files are now handled via a cached eval-only JPEG bridge
(`sips`, macOS-only, gracefully degrades to excluded+reported on other
platforms) and that `results.json` now reports `undecodable_count`.

- [ ] **Step 4: Update `docs/STATUS.md`**

Add a bullet under `## Verified` (not `## Implemented` — this is measured
evidence, not a new capability) stating the real screenshot heuristic
result (0% recall, retired), the real HEIC finding and fix, and pointing at
report 007. Update `## Next step` to remove "collect screenshot labels"
(done) and state what's left: blur/selfie still need broader real
precision/recall interpretation (49 photos is a start, not the full
100–250 target the original relevance labeling guide used as a reference
scale), and no production/browser decision exists yet for any of the four
signals.

- [ ] **Step 5: Commit**

```bash
git add docs/reports/007-cleanup-v1-real-evaluation.md docs/learning/007-cleanup-v1-techniques.md \
  docs/eval/003-cleanup-v1-experiments.md docs/STATUS.md
git commit -m "Record real cleanup v1 evaluation findings (screenshot 0% recall, HEIC blocker+fix)"
```

---

## Self-Review Notes

- **Spec coverage:** screenshot SigLIP2 experiment (Task 1-2b), blur HEIC
  eval-only bridge (Task 2c), documentation of all three real findings
  including the already-clean duplicate scan (Task 3). Report precision/
  recall/FPR/main-FP-FN for screenshot SigLIP2 — covered by Task 2b's
  `binaryMetrics` + `binaryErrorsMarkdown`, written up in Task 3's report.
- **Explicitly not done, matching the instruction:** no change to
  `computeBlurScore` or `isLikelyScreenshot`; no browser/production wiring
  for screenshot's new baseline; no further `known_dimensions` tuning.
- **Real numbers this plan cannot predict in advance:** the actual
  precision/recall/FPR of screenshot SigLIP2, and whether all 15 HEIC files
  actually recover via `sips` (vs. some still failing) — Task 3's report
  must be written from Task 1/2's *actual* run output, not assumed
  favorable results.
