// Task 4.1/4.2/4.4 -- the "Outputs (N)" tab's contents: a flat grid of every
// Output on the pipeline (regardless of which step it's off of), plus a
// "+ New output" affordance. Presentational only -- fetching is owned by
// `usePipelineDetailPage` (Outputs are already loaded for the rail, task
// 3.3); this tab reuses that same cache rather than re-fetching.

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChartLine, faPlus } from "@fortawesome/free-solid-svg-icons";

import { EmptyState } from "../../../shared/ui/EmptyState";
import type { Output } from "../types/output";
import type { Step } from "../types/step";
import { OutputGalleryCard } from "./OutputGalleryCard";
import "./OutputsGalleryTab.css";

interface OutputsGalleryTabProps {
  outputs: Output[];
  steps: Step[];
  previewRowCountByOutputId: Record<string, number>;
  onOpenOutput: (output: Output) => void;
  onAddOutput: () => void;
}

export function OutputsGalleryTab({
  outputs,
  steps,
  previewRowCountByOutputId,
  onOpenOutput,
  onAddOutput,
}: OutputsGalleryTabProps) {
  const stepLabelById = new Map(steps.map((step) => [step.id, step.label]));

  return (
    <div className="outputs-gallery-tab">
      {outputs.length === 0 ? (
        // skeptic-final-3 (round 1) CR5: was a hand-rolled <div>/<p>; reuses
        // the shared EmptyState primitive (DESIGN.md:464) like every other
        // empty state this ticket built (PipelineRiverView's "No steps yet").
        <EmptyState
          variant="sidebar"
          icon={faChartLine}
          title="No Outputs yet"
          description="Add one from any step in the Steps tab, or start here."
          cta={{ label: "+ New output", onClick: onAddOutput }}
        />
      ) : (
        <>
          {/* HEL-945 -- the gallery reads "here are your Outputs, and you can
           * add another" rather than "here is a big button, and incidentally
           * some small cards": the add affordance drops to a small ghost
           * action next to the count once there's at least one Output to
           * look at, so the cards below carry the visual weight. */}
          <div className="outputs-gallery-tab__header">
            <span className="outputs-gallery-tab__count">
              {outputs.length} output{outputs.length === 1 ? "" : "s"}
            </span>
            <button
              type="button"
              className="outputs-gallery-tab__add tap-expand-44"
              onClick={onAddOutput}
            >
              <FontAwesomeIcon icon={faPlus} />
              <span>New output</span>
            </button>
          </div>
          <div className="outputs-gallery-tab__grid">
            {outputs.map((output) => (
              <OutputGalleryCard
                key={output.id}
                output={output}
                stepLabel={
                  output.nodeStepId !== undefined
                    ? (stepLabelById.get(output.nodeStepId) ?? "an unknown step")
                    : "the pipeline root"
                }
                rowCount={previewRowCountByOutputId[output.id]}
                onOpen={onOpenOutput}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
