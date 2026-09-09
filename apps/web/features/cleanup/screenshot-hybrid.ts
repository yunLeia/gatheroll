// Combines a visual classifier (SigLIP2 zero-shot, server-side, post-upload
// -- see docs/product/cleanup-v2-classifiers-proposal.md) with the existing
// metadata heuristic (format/EXIF, client-side, see screenshot.ts) into one
// explainable decision. Deliberately not a trained ensemble: an
// interpretable rule where agreement between signals raises confidence and
// disagreement stays reviewable, rather than silently picking a side.
//
// Metadata is *supporting evidence*, not a hard gate -- unlike the legacy
// isLikelyScreenshot()'s exact-dimension-match requirement, which measured
// 0% recall on a real labeled set because the real device resolution
// wasn't in the hardcoded list (report 007). This hybrid never requires a
// dimension match; format (PNG) is the primary metadata signal, camera
// EXIF presence is corroborating.

export type ScreenshotVisualLabel = "screenshot" | "camera_photo";

export type ScreenshotMetadataEvidence = {
  content_type: string;
  has_camera_exif: boolean;
};

export type ScreenshotDecision = "screenshot" | "camera_photo" | "uncertain";

export type ScreenshotHybridResult = {
  decision: ScreenshotDecision;
  evidence: string[];
};

function metadataSupportsScreenshot(input: ScreenshotMetadataEvidence): boolean {
  return input.content_type === "image/png";
}

// Agreement -> confident. Disagreement -> uncertain, never a silent guess in
// either direction. See docs/product/cleanup-v2-classifiers-proposal.md for
// why this rule shape was chosen and its real-data evaluation.
export function hybridScreenshotDecision(
  visual: ScreenshotVisualLabel,
  metadata: ScreenshotMetadataEvidence,
): ScreenshotHybridResult {
  const metadataSupports = metadataSupportsScreenshot(metadata);
  const evidence = [
    `visual classifier: ${visual}`,
    `format: ${metadata.content_type}${metadataSupports ? " (supports screenshot)" : " (does not support screenshot)"}`,
    `camera EXIF present: ${metadata.has_camera_exif}`,
  ];
  if (visual === "screenshot" && metadataSupports) {
    return { decision: "screenshot", evidence };
  }
  if (visual === "camera_photo" && !metadataSupports) {
    return { decision: "camera_photo", evidence };
  }
  return { decision: "uncertain", evidence };
}
