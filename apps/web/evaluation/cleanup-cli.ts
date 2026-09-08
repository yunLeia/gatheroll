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

async function main() {
  const { values } = parseArgs({
    options: {
      manifest: { type: "string" },
      root: { type: "string" },
      config: { type: "string", default: "../../eval/config/cleanup-blur-v1.json" },
      out: { type: "string", default: "../../eval_data/cleanup-blur-results" },
      detector: { type: "string", default: "blur" },
      sweep: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    console.log(
      "npm run eval:cleanup -- --manifest PATH --root PHOTO_ROOT [--detector blur] [--config PATH] [--out NEW_DIR] [--sweep]\n" +
        "Evaluates a cleanup detector against human labels in a cleanup-dataset manifest. Output directory must not exist.",
    );
    return;
  }
  if (!values.manifest || !values.root) throw new Error("--manifest and --root required");
  if (values.detector === "blur") {
    await runBlur(values);
    return;
  }
  throw new Error(`Unknown --detector: ${values.detector}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Cleanup evaluation failed.");
  process.exitCode = 1;
});
