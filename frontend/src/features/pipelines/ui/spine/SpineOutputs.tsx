// SpineOutputs -- HEL-1579 (design.md D5, owner ruling `spine-output-section`): the OUTPUTS section of
// the spine, one card per Output of the pipeline (replacing the Steps/Outputs tabs on desktop). The card
// opens the Output editor sheet; its quiet menu carries History. "used in N panels" reads `panelCount`
// from the pipeline's Outputs list response (no per-Output request, design.md D13).

import { ChevronRight } from "lucide-react";

import { ActionsMenu } from "../../../../shared/chrome/ActionsMenu";
import { ICON_SIZE } from "../../../../shared/ui/iconSize";
import { laneOutputSubtitle } from "../../state/laneLayout";
import type { LaneGraph } from "../../state/stepTree";
import type { Output } from "../../types/output";
import type { Step } from "../../types/step";

function kindLabel(kind: string): string {
  return kind.length === 0 ? kind : kind[0].toUpperCase() + kind.slice(1);
}

interface SpineOutputsProps {
  variant?: "desktop" | "phone";
  outputs: Output[];
  steps: Step[];
  laneGraph: LaneGraph;
  onOpenOutput: (output: Output) => void;
  onOpenHistory: (output: Output) => void;
  onAddOutput: () => void;
}

export function SpineOutputs({
  variant = "desktop",
  outputs,
  steps,
  laneGraph,
  onOpenOutput,
  onOpenHistory,
  onAddOutput,
}: SpineOutputsProps) {
  const phone = variant === "phone";
  const stepLabelById = new Map(steps.map((s) => [s.id, s.label]));
  return (
    <section className="spine-section" aria-label="Outputs">
      <h3 className={`spine-section__eyebrow eyebrow${phone ? " sr-only" : ""}`}>Outputs</h3>
      <ul className="spine-outputs">
        {outputs.map((output) => (
          <li key={output.id} className="spine-card spine-output-card">
            <button
              type="button"
              className="spine-card__open"
              aria-label={`Open ${output.name} output`}
              onClick={() => onOpenOutput(output)}
            >
              <span className="spine-card__name">{output.name}</span>
              <span className="spine-card__meta">
                {kindLabel(output.kind)}
                {output.panelCount !== undefined &&
                  ` · used in ${output.panelCount} ${output.panelCount === 1 ? "panel" : "panels"}`}
              </span>
              <span className="spine-card__meta">
                off{" "}
                {output.nodeStepId !== undefined
                  ? laneOutputSubtitle(laneGraph, stepLabelById, output.nodeStepId)
                  : "the pipeline's source"}
              </span>
              {phone && (
                <ChevronRight
                  className="spine-card__chevron"
                  aria-hidden="true"
                  size={ICON_SIZE.sm}
                />
              )}
            </button>
            <div className="spine-card__menu">
              <ActionsMenu
                label={`Output actions for ${output.name}`}
                items={[
                  {
                    label: "History",
                    ariaLabel: `History for ${output.name}`,
                    onClick: () => onOpenHistory(output),
                  },
                ]}
              />
            </div>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="spine-ghost-btn"
        aria-label="New output"
        onClick={onAddOutput}
      >
        + Output
      </button>
    </section>
  );
}
