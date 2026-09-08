import type { PhotoInput } from "./types";

// The API's PhotoInput schema is extra="forbid" (deliberate strictness, not
// ours to relax -- apps/api is Codex's surface). Client-only suggestion
// fields (blur/screenshot/duplicate, see docs/adr/007) must never reach the
// wire or the whole batch 422s. Strip them here, in one place, rather than
// trusting every call site to remember.
export function toUploadPhoto(input: PhotoInput) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- discarded on purpose
  const { has_camera_exif, blur_score, is_likely_screenshot, content_hash, ...wire } =
    input;
  return wire;
}
