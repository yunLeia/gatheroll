"use client";

import { useSyncExternalStore } from "react";
import { diagnosticStore } from "./diagnostics";

export function DiagnosticPanel() {
  const entries = useSyncExternalStore(
    diagnosticStore.subscribe,
    diagnosticStore.getSnapshot,
    diagnosticStore.getServerSnapshot,
  );
  if (process.env.NODE_ENV !== "development") return null;
  return (
    <details className="min-w-0 text-xs text-muted-foreground">
      <summary className="min-h-11 cursor-pointer">
        Photo diagnostics (development only)
      </summary>
      <p className="mb-2">
        Last 100 entries, this page session only. Also in the browser console.
        No filenames, locations, tokens or URLs. Refresh clears this log;
        list_loaded records the restored photo count.
      </p>
      <pre
        className="max-h-64 overflow-auto rounded-md border border-border p-2"
        aria-label="Photo diagnostic log"
      >
        {entries.map((entry) => JSON.stringify(entry)).join("\n") ||
          "No photo diagnostics yet."}
      </pre>
    </details>
  );
}
