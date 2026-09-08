import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { computeBlurScore, possiblyBlurry, type CleanupConfig } from "../features/cleanup/blur";
import { isLikelyScreenshot, type ScreenshotConfig } from "../features/cleanup/screenshot";
import { groupExactDuplicates } from "../features/cleanup/duplicates";
import { loadCleanupDataset, resolveCleanupPhoto } from "./cleanup-dataset";
import { binaryMetrics } from "./cleanup-reporting";
import {
  compareSelfieBaselines,
  faceHeuristicDecision,
  type FaceArtifact,
  type SiglipArtifact,
} from "./cleanup-selfie-compare";
import { csv } from "./reporting";

async function pixelsFromFile(file: string) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels as 3 | 4 };
}

async function runBlur(values: ReturnType<typeof parseArgs>["values"]) {
  const dataset = await loadCleanupDataset(values.manifest as string);
  const config: CleanupConfig = JSON.parse(await readFile(values.config as string, "utf8"));
  const labeled = dataset.examples.filter((e) => e.is_blurry !== null);
  if (!labeled.length) throw new Error("No examples have is_blurry labeled");

  const rows = await Promise.all(
    labeled.map(async (e) => {
      const file = await resolveCleanupPhoto(values.root as string, e.source_file);
      const pixels = await pixelsFromFile(file);
      const blur_score = computeBlurScore(pixels);
      return {
        photo_id: e.photo_id,
        label: e.is_blurry!,
        blur_score,
        predicted: possiblyBlurry(blur_score, config),
        notes: e.notes,
      };
    }),
  );
  const metrics = binaryMetrics(rows);

  const sweep = values.sweep
    ? [20, 50, 100, 150, 200, 300, 500].map((blur_threshold) => ({
        blur_threshold,
        ...binaryMetrics(
          rows.map((r) => ({
            label: r.label,
            predicted: possiblyBlurry(r.blur_score, { ...config, blur_threshold }),
          })),
        ),
      }))
    : [];

  const out = path.resolve(values.out as string);
  await mkdir(path.dirname(out), { recursive: true });
  await mkdir(out, { mode: 0o700 });
  await Promise.all(
    [
      ["results.json", JSON.stringify({ config, metrics, rows, sweep }, null, 2) + "\n"],
      ["predictions.csv", csv(rows)],
      ["sweep.csv", csv(sweep)],
    ].map(([name, content]) =>
      writeFile(path.join(out, name), content, { mode: 0o600, flag: "wx" }),
    ),
  );
  console.table({ blur: metrics });
  console.log(`Wrote results.json, predictions.csv, sweep.csv to ${out}. Treat output as private.`);
}

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
        {
          content_type,
          width: meta.width ?? null,
          height: meta.height ?? null,
          has_camera_exif: meta.exif !== undefined,
        },
        config,
      );
      return { photo_id: e.photo_id, label: e.is_screenshot!, predicted, content_type, notes: e.notes };
    }),
  );
  const metrics = binaryMetrics(rows);

  const out = path.resolve(values.out as string);
  await mkdir(path.dirname(out), { recursive: true });
  await mkdir(out, { mode: 0o700 });
  await Promise.all(
    [
      ["results.json", JSON.stringify({ config, metrics, rows }, null, 2) + "\n"],
      ["predictions.csv", csv(rows)],
    ].map(([name, content]) =>
      writeFile(path.join(out, name), content, { mode: 0o600, flag: "wx" }),
    ),
  );
  console.table({ screenshot: metrics });
  console.log(`Wrote results.json, predictions.csv to ${out}. Treat output as private.`);
}

const DETECTOR_DEFAULTS: Record<string, { config?: string; out: string }> = {
  blur: { config: "../../eval/config/cleanup-blur-v1.json", out: "../../eval_data/cleanup-blur-results" },
  screenshot: {
    config: "../../eval/config/cleanup-screenshot-v1.json",
    out: "../../eval_data/cleanup-screenshot-results",
  },
  // No config file: there is no fixed production threshold to version yet --
  // this mode only produces a comparison report over a threshold sweep.
  selfie: { out: "../../eval_data/cleanup-selfie-compare" },
};

const FACE_AREA_THRESHOLD_SWEEP = [0.05, 0.1, 0.15, 0.2, 0.3];

async function runSelfie(values: ReturnType<typeof parseArgs>["values"]) {
  if (!values["face-artifact"] || !values["siglip-artifact"]) {
    throw new Error("--face-artifact and --siglip-artifact required for --detector selfie");
  }
  const dataset = await loadCleanupDataset(values.manifest as string);
  const faceArtifact: FaceArtifact = JSON.parse(await readFile(values["face-artifact"] as string, "utf8"));
  const siglipArtifact: SiglipArtifact = JSON.parse(
    await readFile(values["siglip-artifact"] as string, "utf8"),
  );
  const labeled = dataset.examples.filter((e) => e.is_selfie !== null);
  if (!labeled.length) throw new Error("No examples have is_selfie labeled");

  const comparison = FACE_AREA_THRESHOLD_SWEEP.map((face_area_threshold) => ({
    face_area_threshold,
    ...compareSelfieBaselines(dataset, faceArtifact, siglipArtifact, face_area_threshold).face_heuristic,
  }));
  // SigLIP has no threshold to sweep -- report it once, alongside the sweep.
  const siglipMetrics = compareSelfieBaselines(dataset, faceArtifact, siglipArtifact, 0).siglip_zero_shot;

  const predictions = labeled.map((e) => ({
    photo_id: e.photo_id,
    label: e.is_selfie,
    face_geometry: faceArtifact.results[e.photo_id],
    face_predicted_at_0_2: faceHeuristicDecision(faceArtifact.results[e.photo_id], 0.2),
    siglip_predicted_label: siglipArtifact.results[e.photo_id]?.predicted_label ?? null,
    notes: e.notes,
  }));

  const out = path.resolve((values.out as string) ?? "../../eval_data/cleanup-selfie-compare");
  await mkdir(path.dirname(out), { recursive: true });
  await mkdir(out, { mode: 0o700 });
  await Promise.all(
    [
      [
        "results.json",
        JSON.stringify({ face_heuristic_sweep: comparison, siglip_zero_shot: siglipMetrics, predictions }, null, 2) + "\n",
      ],
      ["comparison.csv", csv([...comparison.map((c) => ({ technique: "face_heuristic", ...c })), { technique: "siglip_zero_shot", ...siglipMetrics }])],
      ["predictions.csv", csv(predictions)],
    ].map(([name, content]) => writeFile(path.join(out, name), content, { mode: 0o600, flag: "wx" })),
  );
  console.table(comparison);
  console.table({ siglip_zero_shot: siglipMetrics });
  console.log(`Wrote results.json, comparison.csv, predictions.csv to ${out}. Treat output as private.`);
}

// Deliberately not a reuse of contentHash() (features/cleanup/duplicates.ts,
// crypto.subtle-based, browser-only) -- same algorithm, different API,
// matching how blur's browser path uses Canvas while its CLI path uses
// sharp for the same underlying computation.
async function runDuplicates(values: ReturnType<typeof parseArgs>["values"]) {
  const dataset = await loadCleanupDataset(values.manifest as string);
  const items = await Promise.all(
    dataset.examples.map(async (e) => {
      const file = await resolveCleanupPhoto(values.root as string, e.source_file);
      const bytes = await readFile(file);
      return { id: e.photo_id, content_hash: createHash("sha256").update(bytes).digest("hex") };
    }),
  );
  const groups = groupExactDuplicates(items);
  console.log(`${items.length} photos scanned; ${groups.size} exact-duplicate group(s) found.`);
  for (const [hash, ids] of groups) console.log(`  ${hash.slice(0, 12)}...: ${ids.join(", ")}`);
  if (groups.size === 0) console.log("No exact duplicates in this set.");
  console.log("Descriptive count only -- no metrics file written (hash equality has no precision/recall).");
}

async function main() {
  const { values } = parseArgs({
    options: {
      manifest: { type: "string" },
      root: { type: "string" },
      config: { type: "string" },
      out: { type: "string" },
      detector: { type: "string", default: "blur" },
      sweep: { type: "boolean", default: false },
      "face-artifact": { type: "string" },
      "siglip-artifact": { type: "string" },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    console.log(
      "npm run eval:cleanup -- --manifest PATH --root PHOTO_ROOT [--detector blur|screenshot|selfie|duplicates] [--config PATH] [--out NEW_DIR] [--sweep]\n" +
        "  [--face-artifact PATH --siglip-artifact PATH]  (selfie only; from eval/cleanup/face_heuristic.py and selfie_zero_shot.py)\n" +
        "Evaluates a cleanup detector against human labels in a cleanup-dataset manifest (duplicates needs no labels; it's a descriptive hash-group count). Output directory must not exist.",
    );
    return;
  }
  if (!values.manifest || !values.root) throw new Error("--manifest and --root required");
  const detector = (values.detector as string) ?? "blur";
  if (detector === "duplicates") return runDuplicates(values);
  const defaults = DETECTOR_DEFAULTS[detector];
  if (!defaults) throw new Error(`Unknown --detector: ${detector}`);
  values.config ??= defaults.config;
  values.out ??= defaults.out;

  if (detector === "blur") return runBlur(values);
  if (detector === "screenshot") {
    if (values.sweep) console.warn("--sweep has no effect for --detector screenshot (no continuous threshold to sweep); ignoring.");
    return runScreenshot(values);
  }
  if (detector === "selfie") return runSelfie(values);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Cleanup evaluation failed.");
  process.exitCode = 1;
});
