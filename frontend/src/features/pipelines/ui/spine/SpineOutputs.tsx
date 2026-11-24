// SpineOutputs -- HEL-1579 (design.md D5, owner ruling `spine-output-section`): the OUTPUTS section of
// the spine, one card per Output of the pipeline (replacing the Steps/Outputs tabs on desktop). The card
// opens the Output editor sheet; its quiet menu carries History. "used in N panels" reads `panelCount`
// from the pipeline's Outputs list response (no per-Output request, design.md D13).

import { ChevronRight } from "lucide-react";
import { memo } from "react";

import { ActionsMenu } from "../../../../shared/chrome/ActionsMenu";
import { ICON_SIZE } from "../../../../shared/ui/iconSize";
import { isDraftOutput } from "../../state/draftOutputs";
import { laneOutputSubtitle } from "../../state/laneLayout";
import type { LaneGraph } from "../../state/stepTree";
import type { Output } from "../../types/output";
import type { Step } from "../../types/step";

function kindLabel(kind: string): string {
  return kind.length === 0 ? kind : kind[0].toUpperCase() + kind.slice(1);
}

export interface SpineOutputsProps {
  variant?: "desktop" | "phone";
  outputs: Output[];
  steps: Step[];
  laneGraph: LaneGraph;
  onOpenOutput: (output: Output) => void;
  onOpenHistory: (output: Output) => void;
  onAddOutput: () => void;
  /** HEL-1733: set only while a draft exists and the page's Outputs are not loaded; Outputs are draft entries otherwise. */
  blockedReason?: string | null;
  /** HEL-1733: Output ids the draft edited ("Edited"); a created one reads "New · not saved". */
  editedOutputIds?: ReadonlySet<string>;
  /** HEL-1794: a viewer (or a role not yet known) is offered no "New output". */
  readOnly?: boolean;
}

function SpineOutputsView({
  variant = "desktop",
  outputs,
  steps,
  laneGraph,
  onOpenOutput,
  onOpenHistory,
  onAddOutput,
  blockedReason = null,
  editedOutputIds,
  readOnly = true,
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
              disabled={blockedReason !== null}
              title={blockedReason ?? undefined}
              onClick={() => onOpenOutput(output)}
            >
              <span className="spine-card__name">{output.name}</span>
              <span className="spine-card__meta">
                {kindLabel(output.kind)}
                {isDraftOutput(output)
                  ? " · New · not saved"
                  : (output.panelCount !== undefined &&
                      ` · used in ${output.panelCount} ${output.panelCount === 1 ? "panel" : "panels"}`) ||
                    ""}
                {!isDraftOutput(output) && editedOutputIds?.has(output.id) ? " · Edited" : ""}
              </span>
              <span className="spine-card__meta">
                from{" "}
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
                    // A created Output has no stored history until Save & run (HEL-1733).
                    disabled: isDraftOutput(output),
                    reason: isDraftOutput(output) ? "Available after Save & run" : undefined,
                    onClick: () => onOpenHistory(output),
                  },
                ]}
              />
            </div>
          </li>
        ))}
      </ul>
      {!readOnly && (
        <button
          type="button"
          className="spine-ghost-btn"
          aria-label="New output"
          disabled={blockedReason !== null}
          title={blockedReason ?? undefined}
          onClick={onAddOutput}
        >
          + Output
        </button>
      )}
    </section>
  );
}

function sameOutputs(a: Output[], b: Output[]): boolean {
  return (
    a === b ||
    (a.length === b.length &&
      a.every((o, i) => o === b[i] || JSON.stringify(o) === JSON.stringify(b[i])))
  );
}

function sameIds(a: ReadonlySet<string> | undefined, b: ReadonlySet<string> | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/** What each card's "from ..." line says, the only thing `steps` and `laneGraph` feed. */
function subtitlesOf({ outputs, steps, laneGraph }: SpineOutputsProps): (string | null)[] {
  const labelById = new Map(steps.map((s) => [s.id, s.label]));
  return outputs.map((o) =>
    o.nodeStepId !== undefined ? laneOutputSubtitle(laneGraph, labelById, o.nodeStepId) : null,
  );
}

type OutputsComparers = {
  [K in keyof SpineOutputsProps]-?: (a: SpineOutputsProps[K], b: SpineOutputsProps[K]) => boolean;
};

const is = <T,>(a: T, b: T) => a === b;

/** How each prop is compared. Typed over EVERY prop, so a prop added later fails `tsc` until someone decides how it compares. */
const OUTPUTS_COMPARERS: OutputsComparers = {
  variant: is,
  outputs: sameOutputs,
  // `steps` and `laneGraph` feed only each card's source line, so they are compared through `subtitlesOf` below, not here.
  steps: () => true,
  laneGraph: () => true,
  onOpenOutput: is,
  onOpenHistory: is,
  onAddOutput: is,
  blockedReason: is,
  editedOutputIds: sameIds,
  readOnly: is,
};

/**
 * HEL-1809: memoised on what the section shows. A step edit hands it new `steps`/`laneGraph`/`outputs` objects every
 * keystroke, but the cards read only the Outputs' content, the edited ids and each Output's source line, so those are compared
 * by value; the callbacks are compared by identity (the owner keeps them stable).
 */
export const SpineOutputs = memo(SpineOutputsView, (a, b) => {
  const same = (Object.keys(OUTPUTS_COMPARERS) as (keyof SpineOutputsProps)[]).every((k) =>
    (OUTPUTS_COMPARERS[k] as (x: unknown, y: unknown) => boolean)(a[k], b[k]),
  );
  if (!same) return false;
  const sa = subtitlesOf(a);
  const sb = subtitlesOf(b);
  return sa.every((x, i) => x === sb[i]);
});
