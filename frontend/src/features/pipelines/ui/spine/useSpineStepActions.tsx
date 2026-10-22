// useSpineStepActions -- HEL-1582 (design.md D4), extracted from `PipelineSpine` (HEL-1579 D5) so the phone layout
// can own the same state at layout level: the step-palette target, the shape picker, the add-source dialog, the
// lane-scoped reorder wiring, and the per-step menu items. The desktop spine and the phone's header overflow and
// step sheet all read one instance, so no handler is duplicated. `dialogs` is the three modals; render it once.

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";

import type { ActionsMenuItem } from "../../../../shared/chrome/ActionsMenu";
import { useLaneReorder } from "../../hooks/useLaneReorder";
import { useLatestCallback } from "../../hooks/useLatestCallback";
import type { Lane, LaneGraph } from "../../state/stepTree";
import type { ExpandPipelineShapeResponse } from "../../types/pipelineShape";
import type { PipelineRoot } from "../../types/pipelineStep";
import type { OpType, Step } from "../../types/step";
import { AddRootModal } from "../AddRootModal";
import { StepPalette } from "../StepPalette";
import { ShapePickerModal } from "../shapes/ShapePickerModal";

/** What the open step palette will do with the op the user picks. */
type PaletteTarget =
  | { kind: "append" }
  | { kind: "insert"; index: number }
  | { kind: "branch"; parentStepId: string };

export interface SpineStepActionsArgs {
  laneGraph: LaneGraph;
  roots: PipelineRoot[];
  onAddStep: (opType: OpType) => void;
  onInsertStep: (opType: OpType, index: number) => void;
  onAddLaneStep: (opType: OpType, parentStepId: string) => void;
  onAddOutput: (stepId?: string) => void;
  onAddRoot: (sourceId: string) => void;
  onInstantiateShape: (
    expansion: ExpandPipelineShapeResponse,
    anchorStepId?: string,
  ) => Promise<void>;
  onReorderSteps: (newOrder: Step[]) => void | Promise<void>;
  /** HEL-1631 (design.md D2): while a draft exists the structural menu items are disabled with this reason. */
  structuralBlockedReason?: string | null;
}

export interface SpineStepActions {
  /** Attach to the element containing the step rows: focus follows a moved row inside it. */
  rootRef: RefObject<HTMLDivElement | null>;
  reorder: ReturnType<typeof useLaneReorder>;
  /** `restoreFocus`, when given, takes focus after a Move (the phone sheet, where the moved row behind the modal is
   *  inert); absent, focus follows the moved row. */
  menuItemsFor: (
    step: Step,
    lane: Lane,
    index: number,
    restoreFocus?: () => void,
  ) => ActionsMenuItem[];
  openAppendPalette: () => void;
  /** Open the shape picker anchored after `anchorStepId` (or the source when `undefined`). */
  openShapePicker: (anchorStepId: string | undefined) => void;
  openAddRoot: () => void;
  /** The step palette, shape picker and add-source dialogs; render once. */
  dialogs: ReactNode;
}

export function useSpineStepActions({
  laneGraph,
  roots,
  onAddStep,
  onInsertStep,
  onAddLaneStep,
  onAddOutput,
  onAddRoot,
  onInstantiateShape,
  onReorderSteps,
  structuralBlockedReason = null,
}: SpineStepActionsArgs): SpineStepActions {
  const blocked = structuralBlockedReason !== null;
  const reason = structuralBlockedReason ?? undefined;
  const [palette, setPalette] = useState<PaletteTarget | null>(null);
  const [shapePickerOpen, setShapePickerOpen] = useState(false);
  const [shapeAnchorStepId, setShapeAnchorStepId] = useState<string | undefined>(undefined);
  const [addRootOpen, setAddRootOpen] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  // Focus follows a moved step: the row menu closes on activation, so put focus on the moved row. Cleared once the
  // reorder settles (committed, refused by the CR2 guard, or rolled back after a failed PUT), so a stale value can
  // never steal focus on a later, unrelated change.
  const focusRowAfterMoveRef = useRef<string | null>(null);
  const reorderAndSettle = useCallback(
    (next: Step[]) => {
      const result = onReorderSteps(next);
      if (result instanceof Promise) {
        void result.finally(() => {
          focusRowAfterMoveRef.current = null;
        });
      }
      return result;
    },
    [onReorderSteps],
  );
  const reorder = useLaneReorder(laneGraph, reorderAndSettle);

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
  const rootNameOf = (rootId: string) =>
    roots.find((r) => r.id === rootId)?.dataSourceName ?? "this source";

  function openShapePicker(anchor: string | undefined) {
    setShapeAnchorStepId(anchor);
    setShapePickerOpen(true);
  }

  function menuItemsFor(
    step: Step,
    lane: Lane,
    index: number,
    restoreFocus?: () => void,
  ): ActionsMenuItem[] {
    const items: ActionsMenuItem[] = [];
    const isTrunk = lane.parentStepId === undefined;
    if (isTrunk) {
      const laneLabel = rootNameOf(lane.rootId);
      items.push(
        {
          label: "Move up",
          ariaLabel: `Move step up in ${laneLabel}`,
          disabled: blocked || index === 0,
          reason,
          onClick: () => {
            if (restoreFocus) restoreFocus();
            else focusRowAfterMoveRef.current = step.id;
            reorder.onMoveUp(step.id);
          },
        },
        {
          label: "Move down",
          ariaLabel: `Move step down in ${laneLabel}`,
          disabled: blocked || index === lane.steps.length - 1,
          reason,
          onClick: () => {
            if (restoreFocus) restoreFocus();
            else focusRowAfterMoveRef.current = step.id;
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
          disabled: blocked,
          reason,
          onClick: () => setPalette({ kind: "insert", index: 0 }),
        });
      }
      items.push({
        label: "Insert step after",
        disabled: blocked,
        reason,
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
        disabled: blocked,
        reason,
        onClick: () => setPalette({ kind: "branch", parentStepId: step.id }),
      },
      { label: "Add output", disabled: blocked, reason, onClick: () => onAddOutput(step.id) },
    );
    return items;
  }

  // Both go to the memoised StepPalette, which is mounted while closed: stable identities keep a draft edit from
  // re-rendering it, and the latest closure still sees the current palette target and the layout's add handlers.
  const handlePaletteSelect = useLatestCallback((opType: OpType) => {
    const target = palette;
    setPalette(null);
    if (target === null) return;
    if (target.kind === "append") onAddStep(opType);
    else if (target.kind === "insert") onInsertStep(opType, target.index);
    else onAddLaneStep(opType, target.parentStepId);
  });
  const closePalette = useLatestCallback(() => setPalette(null));

  const dialogs = (
    <>
      {/* `open` is the real boolean, not a conditional mount: Modal's focus-restore only runs on a
          true->false transition (HEL-1136 evaluation-1.md CR1). */}
      <StepPalette open={palette !== null} onSelect={handlePaletteSelect} onClose={closePalette} />
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
    </>
  );

  return {
    rootRef,
    reorder,
    menuItemsFor,
    openAppendPalette: () => setPalette({ kind: "append" }),
    openShapePicker,
    openAddRoot: () => setAddRootOpen(true),
    dialogs,
  };
}
