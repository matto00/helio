export type CapturePrecision = "minute" | "second" | "millisecond";

/** HEL-1277 -- one localized rendering of a history point's capture time ("5 Oct, 14:02"), shared by
 *  the History view's captions and a custom-compare overlay label. `precision` may be a boolean
 *  (true = seconds) for the older callers. */
export function formatCaptureTime(
  iso: string,
  precision: CapturePrecision | boolean = "minute",
): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const level: CapturePrecision =
    precision === true ? "second" : precision === false ? "minute" : precision;
  return d.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    ...(level !== "minute" ? { second: "2-digit" as const } : {}),
    ...(level === "millisecond" ? { fractionalSecondDigits: 3 as const } : {}),
  });
}

const PRECISIONS: CapturePrecision[] = ["minute", "second", "millisecond"];

/** HEL-1352 -- the selected point's label and its comparison point's label, guaranteed distinct.
 *  Precision escalates minute -> second -> millisecond until the two differ; if they still read
 *  identically (same instant, or an unparseable timestamp) the comparison gets " (older capture)".
 *  A null comparison (the oldest point) keeps minute precision and a null comparison label. */
export function formatCapturePair(
  selectedIso: string,
  comparisonIso: string | null,
): { selected: string; comparison: string | null } {
  if (comparisonIso === null) return { selected: formatCaptureTime(selectedIso), comparison: null };
  for (const level of PRECISIONS) {
    const selected = formatCaptureTime(selectedIso, level);
    const comparison = formatCaptureTime(comparisonIso, level);
    if (selected !== comparison) return { selected, comparison };
  }
  return {
    selected: formatCaptureTime(selectedIso, "millisecond"),
    comparison: `${formatCaptureTime(comparisonIso, "millisecond")} (older capture)`,
  };
}
