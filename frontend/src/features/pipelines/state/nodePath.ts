// nodePath — HEL-968 task 5.1 (design.md Decision 3). Renders the runtime
// graph path pinned by HEL-913's archived design.md R5: the ordered list of
// ids from a step's originating root to the step itself, joined by " > ",
// with the root rendered as `root:<rootId>`, e.g. `root:r_7a2f > s1 > s4`.
//
// This supersedes HEL-911's engine-contract item 11 (the stale single-root
// bare-`root` head, e.g. `root > s1 > s4`) -- multi-root makes a bare `root`
// ambiguous. One exported pure function, used everywhere a path is shown,
// is what makes "not the single-root form" checkable by a grep for the
// stale format returning zero (AC3), rather than trusting every display
// site's own inline template string to agree.
//
// Traverses the SAME two edge kinds `laneLayout.ts` already unions --
// `parentStepId` and a rejoin's `{kind:"lane"}` `secondaryInput` -- so a
// rejoin's path is reachable at all. A node reachable from several roots
// (a rejoin consuming lanes from two roots) resolves through the
// LOWEST-POSITIONED originating root (R5's canonical tiebreak, R3's
// ordering applied to the same purpose), which is deterministic because
// `roots` is passed in `position` order.

import { secondaryInputOf } from "./laneLayout";
import type { Step } from "../types/step";
import type { LaneGraphRoot } from "./stepTree";

function predecessorsOf(step: Step, byId: Map<string, Step>): string[] {
  const preds: string[] = [];
  if (step.parentStepId && byId.has(step.parentStepId)) preds.push(step.parentStepId);
  const secondary = secondaryInputOf(step.config);
  if (secondary?.kind === "lane" && byId.has(secondary.stepId)) preds.push(secondary.stepId);
  return preds;
}

/** Every path from a root to `currentId` INCLUSIVE (root-to-leaf order,
 *  root's own id excluded -- callers prefix `root:<rootId>` separately),
 *  keyed by the originating root's id. A node reachable via more than one
 *  chain to the SAME root keeps the shortest, deterministic one. */
function pathsFromRoots(
  currentId: string,
  byId: Map<string, Step>,
  rootStepIds: Set<string>,
  visiting: Set<string>,
): Map<string, string[]> {
  if (visiting.has(currentId)) return new Map(); // cycle guard on malformed data
  const step = byId.get(currentId);
  if (!step) return new Map();

  if (rootStepIds.has(currentId) && step.rootId) {
    return new Map([[step.rootId, [currentId]]]);
  }

  const nextVisiting = new Set(visiting);
  nextVisiting.add(currentId);
  const result = new Map<string, string[]>();
  for (const pred of predecessorsOf(step, byId)) {
    const predPaths = pathsFromRoots(pred, byId, rootStepIds, nextVisiting);
    for (const [rootId, predPath] of predPaths) {
      const candidate = [...predPath, currentId];
      const existing = result.get(rootId);
      if (!existing || candidate.length < existing.length) {
        result.set(rootId, candidate);
      }
    }
  }
  return result;
}

/** The R5 runtime graph path for `stepId`: `root:<rootId> > s1 > s4 > s7`.
 *  Ids only -- callers substitute display names at render time (R5). Falls
 *  back to the bare step id if `stepId` isn't found or has no resolvable
 *  root (malformed/local data), rather than throwing. */
export function nodePath(stepId: string, steps: Step[], roots: LaneGraphRoot[]): string {
  const byId = new Map(steps.map((s) => [s.id, s] as const));
  const rootStepIds = new Set(steps.filter((s) => !s.parentStepId).map((s) => s.id));
  const positionOfRoot = new Map(roots.map((r, i) => [r.id, i] as const));

  const pathsByRootId = pathsFromRoots(stepId, byId, rootStepIds, new Set());
  if (pathsByRootId.size === 0) return stepId; // unresolvable/malformed data

  // R5's canonical tiebreak: the lowest-positioned originating root.
  let bestRootId: string | undefined;
  let bestPosition = Number.POSITIVE_INFINITY;
  for (const rootId of pathsByRootId.keys()) {
    const position = positionOfRoot.get(rootId) ?? Number.POSITIVE_INFINITY;
    if (position < bestPosition) {
      bestPosition = position;
      bestRootId = rootId;
    }
  }
  if (!bestRootId) return stepId;

  const trail = pathsByRootId.get(bestRootId) ?? [];
  return [`root:${bestRootId}`, ...trail].join(" > ");
}
