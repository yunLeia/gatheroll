import { binaryMetrics } from "./cleanup-reporting";
import type { CleanupDataset } from "./cleanup-dataset";

export type FaceGeometry = { face_count: number; largest_face_area_ratio: number; centered: boolean };
export type FaceArtifact = { results: Record<string, FaceGeometry> };
export type SiglipResult = {
  selfie: number;
  portrait_by_other: number;
  group_photo: number;
  predicted_label: string;
};
export type SiglipArtifact = { results: Record<string, SiglipResult> };

// The geometry itself carries no threshold (face_heuristic.py deliberately
// leaves the decision unmade); this is where that threshold finally applies,
// so it can be swept against real labels without re-running face detection.
export function faceHeuristicDecision(geometry: FaceGeometry, areaThreshold: number): boolean {
  return geometry.face_count >= 1 && geometry.centered && geometry.largest_face_area_ratio >= areaThreshold;
}

export function compareSelfieBaselines(
  dataset: Pick<CleanupDataset, "examples">,
  faceArtifact: FaceArtifact,
  siglipArtifact: SiglipArtifact,
  faceAreaThreshold: number,
) {
  const labeled = dataset.examples.filter((e) => e.is_selfie !== null);
  const faceRows = labeled.map((e) => ({
    label: e.is_selfie!,
    predicted: faceHeuristicDecision(faceArtifact.results[e.photo_id], faceAreaThreshold),
  }));
  const siglipRows = labeled.map((e) => ({
    label: e.is_selfie!,
    predicted: siglipArtifact.results[e.photo_id].predicted_label === "selfie",
  }));
  return {
    face_heuristic: binaryMetrics(faceRows),
    siglip_zero_shot: binaryMetrics(siglipRows),
  };
}
