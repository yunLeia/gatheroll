import assert from "node:assert/strict";
import test from "node:test";
import { readFile, mkdtemp, mkdir, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { predict, timeScore, locationScore, decision, haversine } = require("../.eval-build/evaluation/scoring.js");
const { validateDataset, validateConfig, loadExamples, instant } = require("../.eval-build/evaluation/dataset.js");
const { evaluate, metrics, csv } = require("../.eval-build/evaluation/reporting.js");
const { normalizeMetadata, extractMetadata } = require("../.eval-build/features/photos/metadata.js");
const fixture = JSON.parse(await readFile(new URL("../../../eval/fixtures/synthetic-v1.json", import.meta.url), "utf8"));
const config = validateConfig(JSON.parse(await readFile(new URL("../../../eval/config/v1.json", import.meta.url), "utf8")));
const event = fixture.events[0];
const meta = (captured_at, latitude = null, longitude = null) => ({ captured_at, latitude, longitude });

test("time inside/inclusive boundaries, just before, far before, after and missing", () => {
  for (const t of ["12:00:00", "12:30:00", "13:00:00"])
    assert.equal(predict(meta(`2026-08-01T${t}Z`), event, config, "time_only").score, 1);
  const c = { ...config, before_grace_minutes: 20, after_grace_minutes: 40 };
  assert.equal(timeScore(-5, c), 0.75);
  assert.equal(timeScore(-200, c), 0);
  assert.equal(timeScore(10, c), 0.75);
  assert.equal(timeScore(null, c), null);
  assert.equal(timeScore(-1, { ...c, before_grace_minutes: 0 }), 0);
});
test("Haversine known equator degree, antipodes and dateline", () => {
  assert.equal(haversine(0, 0, 0, 0), 0);
  assert.ok(Math.abs(haversine(0, 0, 0, 1) - 111195) < 1);
  assert.ok(Math.abs(haversine(0, 0, 0, 180) - 20015087) < 1);
  assert.ok(haversine(0, 179.9, 0, -179.9) < 23000);
});
test("location same, nearby, far and absent; weighted available-signal normalization", () => {
  const c = { ...config, location_full_meters: 0, location_zero_meters: 1000, time_weight: 3, location_weight: 1 };
  assert.equal(locationScore(0, c), 1);
  assert.equal(locationScore(250, c), 0.75);
  assert.equal(locationScore(2000, c), 0);
  assert.equal(locationScore(null, c), null);
  assert.equal(predict(meta("2026-08-01T12:30:00Z", 1, 1), event, c, "time_gps").score, 0.75);
  assert.equal(predict(meta("2026-08-01T12:30:00Z"), event, c, "time_gps").score, 1);
  assert.equal(predict(meta(null, 0, 0), event, c, "time_gps").score, 1);
  assert.equal(predict(meta(null), event, c, "time_gps").predicted, "review");
  assert.equal(predict(meta(null, 0, 0), event, c, "time_only").score, null);
  assert.equal(predict(meta("2026-08-01T12:30:00Z", 0, 0), { ...event, latitude: null, longitude: null }, c, "time_gps").score, 1);
});
test("exact thresholds and null decisions", () => {
  const c = { ...config, select_threshold: 0.8, review_threshold: 0.3 };
  assert.equal(decision(0.8, c), "selected");
  assert.equal(decision(0.799, c), "review");
  assert.equal(decision(0.3, c), "review");
  assert.equal(decision(0.299, c), "excluded");
  assert.equal(decision(null, c), "review");
});
test("strict metrics exclude ambiguous; review positives remain FN; null denominator", () => {
  const m = metrics([
    { label: "belongs", predicted: "selected" }, { label: "belongs", predicted: "review" },
    { label: "does_not_belong", predicted: "selected" }, { label: "does_not_belong", predicted: "excluded" },
    { label: "ambiguous", predicted: "selected" },
  ]);
  assert.equal(m.precision, 0.5); assert.equal(m.recall, 0.5); assert.equal(m.fpr, 0.5);
  assert.equal(m.review_rate, 0.2); assert.equal(m.automatic_selection_rate, 0.6);
  assert.equal(m.fn, 1); assert.equal(m.ambiguous.selected, 1);
  assert.equal(metrics([]).precision, null);
  assert.equal(metrics([]).review_rate, null);
  assert.equal(metrics([{ label: "belongs", predicted: "review" }]).precision, null);
});
test("synthetic regression is explicit, complete and reproducible", () => {
  const d = validateDataset(fixture);
  const result = evaluate(d.examples, d.events, config, ["all_selected", "time_only", "time_gps"]);
  assert.equal(result.rows.length, 60);
  assert.deepEqual(result.comparison.map(r => [r.tp, r.fp, r.fn]), [[10, 8, 0], [5, 4, 5], [6, 4, 4]]);
});
test("validation rejects duplicate IDs, bad dates, coordinates, config and event split leakage", () => {
  const mutate = (fn) => { const d = structuredClone(fixture); fn(d); return () => validateDataset(d); };
  assert.throws(mutate(d => d.examples.push(d.examples[0])));
  assert.throws(mutate(d => d.examples[0].split = "test"));
  assert.throws(mutate(d => d.examples[0].metadata.latitude = 91));
  assert.throws(mutate(d => d.examples[0].metadata.longitude = null));
  assert.throws(mutate(d => d.examples[0].label = "review"));
  assert.throws(mutate(d => d.examples[0].metadata.captured_at = "2026-02-30T12:00:00Z"));
  assert.throws(() => instant("2026-08-01T12:00:00"));
  assert.throws(() => validateConfig({ ...config, review_threshold: 1 }));
  assert.throws(() => validateConfig({ ...config, time_weight: 0 }));
});
test("shared extraction normalizes raw EXIF and tolerates undecodable bytes", async () => {
  const actual = normalizeMetadata({ DateTimeOriginal: "2026:08:01 12:30:00", OffsetTimeOriginal: "+09:00", latitude: 0, longitude: -73, ExifImageWidth: 100 });
  assert.equal(actual.captured_at, "2026-08-01T03:30:00.000Z");
  assert.equal(actual.latitude, 0);
  assert.equal(normalizeMetadata({ DateTimeOriginal: "2026:08:01 12:30:00" }).captured_at, null);
  assert.equal(normalizeMetadata({ latitude: NaN, longitude: 181 }).longitude, null);
  assert.deepEqual(await extractMetadata(new Uint8Array([0, 1, 2])), normalizeMetadata());
});
test("private file loader contains symlinks and traversal; missing files fail not skip", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gatheroll-eval-test-"));
  await mkdir(path.join(dir, "photos"));
  await writeFile(path.join(dir, "outside.jpg"), "synthetic invalid image");
  await symlink(path.join(dir, "outside.jpg"), path.join(dir, "photos", "escape.jpg"));
  const d = { ...fixture, kind: "local_private", examples: [{ ...fixture.examples[0], source_file: "escape.jpg" }] };
  delete d.examples[0].metadata;
  validateDataset(d);
  await assert.rejects(loadExamples(d, path.join(dir, "photos"), "development"));
  d.examples[0].source_file = "../outside.jpg";
  await assert.rejects(loadExamples(d, path.join(dir, "photos"), "development"));
  d.examples[0].source_file = "missing.jpg";
  await assert.rejects(loadExamples(d, path.join(dir, "photos"), "development"));
});
test("real exifr byte path reads a synthetic JPEG EXIF timestamp and signed GPS", async () => {
  // Hand-built public fixture: TIFF offsets are relative to its header, no photo pixels/private EXIF.
  const tiff = Buffer.alloc(240);
  tiff.write("II"); tiff.writeUInt16LE(42, 2); tiff.writeUInt32LE(8, 4);
  const entry = (at, tag, type, count, value) => {
    tiff.writeUInt16LE(tag, at); tiff.writeUInt16LE(type, at + 2);
    tiff.writeUInt32LE(count, at + 4); tiff.writeUInt32LE(value, at + 8);
  };
  tiff.writeUInt16LE(2, 8);
  entry(10, 0x8769, 4, 1, 38); entry(22, 0x8825, 4, 1, 68);
  tiff.writeUInt16LE(2, 38);
  entry(40, 0x9003, 2, 20, 122); entry(52, 0x9011, 2, 7, 142);
  tiff.writeUInt16LE(4, 68);
  entry(70, 1, 2, 2, 78); entry(82, 2, 5, 3, 150); // N inline ASCII
  entry(94, 3, 2, 2, 87); entry(106, 4, 5, 3, 174); // W inline ASCII
  tiff.write("2026:08:01 12:30:00\0", 122); tiff.write("+09:00\0", 142);
  for (const [offset, deg] of [[150, 40], [174, 73]]) {
    for (let i = 0; i < 3; i++) { tiff.writeUInt32LE(i === 0 ? deg : 0, offset + i * 8); tiff.writeUInt32LE(1, offset + i * 8 + 4); }
  }
  const exif = Buffer.concat([Buffer.from("Exif\0\0"), tiff]);
  const marker = Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0, 0]);
  marker.writeUInt16BE(exif.length + 2, 4);
  const actual = await extractMetadata(Buffer.concat([marker, exif, Buffer.from([0xff, 0xd9])]));
  assert.equal(actual.captured_at, "2026-08-01T03:30:00.000Z");
  assert.equal(actual.latitude, 40); assert.equal(actual.longitude, -73);
});
test("CSV handles commas, newlines and formula-like notes", () => {
  assert.equal(csv([{ note: '=SUM(1,2)\n"hi"', delta: -2 }]), '"note","delta"\n"\'=SUM(1,2)\n""hi""","-2"\n');
});
test("CLI private local path produces artifacts, rejects overwrite and test sweep, handles empty split", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gatheroll-eval-cli-"));
  await writeFile(path.join(dir, "synthetic-invalid.jpg"), "intentionally synthetic invalid bytes");
  const example = { ...fixture.examples[0], source_file: "synthetic-invalid.jpg" };
  delete example.metadata;
  const d = { ...fixture, kind: "local_private", examples: [example] };
  const manifest = path.join(dir, "manifest.json");
  await writeFile(manifest, JSON.stringify(d));
  const cli = fileURLToPath(new URL("../.eval-build/evaluation/cli.js", import.meta.url));
  const configPath = fileURLToPath(new URL("../../../eval/config/v1.json", import.meta.url));
  const args = [cli, "--manifest", manifest, "--config", configPath, "--root", dir];
  const output = path.join(dir, "results");
  const run = (...extra) => spawnSync(process.execPath, [...args, ...extra], { encoding: "utf8" });
  assert.equal(run("--out", output).status, 0);
  const artifact = JSON.parse(await readFile(path.join(output, "results.json"), "utf8"));
  assert.equal(artifact.comparison.length, 1);
  assert.equal(artifact.comparison[0].baseline, "all_selected");
  assert.equal(artifact.historical_metadata, false);
  assert.equal(JSON.stringify(artifact).includes("synthetic-invalid.jpg"), false);
  for (const file of ["comparison.csv", "predictions.csv", "errors.md", "sweep.csv"])
    await readFile(path.join(output, file));
  assert.equal(run("--out", output).status, 1);
  assert.equal(run("--split", "test", "--sweep", "--out", path.join(dir, "denied")).status, 1);
  const empty = path.join(dir, "empty");
  assert.equal(run("--split", "test", "--out", empty).status, 0);
  assert.equal(JSON.parse(await readFile(path.join(empty, "results.json"), "utf8")).comparison[0].total, 0);
});
test("current candidate evaluation requires no host boundaries or GPS; historical scoring stays opt-in", () => {
  const d = structuredClone(fixture);
  d.events = [{ event_id: "event_a" }];
  validateDataset(d);
  const current = evaluate(d.examples, d.events, config);
  assert.equal(current.comparison.length, 1);
  assert.equal(current.comparison[0].automatic_selection_rate, 1);
  const historical = predict(meta("2026-08-01T12:30:00Z"), d.events[0], config, "time_only");
  assert.equal(historical.score, null);
  assert.equal(historical.predicted, "review");
});
