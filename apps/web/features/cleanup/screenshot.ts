export type ScreenshotConfig = {
  version: string;
  require_png: boolean;
  require_missing_camera_exif: boolean;
  known_dimensions: { width: number; height: number }[];
};

export type ScreenshotInput = {
  content_type: string;
  width: number | null;
  height: number | null;
  has_camera_exif: boolean;
};

// Mirrors eval/config/cleanup-screenshot-v1.json. Kept as a plain constant
// here rather than importing that file across the apps/eval boundary --
// "the apps own their dependencies" (README); the eval/ copy is what the
// offline CLI versions and sweeps, this one is what ships in the browser.
export const DEFAULT_SCREENSHOT_CONFIG: ScreenshotConfig = {
  version: "cleanup-screenshot-v1-provisional",
  require_png: true,
  require_missing_camera_exif: false,
  known_dimensions: [
    { width: 1170, height: 2532 },
    { width: 1179, height: 2556 },
    { width: 1284, height: 2778 },
    { width: 1290, height: 2796 },
    { width: 1080, height: 2340 },
    { width: 828, height: 1792 },
    { width: 750, height: 1334 },
    { width: 1242, height: 2688 },
  ],
};

// Deterministic format/EXIF heuristic -- no model. See docs/product/pre-upload-cleanup-v1-proposal.md.
export function isLikelyScreenshot(input: ScreenshotInput, config: ScreenshotConfig): boolean {
  if (config.require_png && input.content_type !== "image/png") return false;
  if (input.width === null || input.height === null) return false;
  const knownSize = config.known_dimensions.some(
    (d) =>
      (d.width === input.width && d.height === input.height) ||
      (d.width === input.height && d.height === input.width), // portrait/landscape
  );
  if (!knownSize) return false;
  if (config.require_missing_camera_exif && input.has_camera_exif) return false;
  return true;
}
