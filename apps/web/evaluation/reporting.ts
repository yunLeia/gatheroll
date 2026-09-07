import type { Example } from "./dataset";
import { predict, type Baseline, type Config, type Event, type Metadata } from "./scoring";

export type Row = ReturnType<typeof predict> & Pick<Example, "photo_id" | "event_id" | "label" | "notes" | "tags" | "split"> & { metadata: Metadata };
const ratio = (n: number, d: number) => d ? n / d : null;
export function metrics(rows: Row[]) {
  const strict = rows.filter(r => r.label !== "ambiguous");
  const positives = strict.filter(r => r.label === "belongs");
  const negatives = strict.filter(r => r.label === "does_not_belong");
  const tp = positives.filter(r => r.predicted === "selected").length;
  const fp = negatives.filter(r => r.predicted === "selected").length;
  const fn = positives.length - tp; // Includes review: automatic-selection recall, not final human recall.
  const ambiguous = rows.filter(r => r.label === "ambiguous");
  return { total: rows.length, strict_total: strict.length, positives: positives.length, negatives: negatives.length,
    tp, fp, fn, tn: negatives.length - fp, unrelated_auto_selected: fp,
    precision: ratio(tp, tp + fp), recall: ratio(tp, positives.length), fpr: ratio(fp, negatives.length),
    review_rate: ratio(rows.filter(r => r.predicted === "review").length, rows.length),
    automatic_selection_rate: ratio(rows.filter(r => r.predicted === "selected").length, rows.length),
    excluded_rate: ratio(rows.filter(r => r.predicted === "excluded").length, rows.length),
    belongs_review: positives.filter(r => r.predicted === "review").length,
    belongs_excluded: positives.filter(r => r.predicted === "excluded").length,
    ambiguous: { total: ambiguous.length, selected: ambiguous.filter(r => r.predicted === "selected").length,
      review: ambiguous.filter(r => r.predicted === "review").length, excluded: ambiguous.filter(r => r.predicted === "excluded").length } };
}
export function evaluate(examples: (Example & { metadata: Metadata })[], events: Event[], config: Config, systems: Baseline[] = ["all_selected"]) {
  const rows: Row[] = systems.flatMap(baseline => examples.map(e => ({
    photo_id: e.photo_id, event_id: e.event_id, label: e.label, notes: e.notes, tags: e.tags, split: e.split,
    metadata: e.metadata, ...predict(e.metadata, events.find(event => event.event_id === e.event_id)!, config, baseline),
  })));
  return { rows, comparison: systems.map(baseline => ({ baseline, ...metrics(rows.filter(r => r.baseline === baseline)) })) };
}
export function errorKind(row: Row) {
  if (row.label === "ambiguous") return "ambiguous";
  if (row.label === "does_not_belong" && row.predicted === "selected") return "FP";
  if (row.label === "belongs" && row.predicted !== "selected") return "FN";
  return null;
}
// CSV cells are quoted and formula-leading user notes are neutralized for spreadsheet opening.
export function csv(records: Record<string, unknown>[]) {
  if (!records.length) return "";
  const headers = Object.keys(records[0]);
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    if (/^[\s]*[=+@-]/.test(s) && typeof v !== "number") s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  return [headers.map(cell).join(","), ...records.map(r => headers.map(k => cell(r[k])).join(","))].join("\n") + "\n";
}
export function errorsMarkdown(rows: Row[]) {
  const safe = (value: unknown) => String(value ?? "missing").replaceAll("|", "\\|").replace(/[\r\n]/g, " ").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const header = "# Error analysis (local; may contain private metadata)\n\nFN includes belongs → review. Ambiguous is separate, never strict FP/FN.\n\n| System | ID | Label | State | Error | Δ minutes | Distance m | Signals | Human note |\n|---|---|---|---|---|---|---|---|---|\n";
  return header + rows.filter(r => errorKind(r)).map(r => [r.baseline, r.photo_id, r.label, r.predicted, errorKind(r), r.delta_minutes, r.distance_meters, r.available_signals.join(", "), r.notes].map(safe).join(" | ")).map(line => `| ${line} |`).join("\n") + "\n";
}
