// Local development only: no telemetry endpoint, identifiers, raw errors or URLs.
const events = new Set([
  "selection",
  "prepare_file",
  "prepare_batch",
  "upload_batch",
  "upload_init",
  "object_put",
  "upload_complete",
  "photo_state",
  "list_loaded",
  "list_failed",
  "visibility",
  "pagehide",
  "pageshow",
]);
const fields = new Set([
  "count",
  "bytes",
  "elapsed_ms",
  "index",
  "skipped",
  "thumbnail_bytes",
  "preview_available",
  "heic",
  "type_missing",
  "captured_at_present",
  "gps_present",
  "success",
  "failed",
  "uploaded",
  "retry_count",
  "original_ready",
  "thumbnail_ready",
  "hidden",
  "persisted",
  "concurrency",
]);
type Metrics = Record<string, number | boolean>;
export type Diagnostic = { sequence: number; event: string; metrics: Metrics };
let entries: Diagnostic[] = [];
let sequence = 0;
const listeners = new Set<() => void>();
const empty: Diagnostic[] = [];

export function recordDiagnostic(event: string, metrics: Metrics = {}): void {
  if (process.env.NODE_ENV !== "development" || !events.has(event)) return;
  // Runtime allowlist also protects against an accidentally passed file/job object.
  const safe: Metrics = {};
  for (const [key, value] of Object.entries(metrics)) {
    if (
      fields.has(key) &&
      (typeof value === "boolean" ||
        (typeof value === "number" && Number.isFinite(value)))
    ) {
      safe[key] = typeof value === "number" ? Math.round(value) : value;
    }
  }
  const entry = { sequence: ++sequence, event, metrics: safe };
  entries = [...entries.slice(-99), entry];
  console.info("[Gatheroll photo]", JSON.stringify(entry));
  listeners.forEach((listener) => listener());
}

export async function tracePhotoStep<T>(
  event: string,
  metrics: Metrics,
  run: () => Promise<T>,
): Promise<T> {
  const start = performance.now();
  try {
    const result = await run();
    recordDiagnostic(event, {
      ...metrics,
      success: true,
      elapsed_ms: performance.now() - start,
    });
    return result;
  } catch (cause) {
    recordDiagnostic(event, {
      ...metrics,
      success: false,
      elapsed_ms: performance.now() - start,
    });
    throw cause;
  }
}

export const diagnosticStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  getSnapshot: () => entries,
  getServerSnapshot: () => empty,
};
