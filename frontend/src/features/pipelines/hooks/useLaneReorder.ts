// useLaneReorder — HEL-1007. Lane-scoped Move up/down + drag-reorder for EVERY root's trunk lane
// (HEL-968 wired it for root 0 only). One handler set, keyed by step id: each handler locates the
// step's own trunk lane in the current `LaneGraph` rather than closing over "the first root", so the
// same stable callbacks serve every lane (F-146). Branch (non-trunk) lanes are never reordered here: the
// reorder endpoint permutes trunk ids only, a tail travels with its trunk step. Focus after a move is
// the spine's concern (`useSpineStepActions`), not this hook's.

import { useCallback, useEffect, useRef, useState } from "react";
import type { DragEvent } from "react";

import type { Step } from "../types/step";
import type { LaneGraph } from "../state/stepTree";
import { reorderLane } from "../state/stepTree";

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

  const commit = useCallback(
    (lane: { id: string }, from: number, to: number) => {
      void onReorderSteps(reorderLane(laneGraphRef.current, lane.id, from, to));
    },
    [onReorderSteps],
  );

  const onMoveUp = useCallback(
    (stepId: string) => {
      const lane = trunkLaneOfStep(laneGraphRef.current, stepId);
      if (!lane) return;
      const index = lane.steps.findIndex((s) => s.id === stepId);
      if (index <= 0) return;
      commit(lane, index, index - 1);
    },
    [commit],
  );

  const onMoveDown = useCallback(
    (stepId: string) => {
      const lane = trunkLaneOfStep(laneGraphRef.current, stepId);
      if (!lane) return;
      const index = lane.steps.findIndex((s) => s.id === stepId);
      if (index === -1 || index >= lane.steps.length - 1) return;
      commit(lane, index, index + 1);
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
      commit({ id: laneId }, index, target);
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
