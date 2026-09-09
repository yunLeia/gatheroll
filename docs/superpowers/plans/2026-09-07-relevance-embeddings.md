# Event-Relevance Embedding Experiment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Do not dispatch this plan yet — it is presented for review/agreement first, per explicit user instruction.**

**Goal:** Add a local, offline SigLIP 2 embedding-similarity experiment for
event relevance (centroid / nearest-neighbor / top-k mean baselines,
compared against the existing `all_selected` baseline) on a small real
labeled dataset (~30–50 photos), without touching production code, without
classification/clustering/pgvector/API calls, and without letting human
labels leak into the scoring path.

**Architecture:** A one-time local Python step (Hugging Face + PyTorch +
SigLIP 2) reads private local photos and writes a local, gitignored
embedding artifact (`photo_id → vector`). The existing TypeScript evaluator
(`apps/web/evaluation/`) loads that artifact and adds a second evaluation
path — grouped by `event_id` rather than per-example — that computes
similarity-based scores with mandatory self-exclusion, reusing the existing
metrics contract (`reporting.ts`) but with a new `Row` shape carrying
neighbor-count and cross-participant-support fields instead of
time/GPS fields.

**Tech Stack:** Python 3.11 + `transformers` + `torch` (new, eval-only,
isolated venv). Existing TypeScript/Node evaluator, `node --test`.

**Spec:** [docs/eval/002-relevance-embedding-experiment-design.md](../../eval/002-relevance-embedding-experiment-design.md)
— read this first; every task below implements a specific numbered section
of it. This plan argues from that spec; conflicts resolve in the spec's favor.

## Global Constraints

- The relevance algorithm may never read a human `belongs`/`does_not_belong`
  label before metrics are computed (spec §2, §3).
- Candidate self-exclusion is mandatory in every similarity computation
  (spec §6).
- Cross-participant support is recorded, never scored (spec §7).
- Missing/undefined similarity is `null`, decision defers to `"review"` —
  never a fabricated `0` or auto-exclude (spec §8, reusing the existing
  `decision()` null convention in `scoring.ts`).
- No clustering, no classification, no pgvector, no OpenAI/Anthropic API
  calls, no changes to `apps/api` or any production code path (spec §15).
- The Python step never uploads images anywhere; it only reads local files
  and writes a local artifact (spec §4).
- Reuse the existing metrics contract in `reporting.ts` (strict vs. all-row,
  ambiguous handling, null-not-zero) exactly — no new metrics semantics
  (spec §10).
- All labeled examples stay in `split: "development"`; this experiment does
  not claim a held-out generalization result (spec §11).

---

## Task 1: Add `participant_id` to the dataset schema

**Files:**
- Modify: `apps/web/evaluation/dataset.ts`
- Modify: `eval/manifests/local-template.json`
- Modify: `docs/eval/event-relevance-labeling.md`
- Test: `apps/web/tests/evaluation.test.mjs` (extend existing schema tests)

**Interfaces:**
- Produces: `Example.participant_id: string` (required field, same `id()`
  validation as `photo_id`/`event_id`), consumed by Task 3's grouping logic.

The similarity baselines need to know which participant contributed each
candidate (spec §2 "may see participant_id", §7 cross-participant support).
Add it as a required field on `Example`, validated the same way existing IDs
are.

- [ ] **Step 1: Extend the `Example` type and validator**

In `apps/web/evaluation/dataset.ts`, add `participant_id: string` to the
`Example` type (after `event_id`) and to the `keys()` allowlist and
validation in `validateDataset`:

```ts
export type Example = {
  photo_id: string; event_id: string; participant_id: string; label: Label;
  notes: string; tags: string[]; split: "development" | "test";
  source_file?: string; metadata?: Metadata;
};
```

```ts
    keys(example, ["photo_id", "event_id", "participant_id", "label", "notes", "tags", "split", "source_file", "metadata"]);
    id(example.photo_id); id(example.event_id); id(example.participant_id);
```

- [ ] **Step 2: Update the manifest template and labeling doc**

In `eval/manifests/local-template.json`'s doc-comment example (and
`eval/README.md`'s inline example, both currently show a bare `examples`
row) add `"participant_id": "leia"` (a pseudonym, matching the existing
`photo_id`/`event_id` pseudonym convention) to the example row. Add one
sentence to `docs/eval/event-relevance-labeling.md`'s labeling procedure
noting `participant_id` must be recorded per photo — it identifies who
selected the candidate, not a real name.

- [ ] **Step 3: Write/extend the schema tests**

Add a case to the existing dataset-schema tests in
`apps/web/tests/evaluation.test.mjs` (find the existing "rejects unknown
field" / "requires photo_id" style tests and follow that exact pattern):
a manifest missing `participant_id` is rejected, and a valid manifest with
it is accepted.

- [ ] **Step 4: Run the existing eval test suite**

Run: `npm --prefix apps/web test`
Expected: existing evaluation tests still pass with the new field wired in;
new test(s) pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/evaluation/dataset.ts eval/manifests/local-template.json \
  docs/eval/event-relevance-labeling.md apps/web/tests/evaluation.test.mjs
git commit -m "Add participant_id to the eval dataset schema"
```

---

## Task 2: Python SigLIP 2 embedding generator

**Files:**
- Create: `eval/embeddings/generate.py`
- Create: `eval/embeddings/requirements.txt`
- Create: `eval/embeddings/README.md`

**Interfaces:**
- Consumes: a manifest JSON (same shape as the TS evaluator's `--manifest`,
  read only for `photo_id` → `source_file` pairs; does not need `label`)
  and `--root` (photo directory), matching the existing CLI's argument
  shape for consistency.
- Produces: an embedding artifact JSON:
  `{ "model": "<hf checkpoint id>", "dim": <int>, "embeddings": { "<photo_id>": [<float>, ...], ... } }`
  written to a path the user supplies with `--out` (never overwrites an
  existing file, matching the existing TS CLI's `wx`-flag no-overwrite
  convention) — consumed by Task 3's TypeScript loader.

This is a standalone, isolated Python tool — not part of `apps/api`'s
production dependency tree. It is invoked manually, once per labeled batch,
not by any service.

- [ ] **Step 1: Write `requirements.txt`**

```
transformers>=4.45,<5
torch>=2.4,<3
pillow>=10,<12
```

- [ ] **Step 2: Set up an isolated venv and install**

```bash
cd eval/embeddings
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

- [ ] **Step 3: Write `generate.py`**

```python
#!/usr/bin/env python3
"""Generate SigLIP 2 image embeddings for a local, private eval manifest.

Reads only local files named in the manifest. Never uploads or transmits
images. Writes a local JSON artifact mapping photo_id -> embedding vector.
"""

import argparse
import json
import sys
from pathlib import Path

import torch
from PIL import Image
from transformers import AutoModel, AutoProcessor

DEFAULT_MODEL = "google/siglip2-base-patch16-224"


def load_manifest(manifest_path: Path) -> list[tuple[str, str]]:
    data = json.loads(manifest_path.read_text())
    if data.get("kind") != "local_private":
        raise SystemExit("Only local_private manifests are supported (no synthetic fixtures).")
    return [(row["photo_id"], row["source_file"]) for row in data["examples"]]


def resolve_source(root: Path, source_file: str) -> Path:
    # Mirror the TypeScript loader's traversal guard: resolve and require
    # the result to stay inside root.
    resolved = (root / source_file).resolve()
    root_resolved = root.resolve()
    if root_resolved not in resolved.parents and resolved != root_resolved:
        raise SystemExit(f"Source escapes photo root: {source_file}")
    return resolved


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    args = parser.parse_args()

    if args.out.exists():
        raise SystemExit(f"Refusing to overwrite existing artifact: {args.out}")

    pairs = load_manifest(args.manifest)
    if not pairs:
        raise SystemExit("Manifest has no examples.")

    processor = AutoProcessor.from_pretrained(args.model)
    model = AutoModel.from_pretrained(args.model)
    model.eval()

    embeddings: dict[str, list[float]] = {}
    dim: int | None = None
    with torch.no_grad():
        for photo_id, source_file in pairs:
            path = resolve_source(args.root, source_file)
            image = Image.open(path).convert("RGB")
            inputs = processor(images=image, return_tensors="pt")
            features = model.get_image_features(**inputs)
            vector = features[0].tolist()
            dim = dim or len(vector)
            embeddings[photo_id] = vector
            print(f"embedded {photo_id}", file=sys.stderr)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps({"model": args.model, "dim": dim, "embeddings": embeddings}, indent=2) + "\n")
    print(f"Wrote {len(embeddings)} embeddings ({dim}-d) to {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Write `eval/embeddings/README.md`**

Document: setup (venv + install), invocation
(`python3 generate.py --manifest ../../eval_data/manifest.json --root ../../eval_data/photos --out ../../eval_data/embeddings-v1.json`),
that the output belongs under gitignored `eval_data/` (never committed —
matches the existing `.gitignore` entry), the default model checkpoint and
why (`google/siglip2-base-patch16-224` — CPU-feasible size for ~30–50
images; note it is a starting default, not a tuned choice, and can be
overridden with `--model`), and that this tool is invoked manually, never by
CI or any service.

- [ ] **Step 5: Run it against a couple of real photos as a smoke test**

Run (from `eval/embeddings`, after building a manifest per Task 5):
```bash
python3 generate.py --manifest ../../eval_data/manifest.json --root ../../eval_data/photos --out ../../eval_data/embeddings-v1.json
```
Expected: one embedding per manifest row, no network calls beyond the
one-time Hugging Face model download, output file written under
`eval_data/`. (This step depends on Task 5's manifest existing — order
Task 5 before running this smoke test, even though the script itself can be
written and reviewed beforehand.)

- [ ] **Step 6: Commit**

```bash
git add eval/embeddings/generate.py eval/embeddings/requirements.txt eval/embeddings/README.md
git commit -m "Add local SigLIP 2 embedding generator for event-relevance eval"
```

(`eval/embeddings/.venv/` must be gitignored — confirm the existing root
`.gitignore`'s Python venv pattern already covers it, or add
`eval/embeddings/.venv/` explicitly if not.)

---

## Task 3: TypeScript similarity baselines (centroid / nearest-neighbor / top-k mean)

**Files:**
- Create: `apps/web/evaluation/embeddings.ts`
- Test: `apps/web/tests/embeddings.test.mjs`

**Interfaces:**
- Consumes: the embedding artifact shape from Task 2
  (`{ model, dim, embeddings: Record<photo_id, number[]> }`) and
  `Example[]` (with `participant_id` from Task 1).
- Produces: `EmbeddingBaseline` type, `embeddingConfig` type, and
  `predictEmbedding(candidate, others, config, baseline)` — the per-candidate
  scoring function Task 4 calls once per (baseline, candidate) pair, where
  `others` is already the correctly self-excluded, same-event candidate list.

This is the algorithmic core and has no dependency on Python/real photos —
fully unit-testable with small synthetic vectors.

- [ ] **Step 1: Write the failing tests**

```js
// apps/web/tests/embeddings.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import { readFile } from "node:fs/promises";
const source = await readFile(new URL("../evaluation/embeddings.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { cosineSimilarity, groupByEvent, predictEmbedding, embeddingBaselines } =
  await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`);

const CONFIG = { version: "embeddings-v1-provisional", k: 2, select_threshold: 0.8, review_threshold: 0.5 };

test("cosine similarity of identical vectors is 1, orthogonal is 0", () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
});

test("groupByEvent excludes the candidate itself from its own neighborhood", () => {
  const rows = [
    { photo_id: "a", event_id: "e1", participant_id: "p1" },
    { photo_id: "b", event_id: "e1", participant_id: "p2" },
    { photo_id: "c", event_id: "e2", participant_id: "p1" },
  ];
  const groups = groupByEvent(rows);
  const others = groups.get("e1").filter(r => r.photo_id !== "a");
  assert.deepEqual(others.map(r => r.photo_id), ["b"]);
});

test("centroid baseline scores the candidate against the mean of others", () => {
  const embeddings = { a: [1, 0], b: [1, 0], c: [0, 1] };
  const others = [{ photo_id: "b", participant_id: "p2" }, { photo_id: "c", participant_id: "p3" }];
  const result = predictEmbedding({ photo_id: "a", participant_id: "p1" }, others, embeddings, CONFIG, "siglip_centroid");
  // mean of [1,0] and [0,1] is [0.5,0.5]; cosine(a=[1,0], [0.5,0.5]) = 0.5^0.5... just assert it's between 0 and 1
  assert.ok(result.score > 0 && result.score < 1);
  assert.equal(result.neighbor_count, 2);
});

test("nearest-neighbor baseline picks the single closest other candidate and records its participant", () => {
  const embeddings = { a: [1, 0], b: [0.9, 0.1], c: [0, 1] };
  const others = [{ photo_id: "b", participant_id: "p2" }, { photo_id: "c", participant_id: "p3" }];
  const result = predictEmbedding({ photo_id: "a", participant_id: "p1" }, others, embeddings, CONFIG, "siglip_nearest_neighbor");
  assert.equal(result.nearest_neighbor_photo_id, "b");
  assert.equal(result.nearest_neighbor_participant_id, "p2");
  assert.equal(result.same_participant_support, false);
});

test("nearest-neighbor records same-participant support when the closest other candidate shares participant_id", () => {
  const embeddings = { a: [1, 0], b: [0.9, 0.1], c: [0, 1] };
  const others = [{ photo_id: "b", participant_id: "p1" }, { photo_id: "c", participant_id: "p3" }];
  const result = predictEmbedding({ photo_id: "a", participant_id: "p1" }, others, embeddings, CONFIG, "siglip_nearest_neighbor");
  assert.equal(result.same_participant_support, true);
});

test("top-k mean is null (not zero) when fewer than k other candidates exist", () => {
  const embeddings = { a: [1, 0], b: [0.9, 0.1] };
  const others = [{ photo_id: "b", participant_id: "p2" }]; // k=2 in CONFIG, only 1 other exists
  const result = predictEmbedding({ photo_id: "a", participant_id: "p1" }, others, embeddings, CONFIG, "siglip_topk_mean");
  assert.equal(result.score, null);
  assert.equal(result.predicted, "review");
});

test("every baseline is null with zero other candidates (cold start), never a fabricated score", () => {
  const embeddings = { a: [1, 0] };
  for (const baseline of embeddingBaselines) {
    const result = predictEmbedding({ photo_id: "a", participant_id: "p1" }, [], embeddings, CONFIG, baseline);
    assert.equal(result.score, null);
    assert.equal(result.predicted, "review");
    assert.equal(result.neighbor_count, 0);
  }
});

test("candidate is never compared against its own embedding even if passed in others by mistake", () => {
  const embeddings = { a: [1, 0] };
  const others = [{ photo_id: "a", participant_id: "p1" }]; // caller bug: self included
  assert.throws(() => predictEmbedding({ photo_id: "a", participant_id: "p1" }, others, embeddings, CONFIG, "siglip_nearest_neighbor"));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm --prefix apps/web test`
Expected: FAIL — `evaluation/embeddings.ts` does not exist yet.

- [ ] **Step 3: Implement `embeddings.ts`**

```ts
export type EmbeddingBaseline = "siglip_centroid" | "siglip_nearest_neighbor" | "siglip_topk_mean";
export const embeddingBaselines: EmbeddingBaseline[] = ["siglip_centroid", "siglip_nearest_neighbor", "siglip_topk_mean"];

export type EmbeddingArtifact = { model: string; dim: number; embeddings: Record<string, number[]> };
export type EmbeddingConfig = { version: string; k: number; select_threshold: number; review_threshold: number };
export type CandidateRef = { photo_id: string; participant_id: string };

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function groupByEvent<T extends { event_id: string }>(rows: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const list = groups.get(row.event_id) ?? [];
    list.push(row);
    groups.set(row.event_id, list);
  }
  return groups;
}

function decision(score: number | null, c: EmbeddingConfig): "selected" | "review" | "excluded" {
  if (score === null) return "review";
  return score >= c.select_threshold ? "selected" : score >= c.review_threshold ? "review" : "excluded";
}

export function predictEmbedding(
  candidate: CandidateRef,
  others: CandidateRef[],
  embeddings: Record<string, number[]>,
  config: EmbeddingConfig,
  baseline: EmbeddingBaseline,
) {
  if (others.some(o => o.photo_id === candidate.photo_id)) {
    throw new Error("Self-exclusion violated: candidate present in its own neighborhood");
  }
  const candidateVector = embeddings[candidate.photo_id];
  const scored = others
    .map(o => ({ ...o, similarity: cosineSimilarity(candidateVector, embeddings[o.photo_id]) }))
    .sort((a, b) => b.similarity - a.similarity);

  const nearest = scored[0] ?? null;
  let score: number | null = null;
  if (baseline === "siglip_nearest_neighbor") {
    score = nearest ? nearest.similarity : null;
  } else if (baseline === "siglip_centroid") {
    if (others.length > 0) {
      const centroid = candidateVector.map((_, i) => others.reduce((sum, o) => sum + embeddings[o.photo_id][i], 0) / others.length);
      score = cosineSimilarity(candidateVector, centroid);
    }
  } else if (baseline === "siglip_topk_mean") {
    if (scored.length >= config.k) {
      const top = scored.slice(0, config.k);
      score = top.reduce((sum, o) => sum + o.similarity, 0) / top.length;
    }
  }

  return {
    baseline, score, predicted: decision(score, config),
    neighbor_count: others.length,
    nearest_neighbor_photo_id: nearest?.photo_id ?? null,
    nearest_neighbor_participant_id: nearest?.participant_id ?? null,
    same_participant_support: nearest ? nearest.participant_id === candidate.participant_id : null,
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm --prefix apps/web test`
Expected: all new tests PASS, existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/evaluation/embeddings.ts apps/web/tests/embeddings.test.mjs
git commit -m "Add SigLIP embedding similarity baselines (centroid, nearest-neighbor, top-k mean)"
```

---

## Task 4: Wire embedding baselines into the CLI and reporting

**Files:**
- Modify: `apps/web/evaluation/reporting.ts`
- Modify: `apps/web/evaluation/cli.ts`
- Create: `eval/config/embeddings-v1.json`
- Test: extend `apps/web/tests/embeddings.test.mjs`

**Interfaces:**
- Consumes: `predictEmbedding`, `groupByEvent`, `embeddingBaselines` from
  Task 3; `Example` (with `participant_id`) from Task 1.
- Produces: `evaluateEmbeddings(examples, embeddingArtifact, config, baselines)`
  returning `{ rows, comparison }` in the same shape family as the existing
  `evaluate()` (so `csv()` can be reused unmodified — it's already generic
  over `Record<string, unknown>[]`), plus a new CLI flag
  `--embeddings PATH` on `cli.ts`.

- [ ] **Step 1: Write `eval/config/embeddings-v1.json`**

```json
{
  "version": "embeddings-v1-provisional",
  "k": 3,
  "select_threshold": 0.8,
  "review_threshold": 0.5
}
```
Document in a comment-equivalent (this repo's JSON configs don't carry
comments, so note it in `eval/embeddings/README.md` instead) that these
threshold values are placeholders pending the first real sweep — matching
how `eval/config/v1.json` is already labeled `"-provisional"`.

- [ ] **Step 2: Add `evaluateEmbeddings` to `reporting.ts`**

```ts
import { groupByEvent, predictEmbedding, type CandidateRef, type EmbeddingArtifact, type EmbeddingBaseline, type EmbeddingConfig } from "./embeddings";

export type EmbeddingRow = ReturnType<typeof predictEmbedding> & Pick<Example, "photo_id" | "event_id" | "label" | "notes" | "tags" | "split">;

export function evaluateEmbeddings(
  examples: (Example & CandidateRef)[],
  artifact: EmbeddingArtifact,
  config: EmbeddingConfig,
  baselines: EmbeddingBaseline[],
) {
  const groups = groupByEvent(examples);
  const rows: EmbeddingRow[] = baselines.flatMap(baseline => examples.map(e => {
    const others = groups.get(e.event_id)!.filter(o => o.photo_id !== e.photo_id);
    return {
      photo_id: e.photo_id, event_id: e.event_id, label: e.label, notes: e.notes, tags: e.tags, split: e.split,
      ...predictEmbedding(e, others, artifact.embeddings, config, baseline),
    };
  }));
  return { rows, comparison: baselines.map(baseline => ({ baseline, ...metrics(rows.filter(r => r.baseline === baseline) as unknown as Row[]) })) };
}

export function embeddingErrorsMarkdown(rows: EmbeddingRow[]) {
  const safe = (value: unknown) => String(value ?? "missing").replaceAll("|", "\\|").replace(/[\r\n]/g, " ").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const header = "# Embedding error analysis (local; may contain private notes)\n\n| System | ID | Label | State | Error | Neighbors | Nearest participant | Same-participant support | Human note |\n|---|---|---|---|---|---|---|---|---|\n";
  return header + rows.filter(r => errorKind(r as unknown as Row)).map(r => [r.baseline, r.photo_id, r.label, r.predicted, errorKind(r as unknown as Row), r.neighbor_count, r.nearest_neighbor_participant_id, r.same_participant_support, r.notes].map(safe).join(" | ")).map(line => `| ${line} |`).join("\n") + "\n";
}
```

(The `as unknown as Row` casts through `metrics()`/`errorKind()` exist
because those functions only touch `label`/`predicted`, which both `Row`
and `EmbeddingRow` share — revisit at implementation time whether to
loosen `metrics()`'s parameter type to `Pick<Row, "label" | "predicted">[]`
instead of casting; casting is the placeholder decision here, not
necessarily the final one.)

- [ ] **Step 3: Add the `--embeddings` flag to `cli.ts`**

Add an `embeddings: { type: "string" }` option. When present: load the
artifact JSON, load an embeddings-specific config (new
`--embeddings-config` option, default `../../eval/config/embeddings-v1.json`),
require every example's `photo_id` to have a matching key in
`artifact.embeddings` (fail loudly, matching the existing "no rows silently
skipped" philosophy in `dataset.ts`), call `evaluateEmbeddings`, and write
`embeddings-comparison.csv`, `embeddings-predictions.csv`,
`embeddings-errors.md` into the same `--out` directory alongside the
existing metadata-baseline outputs (additive, not replacing them) — reusing
`csv()` for the two CSVs and the new `embeddingErrorsMarkdown()` for the
Markdown one.

- [ ] **Step 4: Extend the tests**

Add a test constructing a small synthetic `EmbeddingArtifact` and 2-3
examples across 2 events, verifying `evaluateEmbeddings` produces the
correct row count (`baselines.length * examples.length`) and that
`comparison` entries exist for every requested baseline.

- [ ] **Step 5: Run the full test suite and build**

Run: `npm --prefix apps/web test && npm --prefix apps/web run build`
Expected: pass, clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web/evaluation/reporting.ts apps/web/evaluation/cli.ts eval/config/embeddings-v1.json apps/web/tests/embeddings.test.mjs
git commit -m "Wire SigLIP embedding baselines into the eval CLI and reporting"
```

---

## Task 5: Build the real 30–50 photo manifest (human labeling, not automated)

**Files:**
- Create: `eval_data/manifest.json` (gitignored, not committed)

**Interfaces:**
- Consumes: `eval_data/photos/*` (already supplied).
- Produces: the manifest Task 2's smoke test and the real experiment run
  both depend on.

This task is **not code** — it is the user hand-labeling ~30–50 photos
across 2–3 real events per spec §11 (10–15 `belongs`, 5–8
`does_not_belong` including the named hard-negative types, `ambiguous`
only where genuine), using `eval/manifests/local-template.json` (Task 1's
updated version, with `participant_id`) as the starting shape. Not
dispatched to a subagent — the labeling judgment is explicitly the user's
per spec §3.

- [ ] **Step 1: User builds `eval_data/manifest.json`** (blocking — Tasks 6
  and 7's actual real-data runs cannot proceed without this; the code in
  Tasks 1-4 can be built and unit-tested without it)

---

## Task 6: Run the real experiment and produce the report

**Files:**
- Create: `eval_data/embeddings-v1.json` (Task 2's output, gitignored)
- Create: `eval_data/relevance-embeddings-run-001/` (CLI output, gitignored)
- Create: `docs/reports/006-relevance-embedding-experiment.md` (public,
  sanitized findings — no private notes/paths/coordinates, matching the
  existing report privacy convention in `docs/reports/004-metadata-baseline.md`)

- [ ] **Step 1: Generate embeddings** (Task 2's script against Task 5's manifest)
- [ ] **Step 2: Run the CLI with `--embeddings`** against the real manifest
  and photos, `--split development` (no legitimate test split exists yet,
  per spec §11)
- [ ] **Step 3: Inspect `embeddings-errors.md` and the cold-start breakdown**
  (spec §8 — partition results by `neighbor_count`) manually
- [ ] **Step 4: Write the public report** summarizing, per spec's own
  required framing: measured precision/recall/FPR per baseline vs.
  `all_selected`, the cold-start breakdown, the cross-participant-support
  observation (§7 — descriptive only, not a scoring change), and an
  explicit statement that this is directional signal on ~30-50 photos, not
  a generalization claim (§11) or a production threshold decision
- [ ] **Step 5: Commit the report only** (never the private manifest,
  embeddings, or run outputs — all three stay in gitignored `eval_data/`)

---

## Self-Review Notes (for whoever executes this plan)

- **Spec coverage:** §1-§3 (problem separation, visibility contract) →
  Task 1 + the whole embeddings.ts design in Task 3. §4 → Task 2. §5-§6 →
  Task 3. §7 → Task 3 (`same_participant_support`/`nearest_neighbor_participant_id`
  fields). §8 → Task 3's cold-start tests + Task 6 Step 3. §9 → satisfied by
  having three baselines rather than one (no dedicated task; it's the
  reason Task 3 has three code paths, not a separate deliverable). §10 →
  Task 4 (reuses `metrics()`). §11 → Task 5. §12-§13 → not implemented
  (correctly — they're decision criteria for *future* work, evaluated in
  Task 6's report, not built now). §14 → satisfied by omission (no API
  baseline task exists). §15 → verified by the Global Constraints section
  and by Task 6 living entirely under `eval_data/`/`docs/reports/`.
- **Known open decision, not blocking:** the `as unknown as Row` cast in
  Task 4 Step 2 is a real seam — loosening `metrics()`'s type is probably
  cleaner and should be reconsidered by whoever implements this, not treated
  as final.
- **Not yet decided, flagged for the review conversation before dispatch:**
  the default SigLIP 2 checkpoint (`google/siglip2-base-patch16-224`) is a
  reasonable default for CPU inference on ~30-50 images but is a judgment
  call, not a requirement from the spec — confirm before Task 2 runs for
  real, or change `--model`.
