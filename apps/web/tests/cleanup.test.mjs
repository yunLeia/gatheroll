import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { computeBlurScore, possiblyBlurry } = require("../.eval-build/features/cleanup/blur.js");

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
