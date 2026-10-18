// PipelineSpine -- HEL-1579 (design.md D5): the left column of the desktop pipeline page. Sources (one
// card per root), the numbered steps of every root's trunk with branches as labelled sub-spines, the
// add-step / shape affordances, and the OUTPUTS section. Presentational: every handler comes from
// `usePipelineDetailPage` and the palette / shape-picker / add-source / reorder / menu state comes in as
// `actions` (`useSpineStepActions`, owned by the layout so the phone's header and step sheet share it).
//
// `variant="phone"` (HEL-1582, design.md D4): the same pieces as a touch list -- the section eyebrows are
// visually hidden, the step-count line (with its partial-count badge) stays visible, rows are full-width
// 60px+ buttons with a chevron and no grip or row menu, "+ Add source" and "Add Outputs from a shape" live in
// the page header's overflow menu, and the cards are the board's.

import { GitBranch } from "lucide-react";
import { useMemo } from "react";

import { EmptyState } from "../../../../shared/ui/EmptyState";
import type { DataSource } from "../../../sources/types/dataSource";
import { nodePath } from "../../state/nodePath";
import type { LaneGraph } from "../../state/stepTree";
import type { Output } from "../../types/output";
import type { AnalyzeWarning, PipelineRoot } from "../../types/pipelineStep";
import type { Step } from "../../types/step";
import { TruncatedRowCountBadge } from "../TruncatedRowCountBadge";
import { SpineLane } from "./SpineLane";
import type { SpineLaneContext } from "./SpineLane";
import { SpineOutputs } from "./SpineOutputs";
import { SpineSourceCard } from "./SpineSourceCard";
import type { SpineStepActions } from "./useSpineStepActions";
import "./PipelineSpine.css";

interface PipelineSpineProps {
  /** `desktop` (default) is the left column; `phone` is the Steps tab's touch list. */
  variant?: "desktop" | "phone";
  actions: SpineStepActions;
  steps: Step[];
  laneGraph: LaneGraph;
  roots: PipelineRoot[];
  sourceByRootId: Record<string, DataSource | undefined>;
  outputs: Output[];
  selectedStepId: string | null;
  /** `null` while the steps are loading or failed: no "N steps" text then. */
  stepCount: number | null;
  rowCountFor: (stepId: string) => number | null;
  countsPartial: boolean;
  getAnalyzeValidationError: (stepId: string) => string | undefined;
  getAnalyzeWarnings: (stepId: string) => AnalyzeWarning[];
  stepSaveErrors: Record<string, string>;
  creatingStepIds: ReadonlySet<string>;
  onSelectStep: (stepId: string) => void;
  onEditSource: (sourceId: string) => void;
  onRemoveRoot: (rootId: string) => void;
  onAddOutput: (stepId?: string) => void;
  onOpenOutput: (output: Output) => void;
  onOpenOutputHistory: (output: Output) => void;
}

export function PipelineSpine({
  variant = "desktop",
  actions,
  steps,
  laneGraph,
  roots,
  sourceByRootId,
  outputs,
  selectedStepId,
  stepCount,
  rowCountFor,
  countsPartial,
  getAnalyzeValidationError,
  getAnalyzeWarnings,
  stepSaveErrors,
  creatingStepIds,
  onSelectStep,
  onEditSource,
  onRemoveRoot,
  onAddOutput,
  onOpenOutput,
  onOpenOutputHistory,
}: PipelineSpineProps) {
  const phone = variant === "phone";
  const { rootRef, reorder, menuItemsFor } = actions;
  const firstRootId = roots[0]?.id;
  const trunkOf = (rootId: string) =>
    laneGraph.lanes.find((l) => l.parentStepId === undefined && l.rootId === rootId);
  const rootZeroTrunk = firstRootId !== undefined ? trunkOf(firstRootId) : undefined;
  const rootZeroSteps = rootZeroTrunk?.steps ?? [];

  const nodePathByStepId = useMemo(() => {
    const entries: Record<string, string> = {};
    for (const step of steps) entries[step.id] = nodePath(step.id, steps, roots);
    return entries;
  }, [steps, roots]);

  const laneContext: SpineLaneContext = {
    laneGraph,
    selectedStepId,
    rowCountFor,
    countsPartial,
    hasValidationError: (id) => getAnalyzeValidationError(id) !== undefined,
    warningCountFor: (id) => getAnalyzeWarnings(id).length,
    stepSaveErrors,
    creatingStepIds,
    nodePathByStepId,
    onSelectStep,
    menuItemsFor,
    phone,
    reorderFor: (lane, index) =>
      lane.parentStepId === undefined
        ? {
            index,
            onDragStart: reorder.onStepDragStart,
            onDragEnd: reorder.onStepDragEnd,
            onDragOver: (e, i) => reorder.onCardDragOver(e, lane.id, i),
            onDrop: (e) => reorder.onCardDrop(e, lane.id),
          }
        : undefined,
    dropIndicatorAt: (lane, index) => reorder.dragLaneId === lane.id && reorder.overIndex === index,
  };

  const multiRoot = roots.length > 1;
  const hasSteps = steps.length > 0;

  const eyebrowClass = `spine-section__eyebrow eyebrow${phone ? " sr-only" : ""}`;

  return (
    <div
      className={`pipeline-spine${phone ? " pipeline-spine--phone" : ""}`}
      ref={rootRef}
      aria-label="Pipeline steps"
    >
      <section className="spine-section" aria-label={multiRoot ? "Sources" : "Source"}>
        <h3 className={eyebrowClass}>{multiRoot ? "Sources" : "Source"}</h3>
        {roots.map((root, index) => (
          <SpineSourceCard
            key={root.id}
            variant={variant}
            root={root}
            source={sourceByRootId[root.id]}
            ordinal={multiRoot ? index + 1 : null}
            canRemove={multiRoot}
            onEditSource={onEditSource}
            onRemoveRoot={onRemoveRoot}
          />
        ))}
        {!phone && (
          <button
            type="button"
            className="spine-ghost-btn"
            aria-label="Add source"
            onClick={actions.openAddRoot}
          >
            + Add source
          </button>
        )}
      </section>

      <section className="spine-section" aria-label="Steps">
        <div className="spine-section__heading">
          <h3 className={eyebrowClass}>Steps</h3>
          {stepCount !== null && (
            <span className="spine-section__count">
              {stepCount} step{stepCount !== 1 ? "s" : ""}
            </span>
          )}
          {countsPartial && <TruncatedRowCountBadge />}
        </div>

        {!hasSteps ? (
          <div className="spine-empty">
            <EmptyState
              variant="sidebar"
              icon={<GitBranch />}
              title="No steps yet"
              description="Add your first transformation step to start shaping this pipeline's output."
            />
          </div>
        ) : (
          roots.map((root) => {
            const trunk = trunkOf(root.id);
            return (
              <div key={root.id} className="spine-root">
                {multiRoot && <p className="spine-root__label">From {root.dataSourceName}</p>}
                {trunk && trunk.steps.length > 0 ? (
                  <SpineLane lane={trunk} context={laneContext} label={null} />
                ) : (
                  <p className="spine-root__empty">
                    No steps yet — join this source into another lane&apos;s step to use it.
                  </p>
                )}
              </div>
            );
          })
        )}

        <div className="spine-actions">
          <button
            type="button"
            className={phone ? "spine-add-row" : "spine-ghost-btn"}
            aria-label={hasSteps ? "+ Add transformation step" : "+ Add step"}
            onClick={actions.openAppendPalette}
          >
            + Add step
          </button>
          {!phone && (
            <button
              type="button"
              className="spine-ghost-btn"
              onClick={() =>
                actions.openShapePicker(
                  hasSteps ? rootZeroSteps[rootZeroSteps.length - 1]?.id : undefined,
                )
              }
            >
              Add Outputs from a shape
            </button>
          )}
        </div>
      </section>

      <SpineOutputs
        variant={variant}
        outputs={outputs}
        steps={steps}
        laneGraph={laneGraph}
        onOpenOutput={onOpenOutput}
        onOpenHistory={onOpenOutputHistory}
        onAddOutput={() => onAddOutput()}
      />
    </div>
  );
}
