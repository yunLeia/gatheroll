import { possiblyBlurry, type CleanupConfig } from "./blur";
import { alreadyUploadedIds, groupExactDuplicates } from "./duplicates";

// Provisional threshold, matching eval/config/cleanup-blur-v1.json and the
// value measured in docs/reports/007-cleanup-v1-real-evaluation.md (100%
// recall / 61.5% precision on the real 49-photo set). A sweep suggested
// lower thresholds (20-50) fit that set even better, but with only 8 real
// blurry positives labeled it's too thin a sample to lock a tighter value
// yet -- this stays deliberately conservative (fewer false suggestions)
// until more real-photo labels exist.
export const CLEANUP_CONFIG: CleanupConfig = {
  version: "cleanup-blur-v1-provisional",
  blur_threshold: 100,
};

export type CleanupSuggestions = {
  blurryIds: Set<string>;
  duplicateGroups: string[][];
  alreadyUploadedIds: Set<string>;
};

type SuggestionInput = {
  client_id: string;
  blur_score: number | null;
  content_hash: string | null;
  original_filename: string;
  file_size_bytes: number;
};
type StoredInput = { original_filename: string; file_size_bytes: number };

// Pre-upload, suggest-only signal computed from data already produced by
// preparePhoto() -- never a new score, never auto-excludes anything. The
// caller decides what to do with a flagged photo (docs/adr/007).
export function cleanupSuggestions(
  inputs: SuggestionInput[],
  stored: StoredInput[] = [],
  config: CleanupConfig = CLEANUP_CONFIG,
): CleanupSuggestions {
  const blurryIds = new Set(
    inputs
      .filter((input) => input.blur_score !== null && possiblyBlurry(input.blur_score, config))
      .map((input) => input.client_id),
  );
  const hashed = inputs
    .filter((input): input is SuggestionInput & { content_hash: string } => input.content_hash !== null)
    .map((input) => ({ id: input.client_id, content_hash: input.content_hash }));
  const duplicateGroups = [...groupExactDuplicates(hashed).values()];
  return {
    blurryIds,
    duplicateGroups,
    alreadyUploadedIds: alreadyUploadedIds(inputs, stored),
  };
}
