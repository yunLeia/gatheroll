import { readFile, mkdir, writeFile, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { computeBlurScore, possiblyBlurry, type CleanupConfig } from "../features/cleanup/blur";
import { isLikelyScreenshot, type ScreenshotConfig } from "../features/cleanup/screenshot";
import { groupExactDuplicates } from "../features/cleanup/duplicates";
import { loadCleanupDataset, resolveCleanupPhoto } from "./cleanup-dataset";
import { binaryMetrics, binaryErrorsMarkdown } from "./cleanup-reporting";
import {
  compareSelfieBaselines,
  faceHeuristicDecision,
  type FaceArtifact,
  type SiglipArtifact,
} from "./cleanup-selfie-compare";
import { csv } from "./reporting";

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
  await mkdir(HEIC_JPEG_CACHE_DIR, { recursive: true });
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

async function pixelsFromFile(file: string) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels as 3 | 4 };
}

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
    scored.push({
      photo_id: e.photo_id,
      label: e.is_blurry!,
      blur_score,
      predicted: possiblyBlurry(blur_score, config),
      notes: e.notes,
    });
  }
  if (undecodable.length) {
    console.warn(
      `${undecodable.length}/${labeled.length} labeled photo(s) could not be decoded for blur scoring and were excluded from metrics: ` +
        undecodable.map((u) => u.photo_id).join(", "),
    );
  }
  const metrics = binaryMetrics(scored);

  const sweep = values.sweep
    ? [20, 50, 100, 150, 200, 300, 500].map((blur_threshold) => ({
        blur_threshold,
        ...binaryMetrics(
          scored.map((r) => ({
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
      [
        "results.json",
        JSON.stringify(
          { config, metrics, rows: scored, sweep, undecodable, undecodable_count: undecodable.length },
          null,
          2,
        ) + "\n",
      ],
      ["predictions.csv", csv(scored)],
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

  let siglipMetrics: ReturnType<typeof binaryMetrics> | null = null;
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
