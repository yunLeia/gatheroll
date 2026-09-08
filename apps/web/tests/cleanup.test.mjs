import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { computeBlurScore, possiblyBlurry } = require("../.eval-build/features/cleanup/blur.js");
const { validateCleanupDataset } = require("../.eval-build/evaluation/cleanup-dataset.js");
const { binaryMetrics } = require("../.eval-build/evaluation/cleanup-reporting.js");
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
