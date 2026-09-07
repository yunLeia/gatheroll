import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { loadExamples, validateConfig, validateDataset } from "./dataset";
import { csv, errorsMarkdown, evaluate } from "./reporting";
import { baselines, type Baseline } from "./scoring";

async function main() {
  const { values } = parseArgs({ options: {
    manifest: { type: "string" }, root: { type: "string" }, config: { type: "string", default: "../../eval/config/v1.json" },
    out: { type: "string", default: "../../eval_data/results" }, split: { type: "string", default: "development" },
    sweep: { type: "boolean", default: false }, help: { type: "boolean", default: false },
    "historical-metadata": { type: "boolean", default: false },
  } });
  if (values.help) {
    console.log("npm run eval -- --manifest PATH [--root PHOTO_ROOT] [--config PATH] [--out NEW_DIR] [--split development|test|all] [--historical-metadata]\nDefault: all user-selected candidates baseline. Exact event times are not required. Historical metadata comparisons are opt-in; no production relevance gates. --sweep is retained only for historical reproduction with --historical-metadata and development split. Output directory must not exist.");
    return;
  }
  if (!values.manifest) throw new Error("--manifest required");
  if (!["development", "test", "all"].includes(values.split!)) throw new Error("Invalid --split");
  if (values.sweep && values.split !== "development") throw new Error("Sweep is development-only; do not tune on test/all");
  if (values.sweep && !values["historical-metadata"]) throw new Error("Time threshold tuning is not the current product evaluation. Historical reproduction requires --historical-metadata");
  const raw = await readFile(values.manifest, "utf8");
  const dataset = validateDataset(JSON.parse(raw));
  const config = validateConfig(JSON.parse(await readFile(values.config!, "utf8")));
  if (dataset.kind === "local_private" && !values.root) throw new Error("Private dataset requires explicit --root");
  const examples = await loadExamples(dataset, values.root ?? ".", values.split!);
  const systems: Baseline[] = values["historical-metadata"] ? baselines : ["all_selected"];
  const result = evaluate(examples, dataset.events, config, systems);
  const sweep = values.sweep ? [0.7, 0.9, 1].flatMap(select_threshold => [0.2, 0.4, 0.6].map(review_threshold => {
    const c = { ...config, select_threshold, review_threshold };
    return evaluate(examples, dataset.events, c, systems).comparison.filter(r => r.baseline !== "all_selected")
      .map(r => ({ select_threshold, review_threshold, ...r }));
  })).flat() : [];
  const artifact = { schema_version: 1, dataset_version: dataset.dataset_version, kind: dataset.kind,
    product_model: "participant_selected_candidates_v2", historical_metadata: values["historical-metadata"],
    manifest_sha256: createHash("sha256").update(raw).digest("hex"), split: values.split, config,
    extraction: "shared exifr DateTimeOriginal + OffsetTimeOriginal; no mtime fallback",
    denominators: "Strict metrics exclude ambiguous; selected is positive, review/excluded negative. Rates use all examples including ambiguous. Null means zero denominator.",
    ...result, sweep };
  // No overwriting old runs; results contain sensitive derived metadata and human notes.
  const out = path.resolve(values.out!);
  await mkdir(path.dirname(out), { recursive: true });
  await mkdir(out, { mode: 0o700 });
  await Promise.all([
    ["results.json", JSON.stringify(artifact, null, 2) + "\n"],
    ["comparison.csv", csv(result.comparison)], ["predictions.csv", csv(result.rows)],
    ["errors.md", errorsMarkdown(result.rows)], ["sweep.csv", csv(sweep)],
  ].map(([name, content]) => writeFile(path.join(out, name), content, { mode: 0o600, flag: "wx" })));
  console.log(`${dataset.kind}: ${examples.length} examples; ${dataset.events.length} manifest events; split=${values.split}; ${values["historical-metadata"] ? "HISTORICAL rejected primary time/location hypothesis" : "all user-selected candidates baseline"}`);
  console.table(result.comparison.map(({ baseline, precision, recall, fpr, fp, fn, review_rate, automatic_selection_rate }) =>
    ({ baseline, precision, recall, fpr, fp, fn, review_rate, automatic_selection_rate })));
  console.log("Wrote results.json, comparison.csv, predictions.csv, errors.md, sweep.csv. Treat output as private.");
}
main().catch(error => {
  // Filesystem errors can contain private paths; don't dump them or raw JSON contents.
  console.error(error instanceof Error && !("code" in error) && !(error instanceof SyntaxError) ? error.message : "Evaluation failed: check input JSON, paths, permissions and that output directory is new.");
  process.exitCode = 1;
});
