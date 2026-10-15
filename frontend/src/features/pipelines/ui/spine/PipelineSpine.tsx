// PipelineSpine -- HEL-1579 (design.md D5): the left column of the desktop pipeline page. Sources (one
// card per root), the numbered steps of every root's trunk with branches as labelled sub-spines, the
// add-step / shape affordances, and the OUTPUTS section. Presentational: every handler comes from
// `usePipelineDetailPage`; this component owns only the palette / shape-picker / add-source dialogs'
// open state and the drag-reorder wiring (`useLaneReorder`, lane-scoped as before).

import { GitBranch } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { ActionsMenuItem } from "../../../../shared/chrome/ActionsMenu";
import { EmptyState } from "../../../../shared/ui/EmptyState";
import type { DataSource } from "../../../sources/types/dataSource";
import { useLaneReorder } from "../../hooks/useLaneReorder";
import { nodePath } from "../../state/nodePath";
import type { Lane, LaneGraph } from "../../state/stepTree";
import type { ExpandPipelineShapeResponse } from "../../types/pipelineShape";
import type { Output } from "../../types/output";
import type { AnalyzeWarning, PipelineRoot } from "../../types/pipelineStep";
import type { OpType, Step } from "../../types/step";
import { AddRootModal } from "../AddRootModal";
import { StepPalette } from "../StepPalette";
import { TruncatedRowCountBadge } from "../TruncatedRowCountBadge";
import { ShapePickerModal } from "../shapes/ShapePickerModal";
import { SpineLane } from "./SpineLane";
import type { SpineLaneContext } from "./SpineLane";
import { SpineOutputs } from "./SpineOutputs";
import { SpineSourceCard } from "./SpineSourceCard";
import "./PipelineSpine.css";

/** What the open step palette will do with the op the user picks. */
type PaletteTarget =
  | { kind: "append" }
  | { kind: "insert"; index: number }
  | { kind: "branch"; parentStepId: string };

interface PipelineSpineProps {
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
  onAddRoot: (sourceId: string) => void;
  onRemoveRoot: (rootId: string) => void;
  onAddStep: (opType: OpType) => void;
  onInsertStep: (opType: OpType, index: number) => void;
  onAddLaneStep: (opType: OpType, parentStepId: string) => void;
  onAddOutput: (stepId?: string) => void;
  onOpenOutput: (output: Output) => void;
  onOpenOutputHistory: (output: Output) => void;
  onInstantiateShape: (
    expansion: ExpandPipelineShapeResponse,
    anchorStepId?: string,
  ) => Promise<void>;
  onReorderSteps: (newOrder: Step[]) => void | Promise<void>;
}

export function PipelineSpine({
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
  onAddRoot,
  onRemoveRoot,
  onAddStep,
  onInsertStep,
  onAddLaneStep,
  onAddOutput,
  onOpenOutput,
  onOpenOutputHistory,
  onInstantiateShape,
  onReorderSteps,
}: PipelineSpineProps) {
  const [palette, setPalette] = useState<PaletteTarget | null>(null);
  const [shapePickerOpen, setShapePickerOpen] = useState(false);
  const [shapeAnchorStepId, setShapeAnchorStepId] = useState<string | undefined>(undefined);
  const [addRootOpen, setAddRootOpen] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const reorder = useLaneReorder(laneGraph, onReorderSteps, rootRef);

  // Focus follows a moved step: the row menu closes on activation, so put focus on the moved row.
  const focusRowAfterMoveRef = useRef<string | null>(null);
  useEffect(() => {
    const stepId = focusRowAfterMoveRef.current;
    if (stepId === null) return;
    focusRowAfterMoveRef.current = null;
    rootRef.current
      ?.querySelector<HTMLButtonElement>(
        `[data-step-row="${CSS.escape(stepId)}"] .spine-row__select`,
      )
      ?.focus();
  }, [laneGraph]);

  const firstRootId = roots[0]?.id;
  const trunkOf = (rootId: string) =>
    laneGraph.lanes.find((l) => l.parentStepId === undefined && l.rootId === rootId);
  const rootNameOf = (rootId: string) =>
    roots.find((r) => r.id === rootId)?.dataSourceName ?? "this source";
  const rootZeroTrunk = firstRootId !== undefined ? trunkOf(firstRootId) : undefined;
  const rootZeroSteps = rootZeroTrunk?.steps ?? [];

  const nodePathByStepId = useMemo(() => {
    const entries: Record<string, string> = {};
    for (const step of steps) entries[step.id] = nodePath(step.id, steps, roots);
    return entries;
  }, [steps, roots]);

  function openShapePicker(anchor: string | undefined) {
    setShapeAnchorStepId(anchor);
    setShapePickerOpen(true);
  }

  function menuItemsFor(step: Step, lane: Lane, index: number): ActionsMenuItem[] {
    const items: ActionsMenuItem[] = [];
    const isTrunk = lane.parentStepId === undefined;
    if (isTrunk) {
      const laneLabel = rootNameOf(lane.rootId);
      items.push(
        {
          label: "Move up",
          ariaLabel: `Move step up in ${laneLabel}`,
          disabled: index === 0,
          onClick: () => {
            focusRowAfterMoveRef.current = step.id;
            reorder.onMoveUp(step.id);
          },
        },
        {
          label: "Move down",
          ariaLabel: `Move step down in ${laneLabel}`,
          disabled: index === lane.steps.length - 1,
          onClick: () => {
            focusRowAfterMoveRef.current = step.id;
            reorder.onMoveDown(step.id);
          },
        },
      );
    }
    // Insert is offered exactly where the river had "Insert step here" gaps: root 0's trunk. Index 0
    // gets "before" (the gap above the first card); the last row's "after" appends, as the river's
    // "+ Add transformation step" did (no new insertion semantics, design.md D5).
    if (isTrunk && lane.rootId === firstRootId) {
      if (index === 0) {
        items.push({
          label: "Insert step before",
          onClick: () => setPalette({ kind: "insert", index: 0 }),
        });
      }
      items.push({
        label: "Insert step after",
        onClick: () =>
          setPalette(
            index === lane.steps.length - 1
              ? { kind: "append" }
              : { kind: "insert", index: index + 1 },
          ),
      });
    }
    items.push(
      {
        label: "Branch from here",
        onClick: () => setPalette({ kind: "branch", parentStepId: step.id }),
      },
      { label: "Add output", onClick: () => onAddOutput(step.id) },
    );
    return items;
  }

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

  function handlePaletteSelect(opType: OpType) {
    const target = palette;
    setPalette(null);
    if (target === null) return;
    if (target.kind === "append") onAddStep(opType);
    else if (target.kind === "insert") onInsertStep(opType, target.index);
    else onAddLaneStep(opType, target.parentStepId);
  }

  const multiRoot = roots.length > 1;
  const hasSteps = steps.length > 0;

  return (
    <div className="pipeline-spine" ref={rootRef} aria-label="Pipeline steps">
      <section className="spine-section" aria-label={multiRoot ? "Sources" : "Source"}>
        <h3 className="spine-section__eyebrow eyebrow">{multiRoot ? "Sources" : "Source"}</h3>
        {roots.map((root, index) => (
          <SpineSourceCard
            key={root.id}
            root={root}
            source={sourceByRootId[root.id]}
            ordinal={multiRoot ? index + 1 : null}
            canRemove={multiRoot}
            onEditSource={onEditSource}
            onRemoveRoot={onRemoveRoot}
          />
        ))}
        <button
          type="button"
          className="spine-ghost-btn"
          aria-label="Add source"
          onClick={() => setAddRootOpen(true)}
        >
          + Add source
        </button>
      </section>

      <section className="spine-section" aria-label="Steps">
        <div className="spine-section__heading">
          <h3 className="spine-section__eyebrow eyebrow">Steps</h3>
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
            className="spine-ghost-btn"
            aria-label={hasSteps ? "+ Add transformation step" : "+ Add step"}
            onClick={() => setPalette({ kind: "append" })}
          >
            + Add step
          </button>
          <button
            type="button"
            className="spine-ghost-btn"
            onClick={() =>
              openShapePicker(hasSteps ? rootZeroSteps[rootZeroSteps.length - 1]?.id : undefined)
            }
          >
            Add Outputs from a shape
          </button>
        </div>
      </section>

      <SpineOutputs
        outputs={outputs}
        steps={steps}
        laneGraph={laneGraph}
        onOpenOutput={onOpenOutput}
        onOpenHistory={onOpenOutputHistory}
        onAddOutput={() => onAddOutput()}
      />

      {/* `open` is the real boolean, not a conditional mount: Modal's focus-restore only runs on a
          true->false transition (HEL-1136 evaluation-1.md CR1). */}
      <StepPalette
        open={palette !== null}
        onSelect={handlePaletteSelect}
        onClose={() => setPalette(null)}
      />
      {shapePickerOpen && (
        <ShapePickerModal
          anchorStepId={shapeAnchorStepId}
          onClose={() => setShapePickerOpen(false)}
          onSeedSteps={onInstantiateShape}
        />
      )}
      {addRootOpen && (
        <AddRootModal
          onClose={() => setAddRootOpen(false)}
          onAdd={(sourceId) => {
            onAddRoot(sourceId);
            setAddRootOpen(false);
          }}
        />
      )}
    </div>
  );
}
