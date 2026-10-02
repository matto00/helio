// useLaneReorder — HEL-1007. Lane-scoped Move up/down + drag-reorder for EVERY root's trunk lane
// (HEL-968 wired it for root 0 only). One handler set, keyed by step id: each handler locates the
// step's own trunk lane in the current `LaneGraph` rather than closing over "the first root", so the
// same stable callbacks serve every lane and the React.memo'd `StepCard` keeps skipping unrelated
// re-renders (F-146). Branch (non-trunk) lanes are never reordered here: the reorder endpoint
// permutes trunk ids only, a tail travels with its trunk step.

import { useCallback, useEffect, useRef, useState } from "react";
import type { DragEvent, RefObject } from "react";

import type { Step } from "../types/step";
import type { LaneGraph } from "../state/stepTree";
import { reorderLane } from "../state/stepTree";

/** Reorder wiring a lane owner hands to `LaneColumn`. Present only for a root's trunk lane. */
export interface LaneReorder {
  /** Accessible lane name appended to the Move buttons' label (the root's source name). */
  laneLabel: string;
  onMoveUp: (stepId: string) => void;
  onMoveDown: (stepId: string) => void;
  onStepDragStart: (index: number, stepId: string) => void;
  onStepDragEnd: () => void;
  onCardDragOver: (e: DragEvent<HTMLElement>, laneId: string, index: number) => void;
  onCardDrop: (e: DragEvent<HTMLElement>, laneId: string) => void;
  /** Index (within `dragLaneId`) a drop would land at, for the drop-indicator line. */
  dragLaneId: string | null;
  overIndex: number | null;
}

type Direction = "up" | "down";
interface PendingFocus {
  stepId: string;
  direction: Direction;
}

function trunkLaneOfStep(graph: LaneGraph, stepId: string) {
  const laneId = graph.laneOfStepId[stepId];
  const lane = graph.lanes.find((l) => l.id === laneId);
  return lane && lane.parentStepId === undefined ? lane : undefined;
}

interface DragState {
  laneId: string;
  index: number;
  overIndex: number | null;
}

export function useLaneReorder(
  laneGraph: LaneGraph,
  onReorderSteps: (newOrder: Step[]) => void | Promise<void>,
  containerRef: RefObject<HTMLElement | null>,
) {
  // Read the current graph without closing over it, so the handlers' identity survives the
  // renders that change `laneGraph` most often (one keystroke in one step's editor).
  const laneGraphRef = useRef(laneGraph);
  useEffect(() => {
    laneGraphRef.current = laneGraph;
  }, [laneGraph]);

  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  useEffect(() => {
    dragRef.current = drag;
  }, [drag]);

  // Focus follows the moved step. `StepCard` is React.memo'd, so this is an effect keyed on the
  // lane graph (the commit that actually moves the DOM), not a prop that would bust memoisation.
  // Always cleared once the reorder settles (committed, refused by the CR2 guard, or rolled back
  // after a failed PUT), so a stale value can never steal focus on a later, unrelated change.
  const pendingFocusRef = useRef<PendingFocus | null>(null);
  useEffect(() => {
    const pending = pendingFocusRef.current;
    const container = containerRef.current;
    if (!pending || !container) return;
    pendingFocusRef.current = null;
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("[data-move-dir]"));
    const find = (dir: Direction) =>
      buttons.find((b) => b.dataset.stepId === pending.stepId && b.dataset.moveDir === dir);
    const preferred = find(pending.direction);
    const target =
      preferred && !preferred.disabled
        ? preferred
        : find(pending.direction === "up" ? "down" : "up");
    target?.focus();
  }, [laneGraph, containerRef]);

  const commit = useCallback(
    (lane: { id: string }, from: number, to: number, focus: PendingFocus | null) => {
      pendingFocusRef.current = focus;
      const result = onReorderSteps(reorderLane(laneGraphRef.current, lane.id, from, to));
      if (result instanceof Promise) {
        void result.finally(() => {
          pendingFocusRef.current = null;
        });
      }
    },
    [onReorderSteps],
  );

  const onMoveUp = useCallback(
    (stepId: string) => {
      const lane = trunkLaneOfStep(laneGraphRef.current, stepId);
      if (!lane) return;
      const index = lane.steps.findIndex((s) => s.id === stepId);
      if (index <= 0) return;
      commit(lane, index, index - 1, { stepId, direction: "up" });
    },
    [commit],
  );

  const onMoveDown = useCallback(
    (stepId: string) => {
      const lane = trunkLaneOfStep(laneGraphRef.current, stepId);
      if (!lane) return;
      const index = lane.steps.findIndex((s) => s.id === stepId);
      if (index === -1 || index >= lane.steps.length - 1) return;
      commit(lane, index, index + 1, { stepId, direction: "down" });
    },
    [commit],
  );

  const onStepDragStart = useCallback((index: number, stepId: string) => {
    const lane = trunkLaneOfStep(laneGraphRef.current, stepId);
    if (!lane) return;
    const next = { laneId: lane.id, index, overIndex: null };
    dragRef.current = next;
    setDrag(next);
  }, []);

  const onStepDragEnd = useCallback(() => {
    dragRef.current = null;
    setDrag(null);
  }, []);

  const onCardDragOver = useCallback((e: DragEvent<HTMLElement>, laneId: string, index: number) => {
    const current = dragRef.current;
    // A drop only applies inside the lane the drag started in: no cross-lane/cross-root move.
    if (!current || current.laneId !== laneId) return;
    e.preventDefault();
    if (current.overIndex === index) return;
    const next = { ...current, overIndex: index };
    dragRef.current = next;
    setDrag(next);
  }, []);

  const onCardDrop = useCallback(
    (e: DragEvent<HTMLElement>, laneId: string) => {
      const current = dragRef.current;
      if (!current || current.laneId !== laneId) return;
      e.preventDefault();
      const { index, overIndex } = current;
      dragRef.current = null;
      setDrag(null);
      if (overIndex === null || overIndex === index) return;
      const target = index < overIndex ? overIndex - 1 : overIndex;
      commit({ id: laneId }, index, target, null);
    },
    [commit],
  );

  return {
    onMoveUp,
    onMoveDown,
    onStepDragStart,
    onStepDragEnd,
    onCardDragOver,
    onCardDrop,
    dragLaneId: drag?.laneId ?? null,
    overIndex: drag?.overIndex ?? null,
  };
}
