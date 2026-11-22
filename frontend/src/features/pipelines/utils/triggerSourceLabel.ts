import { TRIGGER_SOURCES, type TriggerSource } from "../types/pipelineStep";

/** Exhaustive over `TriggerSource`: a fifth backend value fails to compile here instead of falling through silently. */
const KNOWN_LABELS: Record<TriggerSource, string> = {
  manual: "Manual",
  scheduled: "Scheduled",
  external: "External",
  "auto-run": "Auto-run",
};

function isTriggerSource(source: string): source is TriggerSource {
  return (TRIGGER_SOURCES as readonly string[]).includes(source);
}

/** HEL-1277 — the human label for a run's `triggerSource`, shared by the run-history modal and the
 *  Output history view. The input stays `string` (history points and the home summary type it so, and a newer backend may send a value this client predates), so an unrecognised value shows its raw text sentence-cased (never empty or
 *  `undefined`). */
export function triggerSourceLabel(source: string | null | undefined): string {
  if (!source) return "Unknown";
  if (isTriggerSource(source)) return KNOWN_LABELS[source];
  const spaced = source.replace(/[_-]+/g, " ").trim();
  if (spaced === "") return "Unknown";
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
