// draftRoots -- HEL-1734 (design.md D9): the roots (sources) of a pipeline draft. `rootAdd` / `rootRemove` ride the same op log as the
// step ops; this module replays them over the saved roots, judges them (a root op that names a root that is not there, or that
// would leave the pipeline with none, does not apply), and says which draft root ids a request names. Pure.

import type { PipelineRoot } from "../types/pipelineStep";
import { isDraftClientId, isRootOp, rootNamedBy } from "./draftOps";
import type { DraftOp } from "./draftOps";

export interface RootReplay {
  /** The roots as the draft shows them, in order: the saved ones minus the removed, then the added, in the order they were made. */
  roots: PipelineRoot[];
  /** Root ops that did not apply (the root is gone, or removing it would leave no root), and ops naming a root removed earlier. */
  droppedOps: DraftOp[];
}

/** The roots after `ops`, judged one by one against the roots as they are at that point. */
export function replayRoots(base: readonly PipelineRoot[], ops: readonly DraftOp[]): RootReplay {
  let roots: PipelineRoot[] = [...base];
  const droppedOps: DraftOp[] = [];
  const removed = new Set<string>();
  for (const op of ops) {
    if (op.kind === "rootAdd") {
      if (roots.some((r) => r.id === op.clientId)) droppedOps.push(op);
      else
        roots = [
          ...roots,
          { id: op.clientId, dataSourceId: op.sourceId, dataSourceName: op.dataSourceName },
        ];
    } else if (op.kind === "rootRemove") {
      if (roots.length <= 1 || !roots.some((r) => r.id === op.rootId)) droppedOps.push(op);
      else {
        roots = roots.filter((r) => r.id !== op.rootId);
        removed.add(op.rootId);
      }
    } else {
      const named = rootNamedBy(op);
      if (named !== undefined && removed.has(named)) droppedOps.push(op);
    }
  }
  return { roots, droppedOps };
}

/** True when the draft adds or removes a root. */
export function hasRootChange(ops: readonly DraftOp[]): boolean {
  return ops.some(isRootOp);
}

/** The ops of a draft root that is being removed again: the add itself, and everything made on it (a step inserted at its head,
 *  a lane under such a step, an Output on either). Removing a root the draft added leaves no trace of it in the log. */
export function opsTiedToDraftRoot(ops: readonly DraftOp[], rootId: string): ReadonlySet<DraftOp> {
  const tiedIds = new Set<string>([rootId]);
  const tied = new Set<DraftOp>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const op of ops) {
      if (tied.has(op)) continue;
      if (opIsTied(op, tiedIds)) {
        tied.add(op);
        const created = createdIdOf(op);
        if (created !== undefined && !tiedIds.has(created)) tiedIds.add(created);
        grew = true;
      }
    }
  }
  return tied;
}

function createdIdOf(op: DraftOp): string | undefined {
  return op.kind === "insert" ||
    op.kind === "lane" ||
    op.kind === "duplicate" ||
    op.kind === "outputCreate" ||
    op.kind === "rootAdd"
    ? op.clientId
    : undefined;
}

function opIsTied(op: DraftOp, ids: ReadonlySet<string>): boolean {
  switch (op.kind) {
    case "rootAdd":
      return ids.has(op.clientId);
    case "rootRemove":
      return ids.has(op.rootId);
    case "insert": {
      const anchor = op.anchor;
      const at = "after" in anchor ? anchor.after : "head" in anchor ? anchor.head : anchor.append;
      return ids.has(at);
    }
    case "lane":
      return ids.has(op.parent);
    case "duplicate":
      return ids.has(op.of);
    case "delete":
      return ids.has(op.stepId);
    case "reorder":
      return ids.has(op.rootId);
    case "outputCreate":
      return ids.has("step" in op.node ? op.node.step : op.node.root);
    case "outputDelete":
      return ids.has(op.outputId);
  }
}

/** The save body's `roots`: the final roots in order, a saved one by `id`, a draft one by `clientId` with its source. Absent
 *  (`undefined`) when the draft changes no root, so a draft without root ops sends exactly what it sent before. */
export function toDraftRoots(
  ops: readonly DraftOp[],
  finalRoots: readonly PipelineRoot[],
): { id?: string; clientId?: string; sourceId?: string }[] | undefined {
  if (!hasRootChange(ops)) return undefined;
  return finalRoots.map((r) =>
    isDraftClientId(r.id) ? { clientId: r.id, sourceId: r.dataSourceId } : { id: r.id },
  );
}
