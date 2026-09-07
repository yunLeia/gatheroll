import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { extractMetadata } from "../features/photos/metadata";
import type { Config, Event, Metadata } from "./scoring";

export type Label = "belongs" | "does_not_belong" | "ambiguous";
export type Example = {
  photo_id: string; event_id: string; label: Label; notes: string;
  tags: string[]; split: "development" | "test";
  source_file?: string; metadata?: Metadata;
};
export type Dataset = {
  schema_version: 1; dataset_version: string; kind: "synthetic" | "local_private";
  events: Event[]; examples: Example[];
};
function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
function object(value: unknown): asserts value is Record<string, unknown> {
  check(value !== null && typeof value === "object" && !Array.isArray(value), "Expected JSON object");
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  check(Object.keys(value).every(k => allowed.includes(k)), "Unknown field (check schema spelling)");
}
function id(value: unknown) {
  check(typeof value === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(value), "IDs/versions must be short pseudonymous identifiers");
}
export function instant(value: unknown) {
  check(typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(value), "Timestamp requires explicit offset and seconds");
  const wall = value.slice(0, 19);
  check(Number.isFinite(Date.parse(value)) && new Date(Date.parse(wall + "Z")).toISOString().slice(0, 19) === wall, "Invalid calendar timestamp");
}
function coordinates(value: Record<string, unknown>) {
  for (const [key, max] of [["latitude", 90], ["longitude", 180]] as const) {
    check(value[key] === null || typeof value[key] === "number" && Number.isFinite(value[key]) && Math.abs(value[key]) <= max, "Invalid or missing coordinate field; use null for missing");
  }
  check((value.latitude === null) === (value.longitude === null), "Coordinates must be a complete pair or both null");
}
export function validateConfig(value: unknown): Config {
  object(value);
  keys(value, ["version", "before_grace_minutes", "after_grace_minutes", "location_full_meters", "location_zero_meters", "time_weight", "location_weight", "select_threshold", "review_threshold"]);
  id(value.version);
  for (const key of ["before_grace_minutes", "after_grace_minutes", "location_full_meters", "location_zero_meters", "time_weight", "location_weight", "select_threshold", "review_threshold"]) {
    check(typeof value[key] === "number" && Number.isFinite(value[key]) && value[key] >= 0, "Invalid numeric configuration");
  }
  const c = value as Config;
  check(c.time_weight > 0 && c.location_weight > 0, "Signal weights must be positive");
  check(c.location_zero_meters > c.location_full_meters, "Location decay must have positive width");
  check(c.review_threshold < c.select_threshold && c.select_threshold <= 1, "Require 0 <= review < select <= 1");
  return c;
}
export function validateDataset(value: unknown): Dataset {
  object(value);
  keys(value, ["schema_version", "dataset_version", "kind", "events", "examples"]);
  check(value.schema_version === 1, "Unsupported schema version");
  id(value.dataset_version);
  check(value.kind === "synthetic" || value.kind === "local_private", "Unknown dataset kind");
  check(Array.isArray(value.events) && Array.isArray(value.examples), "events/examples arrays required");
  const events = new Set<string>(), photos = new Set<string>(), splits = new Map<string, string>();
  for (const event of value.events) {
    object(event);
    keys(event, ["event_id", "starts_at", "ends_at", "latitude", "longitude"]);
    id(event.event_id);
    // Candidate batches need only an event ID. Bounds remain optional historical inputs.
    check((event.starts_at == null) === (event.ends_at == null), "Historical bounds must be a pair or absent");
    if (event.starts_at != null && event.ends_at != null) {
      instant(event.starts_at); instant(event.ends_at);
      check(Date.parse(event.starts_at as string) <= Date.parse(event.ends_at as string), "Historical event ends before start");
    }
    coordinates({ latitude: event.latitude ?? null, longitude: event.longitude ?? null });
    check(!events.has(event.event_id as string), "Duplicate event ID");
    events.add(event.event_id as string);
  }
  for (const example of value.examples) {
    object(example);
    keys(example, ["photo_id", "event_id", "label", "notes", "tags", "split", "source_file", "metadata"]);
    id(example.photo_id); id(example.event_id);
    check(events.has(example.event_id as string), "Unknown example event");
    check(!photos.has(example.photo_id as string), "Duplicate photo ID (one event relation per ID)");
    photos.add(example.photo_id as string);
    check(["belongs", "does_not_belong", "ambiguous"].includes(example.label as string), "Invalid label");
    check(typeof example.notes === "string" && example.notes.trim().length > 0, "Human labeling note required");
    check(Array.isArray(example.tags) && example.tags.every(t => typeof t === "string"), "tags array required");
    check(example.split === "development" || example.split === "test", "split required");
    check(!splits.has(example.event_id as string) || splits.get(example.event_id as string) === example.split, "Keep an event in one split to prevent leakage");
    splits.set(example.event_id as string, example.split);
    if (value.kind === "synthetic") {
      check(example.source_file === undefined, "Synthetic fixtures use metadata only, never private files");
      object(example.metadata); keys(example.metadata, ["captured_at", "latitude", "longitude"]);
      if (example.metadata.captured_at !== null) instant(example.metadata.captured_at);
      coordinates(example.metadata);
    } else {
      check(example.metadata === undefined, "Private examples must extract metadata, not duplicate it");
      check(typeof example.source_file === "string" && example.source_file.length > 0 && !path.isAbsolute(example.source_file), "Relative source_file required");
    }
  }
  return value as Dataset;
}
export async function loadExamples(dataset: Dataset, root: string, split: string) {
  const rows: (Example & { metadata: Metadata })[] = [];
  const base = dataset.kind === "local_private" ? await realpath(root) : root;
  for (const example of dataset.examples.filter(e => split === "all" || e.split === split)) {
    if (dataset.kind === "synthetic") {
      rows.push({ ...example, metadata: example.metadata! });
      continue;
    }
    // Resolve symlinks as well as ../; never read outside the explicitly supplied photo root.
    try {
      const file = await realpath(path.resolve(base, example.source_file!));
      const relative = path.relative(base, file);
      check(relative !== "" && relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative), "Source escapes photo root");
      const metadata = await extractMetadata(await readFile(file));
      rows.push({ ...example, metadata });
    } catch {
      throw new Error(`Cannot read permitted local source for ${example.photo_id}; no rows silently skipped`);
    }
  }
  return rows;
}
