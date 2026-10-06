// HEL-1345 D5 — apply a create response's server-reported delta to the local step list.
//
// A create inserts the created row and changes only (parent_step_id, root_id) of exactly the ids
// in `reparentedStepIds`, so the response is a complete description of the server-side change.
// Applying it resyncs every step the create touched WITHOUT a wholesale replace, so local-only
// drafts, an open card's local config and `renderKey`s all survive. Pure apart from idempotent
// writes to `pendingParent` (the same key/value on a StrictMode double-invoke).

import type { PipelineStep } from "../types/pipelineStep";
import type { Step } from "../types/step";
import { pipelineStepToStep } from "./stepNarrowing";

export interface ApplyCreatedStepOptions {
  /** Set as the created step's `renderKey` when given (a draft passes its temp id). */
  renderKey?: string;
  /** reparent claims the client could not apply yet: reparented id -> the created id that took it. */
  pendingParent: Map<string, string>;
  /** `pendingParent.get(created.id)` read by the caller BEFORE the updater runs (the entry is
   *  deleted outside the updater, keeping the updater idempotent under StrictMode). */
  claimedParent?: string;
  /** temp ids the user removed while their create was in flight. */
  userRemoved: ReadonlySet<string>;
}

/** True when `startId`'s local parent chain reaches `targetId`. A parent id EQUAL to `targetId`
 *  counts even when that step is not present locally (it is the created step's own persisted id). */
function chainReaches(startId: string, targetId: string, byId: Map<string, Step>): boolean {
  const seen = new Set<string>();
  let cur = byId.get(startId);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    const parent = cur.parentStepId;
    if (!parent) return false;
    if (parent === targetId) return true;
    cur = byId.get(parent);
  }
  return false;
}

function serverFields(created: PipelineStep, parentOverride: string | undefined): Step {
  const base = pipelineStepToStep(created);
  return parentOverride === undefined
    ? base
    : { ...base, parentStepId: parentOverride, rootId: undefined };
}

export function applyCreatedStep(
  local: Step[],
  tempId: string,
  created: PipelineStep,
  reparentedStepIds: readonly string[],
  opts: ApplyCreatedStepOptions,
): Step[] {
  const { pendingParent, claimedParent, userRemoved, renderKey } = opts;
  const tempIndex = local.findIndex((s) => s.id === tempId);
  const temp = tempIndex === -1 ? undefined : local[tempIndex];

  // Case 1 — a wholesale sync from another handler already brought the created step in.
  if (local.some((s) => s.id === created.id)) {
    return local
      .filter((s) => s.id !== tempId)
      .map((s) => {
        if (s.id !== created.id) return s;
        let next = s;
        if (temp) next = { ...next, config: temp.config };
        if (renderKey !== undefined) next = { ...next, renderKey: temp?.renderKey ?? renderKey };
        return next;
      });
  }

  // Case 3 — the temp is gone. If the user removed it, the server step is an orphan we leave be.
  if (!temp && userRemoved.has(tempId)) return local;

  const finalKey = temp?.renderKey ?? renderKey;
  const createdStep: Step = {
    ...serverFields(created, claimedParent),
    ...(temp ? { config: temp.config } : {}),
    ...(finalKey !== undefined ? { renderKey: finalKey } : {}),
  };
  const withCreated: Step[] = temp
    ? local.map((s, i) => (i === tempIndex ? createdStep : s))
    : [...local, createdStep];

  const byId = new Map(withCreated.map((s) => [s.id, s] as const));
  const reparentedPresent = new Set<string>();
  for (const r of reparentedStepIds) {
    const target = byId.get(r);
    if (target) {
      // R already below the created step locally => a later commit put it there; keep it.
      if (!chainReaches(r, created.id, byId)) reparentedPresent.add(r);
    } else {
      const existing = pendingParent.get(r);
      const existingStillWins = existing !== undefined && chainReaches(existing, created.id, byId);
      if (!existingStillWins) pendingParent.set(r, created.id);
    }
  }
  if (reparentedPresent.size === 0) return withCreated;
  return withCreated.map((s) =>
    reparentedPresent.has(s.id) ? { ...s, parentStepId: created.id, rootId: undefined } : s,
  );
}
