import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

export type CleanupExample = {
  photo_id: string;
  source_file: string;
  notes: string;
  is_blurry: boolean | null;
  is_screenshot: boolean | null;
  is_selfie: boolean | null;
};
export type CleanupDataset = {
  schema_version: 1;
  dataset_version: string;
  examples: CleanupExample[];
};

function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
function object(value: unknown): asserts value is Record<string, unknown> {
  check(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "Expected JSON object",
  );
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  check(
    Object.keys(value).every((k) => allowed.includes(k)),
    "Unknown field (check schema spelling)",
  );
}
function id(value: unknown) {
  check(
    typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value),
    "IDs/versions must be short pseudonymous identifiers",
  );
}
function boolOrNull(value: unknown) {
  check(value === null || typeof value === "boolean", "Label must be true/false/null");
}

export function validateCleanupDataset(value: unknown): CleanupDataset {
  object(value);
  keys(value, ["schema_version", "dataset_version", "examples"]);
  check(value.schema_version === 1, "Unsupported schema version");
  id(value.dataset_version);
  check(Array.isArray(value.examples), "examples array required");
  const photos = new Set<string>();
  for (const example of value.examples) {
    object(example);
    keys(example, [
      "photo_id",
      "source_file",
      "notes",
      "is_blurry",
      "is_screenshot",
      "is_selfie",
    ]);
    id(example.photo_id);
    check(!photos.has(example.photo_id as string), "Duplicate photo ID");
    photos.add(example.photo_id as string);
    check(
      typeof example.source_file === "string" &&
        example.source_file.length > 0 &&
        !path.isAbsolute(example.source_file),
      "Relative source_file required",
    );
    check(
      typeof example.notes === "string" && example.notes.trim().length > 0,
      "Human labeling note required",
    );
    boolOrNull(example.is_blurry);
    boolOrNull(example.is_screenshot);
    boolOrNull(example.is_selfie);
  }
  return value as CleanupDataset;
}

// Mirrors dataset.ts's realpath-based traversal guard exactly. Kept
// separate rather than shared: two call sites with slightly different
// surrounding context doesn't yet justify a generalized helper.
export async function resolveCleanupPhoto(root: string, sourceFile: string): Promise<string> {
  const base = await realpath(root);
  const file = await realpath(path.resolve(base, sourceFile));
  const relative = path.relative(base, file);
  check(
    relative !== "" &&
      relative !== ".." &&
      !relative.startsWith(".." + path.sep) &&
      !path.isAbsolute(relative),
    "Source escapes photo root",
  );
  return file;
}

export async function loadCleanupDataset(manifestPath: string): Promise<CleanupDataset> {
  return validateCleanupDataset(JSON.parse(await readFile(manifestPath, "utf8")));
}
