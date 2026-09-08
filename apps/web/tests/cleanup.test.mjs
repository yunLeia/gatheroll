import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { computeBlurScore, possiblyBlurry } = require("../.eval-build/features/cleanup/blur.js");
const { validateCleanupDataset } = require("../.eval-build/evaluation/cleanup-dataset.js");
const { binaryMetrics, binaryErrorKind, binaryErrorsMarkdown } = require("../.eval-build/evaluation/cleanup-reporting.js");
const { isLikelyScreenshot } = require("../.eval-build/features/cleanup/screenshot.js");

function solid(width, height, value) {
  const data = new Uint8ClampedArray(width * height * 4).fill(value);
  return { data, width, height, channels: 4 };
}
function checkerboard(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = (x + y) % 2 === 0 ? 255 : 0;
      const o = (y * width + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = v;
      data[o + 3] = 255;
    }
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
  assert.ok(sharp > 1000);
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

test("binaryMetrics computes precision/recall/fpr for boolean labels, null denominator never 0", () => {
  const m = binaryMetrics([
    { label: true, predicted: true }, { label: true, predicted: false },
    { label: false, predicted: true }, { label: false, predicted: false },
  ]);
  assert.equal(m.tp, 1); assert.equal(m.fn, 1); assert.equal(m.fp, 1); assert.equal(m.tn, 1);
  assert.equal(m.precision, 0.5); assert.equal(m.recall, 0.5);
  assert.equal(binaryMetrics([]).precision, null);
});

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

test("cleanup dataset validation requires photo_id/source_file/notes and rejects unknown fields", () => {
  const valid = { schema_version: 1, dataset_version: "local-v1", examples: [
    { photo_id: "a", source_file: "a.jpg", notes: "sharp indoor photo", is_blurry: false, is_screenshot: null, is_selfie: null },
  ] };
  assert.doesNotThrow(() => validateCleanupDataset(valid));
  const missingNotes = structuredClone(valid);
  missingNotes.examples[0].notes = "";
  assert.throws(() => validateCleanupDataset(missingNotes));
  const extraField = structuredClone(valid);
  extraField.examples[0].unexpected = 1;
  assert.throws(() => validateCleanupDataset(extraField));
  const duplicateId = { ...valid, examples: [valid.examples[0], valid.examples[0]] };
  assert.throws(() => validateCleanupDataset(duplicateId));
});

const SCREENSHOT_CONFIG = {
  version: "cleanup-screenshot-v1-provisional",
  require_png: true,
  require_missing_camera_exif: false,
  known_dimensions: [{ width: 1170, height: 2532 }],
};

test("PNG at a known device screenshot resolution is flagged", () => {
  assert.equal(
    isLikelyScreenshot({ content_type: "image/png", width: 1170, height: 2532, has_camera_exif: false }, SCREENSHOT_CONFIG),
    true,
  );
});
test("JPEG at the same resolution is not flagged (wrong format)", () => {
  assert.equal(
    isLikelyScreenshot({ content_type: "image/jpeg", width: 1170, height: 2532, has_camera_exif: false }, SCREENSHOT_CONFIG),
    false,
  );
});
test("PNG at an unrecognized resolution is not flagged", () => {
  assert.equal(
    isLikelyScreenshot({ content_type: "image/png", width: 500, height: 500, has_camera_exif: false }, SCREENSHOT_CONFIG),
    false,
  );
});
test("missing width/height never throws, treated as not matching", () => {
  assert.equal(
    isLikelyScreenshot({ content_type: "image/png", width: null, height: null, has_camera_exif: false }, SCREENSHOT_CONFIG),
    false,
  );
});
test("portrait/landscape orientation of a known resolution both match", () => {
  assert.equal(
    isLikelyScreenshot({ content_type: "image/png", width: 2532, height: 1170, has_camera_exif: false }, SCREENSHOT_CONFIG),
    true,
  );
});
test("require_missing_camera_exif, when true, also requires absent camera EXIF", () => {
  const strict = { ...SCREENSHOT_CONFIG, require_missing_camera_exif: true };
  assert.equal(
    isLikelyScreenshot({ content_type: "image/png", width: 1170, height: 2532, has_camera_exif: true }, strict),
    false,
  );
  assert.equal(
    isLikelyScreenshot({ content_type: "image/png", width: 1170, height: 2532, has_camera_exif: false }, strict),
    true,
  );
});

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
  assert.equal(report.face_heuristic.tp, 1);
  assert.equal(report.face_heuristic.tn, 1);
  assert.equal(report.siglip_zero_shot.tp, 1);
  assert.equal(report.siglip_zero_shot.tn, 1);
});

const {
  cleanupSuggestions,
  CLEANUP_CONFIG,
} = require("../.eval-build/features/cleanup/suggestions.js");

test("cleanupSuggestions flags photos with a blur_score below the configured threshold", () => {
  const config = { version: "v", blur_threshold: 100 };
  const r = cleanupSuggestions(
    [
      { client_id: "a", blur_score: 50, content_hash: null },
      { client_id: "b", blur_score: 150, content_hash: null },
    ],
    config,
  );
  assert.deepEqual([...r.blurryIds], ["a"]);
});
test("cleanupSuggestions never flags a null blur_score (not yet computed, never fabricated)", () => {
  const r = cleanupSuggestions(
    [{ client_id: "a", blur_score: null, content_hash: null }],
    { version: "v", blur_threshold: 100 },
  );
  assert.equal(r.blurryIds.size, 0);
});
test("cleanupSuggestions groups exact-duplicate content hashes, ignores null hashes and singletons", () => {
  const r = cleanupSuggestions(
    [
      { client_id: "a", blur_score: null, content_hash: "h1" },
      { client_id: "b", blur_score: null, content_hash: "h1" },
      { client_id: "c", blur_score: null, content_hash: null },
      { client_id: "d", blur_score: null, content_hash: "h2" },
    ],
    { version: "v", blur_threshold: 100 },
  );
  assert.deepEqual(r.duplicateGroups, [["a", "b"]]);
});
test("cleanupSuggestions defaults to CLEANUP_CONFIG when no config is passed", () => {
  const r = cleanupSuggestions([
    { client_id: "a", blur_score: CLEANUP_CONFIG.blur_threshold - 1, content_hash: null },
  ]);
  assert.equal(r.blurryIds.has("a"), true);
});

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
test("groupExactDuplicates handles three-way duplicates and multiple groups", () => {
  const items = [
    { id: "a", content_hash: "h1" }, { id: "b", content_hash: "h1" }, { id: "c", content_hash: "h1" },
    { id: "d", content_hash: "h2" }, { id: "e", content_hash: "h2" },
    { id: "f", content_hash: "h3" },
  ];
  const groups = groupExactDuplicates(items);
  assert.deepEqual(groups.get("h1"), ["a", "b", "c"]);
  assert.deepEqual(groups.get("h2"), ["d", "e"]);
  assert.equal(groups.has("h3"), false);
});
