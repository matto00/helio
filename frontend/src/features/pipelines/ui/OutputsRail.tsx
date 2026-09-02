// Per-step-card row of Output chips (task 3.3) — one chip per Output whose
// `nodeStepId` matches this trunk step, plus a trailing "+ output" chip.
// Each chip shows a kind badge, the Output's name, and a live thumbnail
// derived from the last dry/live run's per-Output preview (row count today;
// section 5 wires in the fuller chart/table-skeleton thumbnails once the
// Output sheet's live-preview plumbing lands). Clicking a chip opens the
// Output sheet (owned by the caller via `onOpenOutput`); this component is
// presentational only — it never fetches, so it renders correctly whether
// or not a preview has been requested yet.

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChartLine, faPlus, faTable } from "@fortawesome/free-solid-svg-icons";

import type { Output } from "../types/output";
import "./OutputsRail.css";

function kindLabel(kind: string): string {
  return kind.toUpperCase();
}

function thumbnailText(output: Output, rowCount: number | undefined): string {
  if (rowCount === undefined) return "—";
  if (output.kind === "metric") return rowCount > 0 ? "1 value" : "no value";
  return `${rowCount} row${rowCount === 1 ? "" : "s"}`;
}

interface OutputsRailProps {
  outputs: Output[];
  /** Row count from each Output's most recent preview, keyed by `outputId` --
   *  absent when no preview has been fetched for that Output yet. */
  previewRowCountByOutputId: Record<string, number>;
  onOpenOutput: (output: Output) => void;
  onAddOutput: () => void;
}

export function OutputsRail({
  outputs,
  previewRowCountByOutputId,
  onOpenOutput,
  onAddOutput,
}: OutputsRailProps) {
  return (
    <div className="outputs-rail">
      {outputs.map((output) => (
        <button
          key={output.id}
          type="button"
          // HEL-676 (task 3.6) — `--control-sm` (28px) is well under the
          // DESIGN.md §4 44px mobile tap-target floor; `tap-expand-44` (see
          // `shared/ui/tapTarget.css`) grows the HIT area on touch devices
          // without inflating the painted chip.
          className="outputs-rail__chip tap-expand-44"
          onClick={() => onOpenOutput(output)}
          aria-label={`Open ${output.name} output`}
        >
          <FontAwesomeIcon icon={output.kind === "chart" ? faChartLine : faTable} />
          <span className="outputs-rail__kind">{kindLabel(output.kind)}</span>
          <span className="outputs-rail__name">{output.name}</span>
          <span className="outputs-rail__thumbnail">
            {thumbnailText(output, previewRowCountByOutputId[output.id])}
          </span>
        </button>
      ))}
      <button
        type="button"
        className="outputs-rail__chip outputs-rail__add tap-expand-44"
        onClick={onAddOutput}
        aria-label="Add output"
      >
        <FontAwesomeIcon icon={faPlus} />
        <span>Output</span>
      </button>
    </div>
  );
}
