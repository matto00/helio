import { OP_TYPES } from "../../pipelines/state/stepNarrowing";
import type { ProvenanceLastRun } from "./provenanceService";

const OP_LABELS: ReadonlyMap<string, string> = new Map(OP_TYPES.map((op) => [op.id, op.label]));

/** "join" -> "Join", "datebucket_x" -> "Datebucket x". */
export function humanise(kind: string): string {
  const spaced = kind.replace(/[_-]+/g, " ").trim();
  return spaced.length === 0 ? kind : spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** HEL-1207 A5 — step kind -> the pipeline UI's own op label; kinds not in `OP_TYPES` (e.g. `groupby`,
 *  deliberately excluded from the picker) fall back to a humanised string. Never a raw op id. */
export function stepKindLabel(kind: string): string {
  return OP_LABELS.get(kind) ?? humanise(kind);
}

export type LastRunState = "never" | "running" | "failed" | "succeeded";

export function lastRunState(lastRun: ProvenanceLastRun | null): LastRunState {
  if (lastRun === null) return "never";
  const status = lastRun.status.toLowerCase();
  if (status === "failed") return "failed";
  if (status === "succeeded") return "succeeded";
  return "running";
}
