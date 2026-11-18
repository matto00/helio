// draftColumnOrder -- HEL-1732 (design.md D3a/D3b): the column order the "Rows after step N" grid shows, computed in the browser from
// data the page already holds (no request). A client-evaluated step shows its frame's own key order (inputs are re-keyed into the
// declared order and the step handlers place columns as the server's analyze does); a frame with sparse rows takes its parent's
// order. A step whose rows came from the draft-preview server (Scala Map hash order) takes its saved analyzed order when nothing it
// depends on changed in the draft, else its nearest client-evaluated ancestor's order. Pure.

import { frameSchema, type Frame } from "../evaluator";
import { renameKeyOrder } from "../evaluator/steps/rowOps";
import { handlerFor } from "../evaluator/steps/registry";
import { laneDependencyOf } from "../evaluator/steps/combine";
import { orderColumns } from "../../panels/state/columnOrder";
import type { PipelineRoot } from "../types/pipelineStep";
import type { Step } from "../types/step";

/**
 * D3a: the order of a client-evaluated frame's columns. When the first row has every column of the frame, the row's own key order
 * stands (after the D1 re-key and the D2 handler fixes it is the projected order). A sparse frame (a row missing some columns) is
 * ordered by `parentOrder` (the parent's displayed order, with this step's renames substituted), then the columns the parent lacks
 * in the frame's first-seen order, so a row without a column never changes where it sits.
 */
export function draftColumnOrder(frame: Frame, parentOrder: () => readonly string[]): string[] {
  if (frame.length === 0) return [];
  const all = frameSchema(frame);
  const first = Object.keys(frame[0]);
  if (first.length === all.length) return first;
  const present = new Set(all);
  const named = parentOrder().filter((n, i, list) => present.has(n) && list.indexOf(n) === i);
  const inNamed = new Set(named);
  return [...named, ...all.filter((n) => !inNamed.has(n))];
}

export interface ColumnOrderInput {
  /** The draft's steps and the pipeline's saved ones. */
  steps: readonly Step[];
  savedSteps: readonly Step[];
  /** The draft's roots and the stored ones (HEL-1734: a draft can add, remove or rebind a root). */
  roots: readonly PipelineRoot[];
  savedRoots: readonly PipelineRoot[];
  /** The rows a step displays (its draft frame, or its last good frame); `undefined` when it shows none. */
  rowsOf: (stepId: string) => Frame | undefined;
  /** A root's sample rows, by pipeline root id (re-keyed to the declared order). */
  rootRowsOf: (rootId: string) => Frame | undefined;
  /** Steps whose rows came from the draft-preview server. */
  serverResolved: ReadonlySet<string>;
  /** A step's output column names in the saved analyze, or `undefined` when it has none. */
  savedOutputNames: (stepId: string) => readonly string[] | undefined;
}

function renamesOf(step: Step): Array<[string, string]> | undefined {
  if (step.opType.id !== "rename") return undefined;
  try {
    return (handlerFor("rename")?.decode(step.config) as { renames: Array<[string, string]> })
      .renames;
  } catch {
    return undefined;
  }
}

/** A step's order, memoized per resolver (one per frames snapshot). `undefined`: the step displays no rows. */
export function createColumnOrderResolver(
  input: ColumnOrderInput,
): (stepId: string) => string[] | undefined {
  const draftById = new Map(input.steps.map((s) => [s.id, s]));
  const savedById = new Map(input.savedSteps.map((s) => [s.id, s]));
  const memo = new Map<string, string[] | undefined>();

  const rootIdOf = (step: Step): string | undefined => step.rootId ?? input.roots[0]?.id;

  const rootOrder = (rootId: string | undefined): string[] => {
    const rows = rootId === undefined ? undefined : input.rootRowsOf(rootId);
    return rows === undefined ? [] : draftColumnOrder(rows, () => []);
  };

  /** The order a step's PARENT shows: its parent step's, or its root's. */
  const parentOrderOf = (step: Step): string[] => {
    if (step.parentStepId != null) return orderOf(step.parentStepId) ?? [];
    return rootOrder(rootIdOf(step));
  };

  /** D3b rule 2: the nearest ancestor that is not server-resolved (or the root). */
  const clientAncestorOrder = (step: Step): string[] => {
    const seen = new Set<string>();
    let cur: Step | undefined = step;
    while (cur !== undefined && !seen.has(cur.id)) {
      seen.add(cur.id);
      if (cur.parentStepId == null) return rootOrder(rootIdOf(cur));
      const parent: Step | undefined = draftById.get(cur.parentStepId);
      if (parent === undefined) return [];
      if (!input.serverResolved.has(parent.id)) return orderOf(parent.id) ?? [];
      cur = parent;
    }
    return [];
  };

  const sameStep = (a: Step, b: Step): boolean =>
    a.opType.id === b.opType.id &&
    a.enabled === b.enabled &&
    (a.position ?? 0) === (b.position ?? 0) &&
    (a.parentStepId ?? null) === (b.parentStepId ?? null) &&
    (a.rootId ?? null) === (b.rootId ?? null) &&
    JSON.stringify(a.config) === JSON.stringify(b.config);

  /** D3b rule 1's condition: nothing the step reads differs from the saved pipeline. */
  const lineageUnchanged = (stepId: string): boolean => {
    const stack = [stepId];
    const seen = new Set<string>();
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const draft = draftById.get(id);
      const saved = savedById.get(id);
      if (draft === undefined || saved === undefined || !sameStep(draft, saved)) return false;
      if (draft.parentStepId != null) stack.push(draft.parentStepId);
      else {
        const rootId = rootIdOf(draft);
        const draftRoot = input.roots.find((r) => r.id === rootId);
        const savedRoot = input.savedRoots.find((r) => r.id === rootId);
        if (
          draftRoot === undefined ||
          savedRoot === undefined ||
          draftRoot.dataSourceId !== savedRoot.dataSourceId
        )
          return false;
      }
      const lane = laneDependencyOf(draft.opType.id, draft.config);
      if (lane !== undefined) stack.push(lane);
    }
    return true;
  };

  function orderOf(stepId: string): string[] | undefined {
    if (memo.has(stepId)) return memo.get(stepId);
    memo.set(stepId, undefined); // a cycle resolves to "none" rather than recursing
    const step = draftById.get(stepId);
    const rows = input.rowsOf(stepId);
    let order: string[] | undefined;
    if (step !== undefined && rows !== undefined) {
      if (input.serverResolved.has(stepId)) {
        const saved = lineageUnchanged(stepId) ? input.savedOutputNames(stepId) : undefined;
        const names = saved !== undefined && saved.length > 0 ? saved : clientAncestorOrder(step);
        order = orderColumns(frameSchema(rows), names);
      } else {
        const renames = renamesOf(step);
        order = draftColumnOrder(rows, () => {
          const parent = parentOrderOf(step);
          return renames === undefined ? parent : renameKeyOrder(parent, renames);
        });
      }
    }
    memo.set(stepId, order);
    return order;
  }

  return orderOf;
}
