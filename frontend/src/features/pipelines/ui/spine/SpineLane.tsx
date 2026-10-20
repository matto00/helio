// SpineLane -- HEL-1579 (design.md D5): one lane of the spine and, recursively, every lane branching off
// its steps. A root's trunk renders as the plain numbered list; a child lane renders directly under the
// row of the step it branches from, as an indented sub-spine (its own vertical line) headed by a quiet
// mono label "Lane <n> · from <parent step number and label>" (owner ruling "sub-spine + label": never
// accent). Rows in any lane are selectable exactly like trunk rows; only trunk rows reorder.

import { Fragment } from "react";
import type { ReactNode } from "react";

import type { ActionsMenuItem } from "../../../../shared/chrome/ActionsMenu";
import type { Lane, LaneGraph } from "../../state/stepTree";
import { childLanesOf, laneRenderKey, stepRenderKey } from "../../state/stepTree";
import type { Step } from "../../types/step";
import { SpineStepRow } from "./SpineStepRow";
import type { SpineRowDraft, SpineRowReorder } from "./SpineStepRow";

/** Everything a lane needs from the spine that does not vary by lane. */
export interface SpineLaneContext {
  laneGraph: LaneGraph;
  selectedStepId: string | null;
  rowCountFor: (stepId: string) => number | null;
  /** HEL-1631: the draft view of a step; `undefined` while no draft exists. */
  draftFor?: (stepId: string) => SpineRowDraft | undefined;
  countsPartial: boolean;
  hasValidationError: (stepId: string) => boolean;
  warningCountFor: (stepId: string) => number;
  stepSaveErrors: Record<string, string>;
  creatingStepIds: ReadonlySet<string>;
  nodePathByStepId: Record<string, string>;
  onSelectStep: (stepId: string) => void;
  /** Row-menu items for a step, given its lane and index within it. */
  menuItemsFor: (step: Step, lane: Lane, index: number) => ActionsMenuItem[];
  /** Reorder wiring for a trunk lane's row; `undefined` for a branch lane. */
  reorderFor: (lane: Lane, index: number) => SpineRowReorder | undefined;
  dropIndicatorAt: (lane: Lane, index: number) => boolean;
  /** HEL-1582: the phone's touch rows (no grip or row menu, a chevron, `aria-haspopup="dialog"`). */
  phone: boolean;
}

interface SpineLaneProps {
  lane: Lane;
  context: SpineLaneContext;
  /** Heading for a child lane; `null` for a root's trunk. */
  label: ReactNode | null;
}

export function SpineLane({ lane, context, label }: SpineLaneProps) {
  const { laneGraph } = context;
  return (
    <div
      className={`spine-lane${label !== null ? " spine-lane--sub" : ""}`}
      role={label !== null ? "group" : undefined}
      aria-label={label !== null ? "Lane" : undefined}
    >
      {label !== null && <p className="spine-lane__label">{label}</p>}
      <ol className="spine-lane__steps">
        {lane.steps.map((step, index) => {
          const childLanes = childLanesOf(laneGraph, step.id);
          return (
            <Fragment key={stepRenderKey(step)}>
              {context.dropIndicatorAt(lane, index) && (
                <li className="spine-lane__drop-indicator" aria-hidden="true" />
              )}
              <li className="spine-lane__item">
                <SpineStepRow
                  step={step}
                  number={index + 1}
                  selected={context.selectedStepId === step.id}
                  rowCount={context.rowCountFor(step.id)}
                  draft={context.draftFor?.(step.id)}
                  partial={context.countsPartial}
                  hasValidationError={context.hasValidationError(step.id)}
                  warningCount={context.warningCountFor(step.id)}
                  hasSaveError={context.stepSaveErrors[step.id] !== undefined}
                  isCreating={context.creatingStepIds.has(step.id)}
                  menuItems={context.menuItemsFor(step, lane, index)}
                  reorder={context.reorderFor(lane, index)}
                  nodePath={context.nodePathByStepId[step.id]}
                  phone={context.phone}
                  onSelect={context.onSelectStep}
                />
                {childLanes.map((child, childIndex) => (
                  <SpineLane
                    key={laneRenderKey(child)}
                    lane={child}
                    context={context}
                    label={
                      <>
                        Lane {childIndex + 1} · from {index + 1} {step.label}
                      </>
                    }
                  />
                ))}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </div>
  );
}
