const KNOWN_LABELS: Record<string, string> = {
  manual: "Manual",
  scheduled: "Scheduled",
  external: "External",
  "auto-run": "Auto-run",
};

/** HEL-1277 — the human label for a run's `triggerSource`, shared by the run-history modal and the
 *  Output history view. An unrecognised value shows its raw text sentence-cased (never empty or
 *  `undefined`). */
export function triggerSourceLabel(source: string | null | undefined): string {
  if (!source) return "Unknown";
  const known = KNOWN_LABELS[source];
  if (known) return known;
  const spaced = source.replace(/[_-]+/g, " ").trim();
  if (spaced === "") return "Unknown";
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
