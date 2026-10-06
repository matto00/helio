// HEL-1345 D11 — an editor gap insert anchors on a persisted step id, never on an index.
// The gap index the river hands `handleInsertStep` is an index into root 0's primary lane, and
// can count local-only (temp) steps the server does not have; any index also goes stale under
// concurrent inserts. The anchor is resolved once, at click time, and the wire call is built from
// it when the create is actually sent (immediately, or on a draft's config completion).

import type { Step } from "../types/step";
import { buildLaneGraph } from "./stepTree";
import type { LaneGraphRoot } from "./stepTree";
import { isTempStepId } from "./stepNarrowing";

/** Where an insert goes: at the head of the root, or directly after a persisted step. */
export type InsertAnchor = { kind: "head" } | { kind: "after"; stepId: string };

/** The nearest PERSISTED step before the gap in root 0's primary lane, or `head` when none
 *  precedes it. `gapIndex` is the river's gap index (0 = before the first step of that lane). */
export function computeInsertAnchor(
  steps: Step[],
  roots: readonly LaneGraphRoot[],
  gapIndex: number,
): InsertAnchor {
  const rootId = roots[0]?.id;
  const lane = buildLaneGraph(steps, [...roots]).lanes.find(
    (l) => l.rootId === rootId && l.parentStepId === undefined,
  );
  const before = (lane?.steps ?? []).slice(0, Math.max(0, gapIndex));
  for (let i = before.length - 1; i >= 0; i--) {
    if (!isTempStepId(before[i].id)) return { kind: "after", stepId: before[i].id };
  }
  return { kind: "head" };
}

export interface InsertWireArgs {
  position?: number;
  parentStepId?: string;
  rootId?: string;
}

/** The `createPipelineStep` placement arguments for an insert. `anchor === undefined` is the
 *  bottom-row append (`rootId`, no `position`). An anchor step that is no longer present locally
 *  falls back to the same append, so the step is created and visible rather than stuck on a
 *  permanent 422. */
export function insertWireArgs(
  anchor: InsertAnchor | undefined,
  isPresent: (stepId: string) => boolean,
  rootId: string | undefined,
): InsertWireArgs {
  if (anchor === undefined) return { rootId };
  if (anchor.kind === "head") return { position: 0, rootId };
  if (isPresent(anchor.stepId)) return { parentStepId: anchor.stepId };
  return { rootId };
}
