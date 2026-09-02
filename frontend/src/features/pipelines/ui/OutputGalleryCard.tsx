// Task 4.2 -- one card per Output in the "Outputs (N)" gallery tab. Shows a
// kind badge, the Output's name, an "off <step>" subtitle (or "off the
// pipeline root" when `nodeStepId` is absent -- see `types/output.ts`'s wire
// note), and an "on N dashboards" placement count fetched lazily on mount via
// `GET /api/outputs/:id/panels` (task 4.2's own per-card lazy-fetch
// requirement -- a local effect, not a Redux slice, since this count is
// gallery-card-scoped and not shared/cached elsewhere).
//
// Live thumbnail rendering (reusing the panel renderers) is deferred: no
// Output->Panel config adapter exists yet (that's Section 5's editor
// migration), so this card reuses the same row-count text summary
// `OutputsRail` already ships (task 3.3) rather than guessing at a renderer
// mapping. Tracked as a follow-up once `OutputEditorSheet` (task 5.1)
// establishes the real Output->renderer-props shape.

import { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChartLine, faTable } from "@fortawesome/free-solid-svg-icons";

import type { Output } from "../types/output";
import { listOutputPanels } from "../services/outputService";
import "./OutputGalleryCard.css";

function thumbnailText(output: Output, rowCount: number | undefined): string {
  if (rowCount === undefined) return "—";
  if (output.kind === "metric") return rowCount > 0 ? "1 value" : "no value";
  return `${rowCount} row${rowCount === 1 ? "" : "s"}`;
}

interface OutputGalleryCardProps {
  output: Output;
  stepLabel: string;
  rowCount: number | undefined;
  onOpen: (output: Output) => void;
}

export function OutputGalleryCard({ output, stepLabel, rowCount, onOpen }: OutputGalleryCardProps) {
  const [placementCount, setPlacementCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listOutputPanels(output.id).then(
      (placements) => {
        if (!cancelled) setPlacementCount(placements.length);
      },
      () => {
        // Placement count is decorative -- a failed fetch just leaves the
        // count unshown rather than surfacing a page-level error.
        if (!cancelled) setPlacementCount(0);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [output.id]);

  return (
    <button
      type="button"
      className="output-gallery-card"
      onClick={() => onOpen(output)}
      aria-label={`Open ${output.name} output`}
    >
      <div className="output-gallery-card__thumbnail">
        <FontAwesomeIcon icon={output.kind === "chart" ? faChartLine : faTable} />
        <span>{thumbnailText(output, rowCount)}</span>
      </div>
      <div className="output-gallery-card__body">
        <span className="output-gallery-card__name">{output.name}</span>
        <span className="output-gallery-card__meta">off {stepLabel}</span>
        {placementCount !== null && (
          <span className="output-gallery-card__meta">
            on {placementCount} dashboard{placementCount === 1 ? "" : "s"}
          </span>
        )}
      </div>
    </button>
  );
}
