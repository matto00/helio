// HEL-1744 D2 -- which Outputs an insight reads by default: those on the same node as the insight. "Same node" is
// defined once, here.

import type { Output } from "../../types/output";

export interface InsightNodeRef {
  nodeStepId?: string;
  rootId?: string;
}

/** Same node: the same step when the insight is bound to a step; otherwise the same root, with neither Output bound to a
 *  step. Never matches on two absent ids (an unknown root matches nothing). */
export function sameInsightNode(insight: InsightNodeRef, other: InsightNodeRef): boolean {
  if (insight.nodeStepId !== undefined) return other.nodeStepId === insight.nodeStepId;
  if (insight.rootId === undefined) return false;
  return other.nodeStepId === undefined && other.rootId === insight.rootId;
}

/** The ids pre-ticked for an insight at `node`, from the pipeline's candidate Outputs (the caller has already removed the
 *  insight itself, other insights and unsaved Outputs). */
export function defaultInsightReads(node: InsightNodeRef, candidates: readonly Output[]): string[] {
  return candidates.filter((o) => sameInsightNode(node, o)).map((o) => o.id);
}

/** The `rootId` a root-bound insight created at the pipeline root belongs to, when it can be known without a draft: the one
 *  root the pipeline's root-bound Outputs name, else `undefined`. */
export function soleRootId(outputs: readonly Output[]): string | undefined {
  const roots = new Set(outputs.filter((o) => o.nodeStepId === undefined).map((o) => o.rootId));
  roots.delete(undefined);
  return roots.size === 1 ? [...roots][0] : undefined;
}

/** Two id lists name the same set. */
export function sameIdSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return set.size === new Set(b).size && b.every((id) => set.has(id));
}
