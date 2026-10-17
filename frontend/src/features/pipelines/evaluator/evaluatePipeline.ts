// HEL-1581 — the incremental pipeline walk (design Decision 5). Dependency edges are the engine's own:
// `parentStepId` (a parentless step hangs off its root) plus the lane dependency (`laneDependencyOf`:
// the `secondaryInput.stepId` of join/union/lookup). Evaluation follows `executeTree`'s order (children
// visited in descending `position`, a Kahn walk with that rank as the tie-break). A disabled step is
// transparent for every kind. A per-step cache keeps rows (by reference), count, schema and status; an
// edit recomputes only the edited step and its transitive dependents.
//
// Deliberate difference from the engine: `executeTree` fails the whole run at the first failing step or
// lane violation and returns no frames. Here a failing or violating step is an `error`, its dependents
// are `blocked`, and every independent node is still computed, so the preview stays useful while the
// user fixes the step. Save & run reports the server's failure.

import { evaluateStep, type RunContext, type ClientDeclineReason } from "./evaluateStep";
import { laneDependencyOf } from "./steps/combine";
import type { Frame } from "./value";

/** A pipeline step as the walk needs it. */
export interface StepDefinition {
  id: string;
  kind: string;
  parentStepId: string | null;
  /** The root a parentless step hangs off. */
  rootId: string | null;
  position: number;
  enabled: boolean;
  config: unknown;
}

export interface RootFrame {
  rootId: string;
  rows: Frame;
}

export type SourceFrames = Readonly<Record<string, { rows: Frame; complete: boolean }>>;

export type NodeResult =
  | {
      status: "ok";
      rows: Frame;
      count: number;
      schema: readonly string[];
      writesOnSave: boolean;
      listFrame: boolean;
    }
  | {
      status: "disabled";
      rows: Frame;
      count: number;
      schema: readonly string[];
      listFrame: boolean;
    }
  | { status: "error"; message: string }
  | { status: "needsServer"; reason: ClientDeclineReason }
  | { status: "notPreviewed" }
  | { status: "blocked"; blockedBy: string };

export interface WalkResult {
  /** Evaluation order of the steps. */
  order: readonly string[];
  nodes: ReadonlyMap<string, NodeResult>;
}

/** Steps whose Scala output frame is a `List` (`grouped.map(...).toSeq`); every other frame stays the source's Vector. */
const LIST_PRODUCERS = new Set(["aggregate", "groupby", "pivot"]);

/** The ordered column-name union of a frame: row order, then key order within a row, first seen wins. */
export function frameSchema(rows: Frame): string[] {
  const seen = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) seen.add(key);
  return [...seen];
}

const hasFrame = (r: NodeResult | undefined): r is Extract<NodeResult, { rows: Frame }> =>
  r !== undefined && (r.status === "ok" || r.status === "disabled");

/** `structuralRank`: children visited in descending position (ties keep input order), depth first, root by root. */
function structuralRanks(
  steps: readonly StepDefinition[],
  rootIds: readonly string[],
): Map<string, number> {
  const ranks = new Map<string, number>();
  const byParent = new Map<string, StepDefinition[]>();
  const add = (key: string, step: StepDefinition): void => {
    const list = byParent.get(key);
    if (list) list.push(step);
    else byParent.set(key, [step]);
  };
  const rootSet = new Set(rootIds);
  for (const step of steps) {
    if (step.parentStepId !== null) add(`s:${step.parentStepId}`, step);
    else
      add(`r:${step.rootId !== null && rootSet.has(step.rootId) ? step.rootId : rootIds[0]}`, step);
  }
  let counter = 0;
  const visit = (key: string): void => {
    const children = [...(byParent.get(key) ?? [])].sort((a, b) => b.position - a.position);
    for (const child of children) {
      if (ranks.has(child.id)) continue;
      ranks.set(child.id, counter++);
      visit(`s:${child.id}`);
    }
  };
  for (const rootId of rootIds) visit(`r:${rootId}`);
  return ranks;
}

/** Steps whose lane reference the engine rejects (self, dangling, ancestor) or that wait on their own descendant. */
function laneViolations(
  steps: readonly StepDefinition[],
  laneDep: ReadonlyMap<string, string>,
): Set<string> {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const violators = new Set<string>();
  const ancestors = (s: StepDefinition): Set<string> => {
    const out = new Set<string>();
    for (let p = s.parentStepId; p !== null && !out.has(p); p = byId.get(p)?.parentStepId ?? null)
      out.add(p);
    return out;
  };
  for (const s of steps) {
    const dep = laneDep.get(s.id);
    if (dep === undefined) continue;
    if (dep === s.id || !byId.has(dep) || ancestors(s).has(dep)) violators.add(s.id);
  }
  // A lane reference to one's own descendant (directly or through other lane edges) is a cycle.
  const dependsOn = (from: string, target: string, seen = new Set<string>()): boolean => {
    if (from === target) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    const step = byId.get(from);
    if (!step) return false;
    const next: string[] = [];
    if (step.parentStepId !== null) next.push(step.parentStepId);
    const dep = laneDep.get(from);
    if (dep !== undefined && !violators.has(from)) next.push(dep);
    return next.some((n) => dependsOn(n, target, seen));
  };
  for (const s of steps) {
    const dep = laneDep.get(s.id);
    if (dep !== undefined && !violators.has(s.id) && byId.has(dep) && dependsOn(dep, s.id))
      violators.add(s.id);
  }
  return violators;
}

export interface WalkOptions {
  /** Source frames for join/union/lookup source secondaries. */
  sources?: SourceFrames;
  /** The last result; with `editedStepId`, only the edited step and its dependents are recomputed. */
  previous?: WalkResult;
  editedStepId?: string;
}

export function evaluatePipeline(
  steps: readonly StepDefinition[],
  rootFrames: readonly RootFrame[],
  options: WalkOptions = {},
): WalkResult {
  const { sources = {}, previous, editedStepId } = options;
  const rootIds = rootFrames.map((r) => r.rootId);
  const rootRows = new Map(rootFrames.map((r) => [r.rootId, r.rows]));
  const laneDep = new Map<string, string>();
  for (const s of steps) {
    const dep = laneDependencyOf(s.kind, s.config);
    if (dep !== undefined) laneDep.set(s.id, dep);
  }
  const violators = laneViolations(steps, laneDep);
  const ranks = structuralRanks(steps, rootIds);

  const dependents = new Map<string, string[]>();
  const link = (from: string, to: string): void => {
    const list = dependents.get(from);
    if (list) list.push(to);
    else dependents.set(from, [to]);
  };
  for (const s of steps) {
    if (s.parentStepId !== null) link(s.parentStepId, s.id);
    const dep = laneDep.get(s.id);
    if (dep !== undefined && !violators.has(s.id)) link(dep, s.id);
  }

  let recompute: Set<string> | undefined;
  if (previous && editedStepId !== undefined) {
    recompute = new Set<string>();
    const stack = steps
      .filter((s) => s.id === editedStepId || !previous.nodes.has(s.id))
      .map((s) => s.id);
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (recompute.has(id)) continue;
      recompute.add(id);
      stack.push(...(dependents.get(id) ?? []));
    }
  }

  const nodes = new Map<string, NodeResult>();

  const remaining = [...steps].sort(
    (a, b) => (ranks.get(a.id) ?? Infinity) - (ranks.get(b.id) ?? Infinity),
  );
  const order: string[] = [];
  const done = new Set<string>();
  const isReady = (s: StepDefinition): boolean => {
    if (s.parentStepId !== null && !done.has(s.parentStepId)) return false;
    const dep = laneDep.get(s.id);
    return dep === undefined || violators.has(s.id) || done.has(dep);
  };

  const computeNode = (s: StepDefinition): NodeResult => {
    if (violators.has(s.id)) {
      return {
        status: "error",
        message: "lane reference is its own step, a missing step, an ancestor, or a cycle",
      };
    }
    // Inputs: the parent's frame (or the root's) and, for a lane join, the lane step's frame.
    const dep = laneDep.get(s.id);
    const upstreamIds = [
      ...(s.parentStepId !== null ? [s.parentStepId] : []),
      ...(dep !== undefined ? [dep] : []),
    ];
    const unavailable = upstreamIds.filter((id) => !hasFrame(nodes.get(id)));
    if (unavailable.length > 0) {
      const dead = unavailable.find((id) => nodes.get(id)?.status !== "notPreviewed");
      return dead === undefined
        ? { status: "notPreviewed" }
        : { status: "blocked", blockedBy: dead };
    }
    const parentNode = s.parentStepId !== null ? nodes.get(s.parentStepId) : undefined;
    let input: Frame;
    let listFrame = false;
    if (hasFrame(parentNode)) {
      input = parentNode.rows;
      listFrame = parentNode.listFrame;
    } else {
      // A parentless step hangs off its root. executeTree fails the run (an unresolved lane reference) when that
      // root is not among the supplied frames; here the step is an error and its dependents are blocked.
      const root = s.rootId === null ? rootFrames[0]?.rows : rootRows.get(s.rootId);
      if (root === undefined)
        return { status: "error", message: `root '${s.rootId}' has no frame` };
      input = root;
    }
    if (!s.enabled)
      return {
        status: "disabled",
        rows: input,
        count: input.length,
        schema: frameSchema(input),
        listFrame,
      };
    const ctx: RunContext = {
      listFrame,
      lane: (stepId) => {
        const n = nodes.get(stepId);
        return hasFrame(n) ? n.rows : undefined;
      },
      source: (id) => sources[id],
    };
    const outcome = evaluateStep(s, input, ctx);
    if (outcome.status === "ok") {
      return {
        status: "ok",
        rows: outcome.rows,
        count: outcome.rows.length,
        schema: frameSchema(outcome.rows),
        writesOnSave: outcome.writesOnSave,
        listFrame: listFrame || LIST_PRODUCERS.has(s.kind),
      };
    }
    return outcome;
  };

  while (remaining.length > 0) {
    let index = remaining.findIndex(isReady);
    if (index < 0) index = 0;
    const [s] = remaining.splice(index, 1);
    const reuse =
      recompute !== undefined && !recompute.has(s.id) ? previous!.nodes.get(s.id) : undefined;
    nodes.set(s.id, reuse ?? computeNode(s));
    done.add(s.id);
    order.push(s.id);
  }
  return { order, nodes };
}
