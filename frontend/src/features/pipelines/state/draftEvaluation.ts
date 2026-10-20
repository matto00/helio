// draftEvaluation -- HEL-1631 (design.md D3): feeds the HEL-1581 evaluator from the page's steps. `toStepDefinitions` maps
// the UI `Step` to the evaluator's `StepDefinition`; `createIncrementalWalker` runs the walk and reuses the previous result
// ONLY for a single-config edit (the evaluator's `previous` reuse is keyed by `editedStepId` alone, with no identity check,
// so any other kind of change must be a full walk).

import {
  Integral,
  evaluatePipeline,
  frameSchema,
  type Frame,
  type NodeResult,
  type RootFrame,
  type SourceFrames,
  type StepDefinition,
  type WalkResult,
} from "../evaluator";
import type { SchemaField } from "../types/pipelineStep";
import type { Step } from "../types/step";
import { isTempStepId } from "./stepNarrowing";

/** A not-yet-created AI draft (temp id) has no server representation and is never evaluated or saved. */
export function toStepDefinitions(steps: readonly Step[]): StepDefinition[] {
  return steps
    .filter((s) => !isTempStepId(s.id))
    .map((s) => ({
      id: s.id,
      kind: s.opType.id,
      parentStepId: s.parentStepId ?? null,
      rootId: s.rootId ?? null,
      position: s.position ?? 0,
      enabled: s.enabled,
      config: s.config,
    }));
}

const sameShape = (a: StepDefinition, b: StepDefinition): boolean =>
  a.id === b.id &&
  a.kind === b.kind &&
  a.parentStepId === b.parentStepId &&
  a.rootId === b.rootId &&
  a.position === b.position &&
  a.enabled === b.enabled;

/** The id of the one step whose config changed between `previous` and `next`, or `undefined` when the change is anything
 *  else (a different step set, order, flag, or more than one config). */
export function singleEditedStep(
  previous: readonly StepDefinition[],
  next: readonly StepDefinition[],
): string | undefined {
  if (previous.length !== next.length) return undefined;
  let edited: string | undefined;
  for (let i = 0; i < next.length; i += 1) {
    if (!sameShape(previous[i], next[i])) return undefined;
    if (previous[i].config !== next[i].config) {
      if (edited !== undefined) return undefined;
      edited = next[i].id;
    }
  }
  return edited;
}

export interface IncrementalWalker {
  walk: (
    defs: readonly StepDefinition[],
    rootFrames: readonly RootFrame[],
    sources: SourceFrames,
  ) => WalkResult;
}

export function createIncrementalWalker(): IncrementalWalker {
  let last:
    | {
        defs: readonly StepDefinition[];
        rootFrames: readonly RootFrame[];
        sources: SourceFrames;
        result: WalkResult;
      }
    | undefined;
  return {
    walk(defs, rootFrames, sources) {
      const reusable =
        last !== undefined && last.rootFrames === rootFrames && last.sources === sources
          ? singleEditedStep(last.defs, defs)
          : undefined;
      const result =
        reusable !== undefined && last !== undefined
          ? evaluatePipeline(defs, rootFrames, {
              sources,
              previous: last.result,
              editedStepId: reusable,
            })
          : evaluatePipeline(defs, rootFrames, { sources });
      last = { defs, rootFrames, sources, result };
      return result;
    },
  };
}

/** Follows `blocked` links to the node that actually failed to produce a frame. */
export function rootCauseOf(
  nodes: ReadonlyMap<string, NodeResult>,
  stepId: string,
): { stepId: string; node: NodeResult | undefined } {
  const seen = new Set<string>();
  let id = stepId;
  for (;;) {
    const node = nodes.get(id);
    if (node?.status !== "blocked" || seen.has(id)) return { stepId: id, node };
    seen.add(id);
    id = node.blockedBy;
  }
}

/** Steps the client could not evaluate: `needsServer` nodes and everything blocked behind one. */
export function serverResolvedStepIds(walk: WalkResult): Set<string> {
  const out = new Set<string>();
  for (const [id, node] of walk.nodes) {
    if (node.status === "needsServer") out.add(id);
    else if (
      node.status === "blocked" &&
      rootCauseOf(walk.nodes, id).node?.status === "needsServer"
    )
      out.add(id);
  }
  return out;
}

/** The data-source ids that join/union/lookup steps take as their secondary input: the sources the walk needs frames for. */
export function secondarySourceIds(steps: readonly Step[]): string[] {
  const ids = new Set<string>();
  for (const s of steps) {
    const cfg = s.config as { secondaryInput?: { kind?: string; dataSourceId?: string } };
    const si = cfg?.secondaryInput;
    if (si?.kind === "source" && typeof si.dataSourceId === "string" && si.dataSourceId !== "")
      ids.add(si.dataSourceId);
  }
  return [...ids].sort();
}

const columnTypeCache = new WeakMap<Frame, SchemaField[]>();

/** The columns of a frame with a type per column: the type of the first non-null value (the evaluator's own frames carry no
 *  declared schema). `known` types, when given (the saved analyze schema), win for a column they name. */
export function schemaFromFrame(rows: Frame, known: readonly SchemaField[] = []): SchemaField[] {
  let inferred = columnTypeCache.get(rows);
  if (inferred === undefined) {
    inferred = frameSchema(rows).map((name) => {
      let type = "string";
      for (const row of rows) {
        const v = row[name];
        if (v === null || v === undefined) continue;
        if (v instanceof Integral) type = "integer";
        else if (typeof v === "number") type = "float";
        else if (typeof v === "boolean") type = "boolean";
        break;
      }
      return { name, type };
    });
    columnTypeCache.set(rows, inferred);
  }
  if (known.length === 0) return inferred;
  const byName = new Map(known.map((f) => [f.name, f.type]));
  return inferred.map((f) => ({ name: f.name, type: byName.get(f.name) ?? f.type }));
}
