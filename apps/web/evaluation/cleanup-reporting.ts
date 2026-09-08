const ratio = (n: number, d: number) => (d ? n / d : null);

export type BinaryRow = { label: boolean; predicted: boolean };

// A fresh, boolean-shaped metrics function -- not a reuse of the relevance
// harness's 3-state metrics() in reporting.ts. The label/prediction shapes
// genuinely differ (belongs/does_not_belong/ambiguous + selected/review/
// excluded vs. plain true/false); forcing a shared function here would be
// the premature abstraction the project's own conventions warn against.
export function binaryMetrics(rows: BinaryRow[]) {
  const tp = rows.filter((r) => r.label && r.predicted).length;
  const fn = rows.filter((r) => r.label && !r.predicted).length;
  const fp = rows.filter((r) => !r.label && r.predicted).length;
  const tn = rows.filter((r) => !r.label && !r.predicted).length;
  return {
    total: rows.length,
    tp,
    fp,
    fn,
    tn,
    precision: ratio(tp, tp + fp),
    recall: ratio(tp, tp + fn),
    fpr: ratio(fp, fp + tn),
    accuracy: ratio(tp + tn, rows.length),
  };
}
