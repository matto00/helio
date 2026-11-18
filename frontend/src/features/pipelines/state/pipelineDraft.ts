// pipelineDraft -- HEL-1631 (design.md D1/D2), extended by HEL-1684: the pure model of the client-only draft on the pipeline detail
// page. The draft is an OVERLAY on the saved steps: an ordered log of structure ops (delete, insert, "+ lane", duplicate, reorder;
// `draftOps.ts`) plus config edits and enabled toggles keyed by a saved id or a client id. The saved steps are never mutated, so
// Discard is "clear the overlay". Everything here is pure and unit-tested; the hooks only hold the state.

import type { Output } from "../types/output";
import type { PipelineRoot, PipelineStepConfig, PipelineStepKind } from "../types/pipelineStep";
import type { DraftOutput, DraftStep } from "../types/draftSave";
import type { Step } from "../types/step";
import { applyOp, isDraftClientId, isOutputOp, isRootOp, structureKey } from "./draftOps";
import type { DraftOp } from "./draftOps";
import { jsonEqual } from "./jsonEqual";
import { applyOutputEdits, pruneOutputOps, replayInterleaved } from "./draftOutputs";
import { opsTiedToDraftRoot, replayRoots } from "./draftRoots";
import type { OutputEdit, OutputEdits } from "./draftOutputs";

export { deleteStep, removalOf } from "./draftOps";

export interface DraftOverlay {
  version: 4;
  /** Structure ops in the order they were made, replayed over the saved steps. */
  ops: readonly DraftOp[];
  /** stepId or clientId -> the edited config (an entry equal to the step's pre-edit config never exists). */
  configs: Readonly<Record<string, PipelineStepConfig>>;
  /** stepId or clientId -> the toggled flag (an entry equal to the step's pre-toggle flag never exists). */
  enabled: Readonly<Record<string, boolean>>;
  /** HEL-1733: outputId or clientId -> the WHOLE resulting name and config of an edited Output (D4). */
  outputEdits: OutputEdits;
}

export const EMPTY_OVERLAY: DraftOverlay = {
  version: 4,
  ops: [],
  configs: {},
  enabled: {},
  outputEdits: {},
};

export { jsonEqual };

export function isOverlayEmpty(overlay: DraftOverlay): boolean {
  return (
    overlay.ops.length === 0 &&
    Object.keys(overlay.configs).length === 0 &&
    Object.keys(overlay.enabled).length === 0 &&
    Object.keys(overlay.outputEdits).length === 0
  );
}

/** True when the overlay holds any Output op or Output edit (HEL-1733). */
export function overlayHasOutputChange(overlay: DraftOverlay): boolean {
  return overlay.ops.some(isOutputOp) || Object.keys(overlay.outputEdits).length > 0;
}

/** A draft exists exactly when the draft steps differ from the base (every write canonicalises an overlay that does not). */
export function hasDraft(overlay: DraftOverlay): boolean {
  return !isOverlayEmpty(overlay);
}

/** The overlay replayed over `base` (and `baseOutputs`, `null` while the page's Outputs are not loaded: Output ops and edits are then
 *  carried through untouched and never counted): the draft steps and Outputs, the ops that did not apply (their ids are gone from
 *  the base), and the config/enabled/Output-edit entries for things that no longer exist. `dropped` is what the page reports. */
export function replayOverlay(
  base: readonly Step[],
  overlay: DraftOverlay,
  baseOutputs: readonly Output[] | null = null,
): {
  steps: Step[];
  outputs: Output[] | null;
  droppedOps: DraftOp[];
  droppedEntries: number;
  dropped: number;
} {
  const replayed = replayInterleaved(base, baseOutputs, overlay.ops);
  const ids = new Set(replayed.steps.map((s) => s.id));
  const entryIds = new Set([...Object.keys(overlay.configs), ...Object.keys(overlay.enabled)]);
  let droppedEntries = 0;
  for (const id of entryIds) if (!ids.has(id)) droppedEntries += 1;
  const steps = replayed.steps.map((s) => {
    const config = overlay.configs[s.id];
    const enabled = overlay.enabled[s.id];
    if (config === undefined && enabled === undefined) return s;
    return {
      ...s,
      ...(config !== undefined ? { config } : {}),
      ...(enabled !== undefined ? { enabled } : {}),
    };
  });
  let outputs: Output[] | null = replayed.outputs;
  if (outputs !== null) {
    const edited = applyOutputEdits(outputs, overlay.outputEdits, {
      cascaded: replayed.cascadedOutputIds,
      deleted: replayed.deletedOutputIds,
    });
    outputs = edited.outputs;
    droppedEntries += edited.dropped;
  }
  const droppedOps = replayed.droppedOps;
  return {
    steps,
    outputs,
    droppedOps,
    droppedEntries,
    dropped: droppedOps.length + droppedEntries,
  };
}

/** The draft steps: `base` with the overlay applied. */
export function applyOverlay(base: readonly Step[], overlay: DraftOverlay): Step[] {
  if (overlay === EMPTY_OVERLAY || isOverlayEmpty(overlay)) return base as Step[];
  return replayOverlay(base, overlay).steps;
}

/** Drops what no longer changes anything (D2): ops that do not apply, ops that leave the tree as the base has it, and
 *  config/enabled entries set back to the step's pre-edit value or for a step that is gone. A result with nothing left is the
 *  canonical `EMPTY_OVERLAY`, so "a draft exists" is exactly "the draft differs from the saved pipeline". `keepOps` (a stale-restored
 *  draft) leaves every op and entry in place, so "Reload the saved pipeline" can still count each one it drops. The structure reset
 *  drops STEP ops only; Output ops and edits are pruned by their own rules, and only once the base Outputs are loaded (`baseOutputs`
 *  not `null`): create-then-delete leaves nothing, an Output a step delete took is forgotten, an edit set back is dropped. */
export function pruneOverlay(
  base: readonly Step[],
  overlay: DraftOverlay,
  keepOps = false,
  baseOutputs: readonly Output[] | null = null,
): DraftOverlay {
  const replayed = replayInterleaved(base, baseOutputs, overlay.ops);
  const noStructureChange = !keepOps && structureKey(replayed.steps) === structureKey(base);
  let ops: readonly DraftOp[] = keepOps
    ? overlay.ops
    : noStructureChange
      ? replayed.keptOps.filter((op) => isOutputOp(op) || isRootOp(op))
      : replayed.keptOps;
  const steps = noStructureChange ? [...base] : replayed.steps;
  const byId = new Map(steps.map((s) => [s.id, s]));
  const configs: Record<string, PipelineStepConfig> = {};
  for (const [id, config] of Object.entries(overlay.configs)) {
    const step = byId.get(id);
    if ((step || keepOps) && !(step && jsonEqual(step.config, config))) configs[id] = config;
  }
  const enabled: Record<string, boolean> = {};
  for (const [id, flag] of Object.entries(overlay.enabled)) {
    const step = byId.get(id);
    if ((step || keepOps) && !(step && step.enabled === flag)) enabled[id] = flag;
  }
  let outputEdits: OutputEdits = overlay.outputEdits;
  if (!keepOps && baseOutputs !== null && replayed.outputs !== null) {
    const pruned = pruneOutputOps(ops, overlay.outputEdits, replayed, baseOutputs);
    ops = pruned.ops;
    outputEdits = pruned.outputEdits;
  }
  const next: DraftOverlay = { version: 4, ops, configs, enabled, outputEdits };
  return isOverlayEmpty(next) ? EMPTY_OVERLAY : next;
}

export function withConfig(
  base: readonly Step[],
  overlay: DraftOverlay,
  stepId: string,
  config: PipelineStepConfig,
  keepOps = false,
  baseOutputs: readonly Output[] | null = null,
): DraftOverlay {
  return pruneOverlay(
    base,
    { ...overlay, configs: { ...overlay.configs, [stepId]: config } },
    keepOps,
    baseOutputs,
  );
}

export function withEnabled(
  base: readonly Step[],
  overlay: DraftOverlay,
  stepId: string,
  enabled: boolean,
  keepOps = false,
  baseOutputs: readonly Output[] | null = null,
): DraftOverlay {
  return pruneOverlay(
    base,
    { ...overlay, enabled: { ...overlay.enabled, [stepId]: enabled } },
    keepOps,
    baseOutputs,
  );
}

/** Appends `op` to the log; an op that does not apply to the current draft is not recorded. */
export function withOp(
  base: readonly Step[],
  overlay: DraftOverlay,
  op: DraftOp,
  keepOps = false,
  baseOutputs: readonly Output[] | null = null,
): DraftOverlay {
  if (applyOp(applyOverlay(base, overlay), op) === null) return overlay;
  return pruneOverlay(base, { ...overlay, ops: [...overlay.ops, op] }, keepOps, baseOutputs);
}

/** Appends several ops in ONE update (a shape is never half in the draft); each must apply to the steps the previous ones made. */
export function withOps(
  base: readonly Step[],
  overlay: DraftOverlay,
  ops: readonly DraftOp[],
  keepOps = false,
  baseOutputs: readonly Output[] | null = null,
): DraftOverlay {
  let steps = applyOverlay(base, overlay);
  for (const op of ops) {
    const next = applyOp(steps, op);
    if (next === null) return overlay;
    steps = next;
  }
  return pruneOverlay(base, { ...overlay, ops: [...overlay.ops, ...ops] }, keepOps, baseOutputs);
}

/** Records the WHOLE resulting name/config of an Output (a saved id or a client id). */
export function withOutputEdit(
  base: readonly Step[],
  overlay: DraftOverlay,
  outputId: string,
  edit: OutputEdit,
  keepOps = false,
  baseOutputs: readonly Output[] | null = null,
): DraftOverlay {
  return pruneOverlay(
    base,
    { ...overlay, outputEdits: { ...overlay.outputEdits, [outputId]: edit } },
    keepOps,
    baseOutputs,
  );
}

export function withDeleted(
  base: readonly Step[],
  overlay: DraftOverlay,
  stepId: string,
  keepOps = false,
  baseOutputs: readonly Output[] | null = null,
): DraftOverlay {
  return withOp(base, overlay, { kind: "delete", stepId }, keepOps, baseOutputs);
}

/** HEL-1734: adds a source to the draft as a new last root; returns the overlay and the draft root's client id. */
export function withRootAdd(
  base: readonly Step[],
  overlay: DraftOverlay,
  op: Extract<DraftOp, { kind: "rootAdd" }>,
  keepOps = false,
  baseOutputs: readonly Output[] | null = null,
): DraftOverlay {
  return withOp(base, overlay, op, keepOps, baseOutputs);
}

/** HEL-1734: removes a root from the draft. A root the draft itself added leaves no trace (its add and everything made on it go);
 *  a saved root is recorded as a `rootRemove`, which replays as the server's cascade over its steps and Outputs. */
export function withRootRemove(
  base: readonly Step[],
  overlay: DraftOverlay,
  rootId: string,
  keepOps = false,
  baseOutputs: readonly Output[] | null = null,
): DraftOverlay {
  if (isDraftClientId(rootId)) {
    const tied = opsTiedToDraftRoot(overlay.ops, rootId);
    return pruneOverlay(
      base,
      { ...overlay, ops: overlay.ops.filter((op) => !tied.has(op)) },
      keepOps,
      baseOutputs,
    );
  }
  return withOp(base, overlay, { kind: "rootRemove", rootId }, keepOps, baseOutputs);
}

/** Step ids the draft removes (the deleted steps plus the tails a branch-point delete takes with it). */
export function removedStepIds(base: readonly Step[], draft: readonly Step[]): string[] {
  const kept = new Set(draft.map((s) => s.id));
  return base.filter((s) => !kept.has(s.id)).map((s) => s.id);
}

/** Outputs bound to a step the draft removes: they go with it (the save leaves them out). */
export function outputsOnRemovedSteps(
  outputs: readonly Output[],
  removedIds: readonly string[],
): Output[] {
  const removed = new Set(removedIds);
  return outputs.filter((o) => o.nodeStepId !== undefined && removed.has(o.nodeStepId));
}

/** Re-bases an overlay onto a newly loaded base (Reload the saved pipeline): every op whose ids still exist is kept (a dropped op
 *  drops every later op that names its client id), the rest are dropped; `dropped` counts ops plus entries. */
export function rebaseOverlay(
  newBase: readonly Step[],
  overlay: DraftOverlay,
  newBaseOutputs: readonly Output[] | null = null,
  newBaseRoots: readonly PipelineRoot[] | null = null,
): { overlay: DraftOverlay; dropped: number } {
  const replayed = replayOverlay(newBase, overlay, newBaseOutputs);
  // HEL-1734: a root op the new saved roots cannot take (its root is gone, or it would leave none) is dropped and counted.
  const rootDropped =
    newBaseRoots === null ? [] : replayRoots(newBaseRoots, overlay.ops).droppedOps;
  const withoutDroppedRootOps: DraftOverlay =
    rootDropped.length === 0
      ? overlay
      : { ...overlay, ops: overlay.ops.filter((op) => !rootDropped.includes(op)) };
  return {
    overlay: pruneOverlay(newBase, withoutDroppedRootOps, false, newBaseOutputs),
    dropped:
      replayed.dropped + rootDropped.filter((op) => !replayed.droppedOps.includes(op)).length,
  };
}

/** The final tree as the draft-save body wants it. `enabled` is ALWAYS an explicit boolean: the server reads a missing
 *  `enabled` as true (DraftDiff), so omitting it would silently re-enable every disabled step. */
export function toDraftSteps(draft: readonly Step[]): DraftStep[] {
  return draft.map((s) => {
    const step: DraftStep = {
      type: s.opType.id as PipelineStepKind,
      config: s.config as unknown as Record<string, unknown>,
      enabled: s.enabled === true,
      position: s.position ?? 0,
    };
    if (isDraftClientId(s.id)) step.clientId = s.id;
    else step.id = s.id;
    if (s.parentStepId != null) {
      if (isDraftClientId(s.parentStepId)) step.parentClientId = s.parentStepId;
      else step.parentStepId = s.parentStepId;
    } else if (s.rootId != null) {
      // HEL-1734: a root the draft added is named by its client id.
      if (isDraftClientId(s.rootId)) step.rootClientId = s.rootId;
      else step.rootId = s.rootId;
    }
    return step;
  });
}

/** The Outputs of the final tree (the saved ones, edited or not, and those the draft created); an Output whose node the draft
 *  removed is left out. A saved Output names its node by id (`fallbackRootId` when the wire omitted a root); a created one carries
 *  a `clientId`, and names a step the draft created by `nodeStepClientId`. */
export function toDraftOutputs(
  outputs: readonly Output[],
  draft: readonly Step[],
  fallbackRootId: string | undefined,
): DraftOutput[] {
  const kept = new Set(draft.map((s) => s.id));
  return outputs
    .filter((o) => o.nodeStepId === undefined || kept.has(o.nodeStepId))
    .map((o) => {
      const created = isDraftClientId(o.id);
      const out: DraftOutput = created
        ? { clientId: o.id, name: o.name, kind: o.kind, config: o.config }
        : { id: o.id, name: o.name, kind: o.kind, config: o.config };
      if (o.nodeStepId !== undefined) {
        if (isDraftClientId(o.nodeStepId)) out.nodeStepClientId = o.nodeStepId;
        else out.nodeStepId = o.nodeStepId;
      } else {
        const rootId = o.rootId ?? fallbackRootId;
        if (rootId !== undefined) {
          if (isDraftClientId(rootId)) out.rootClientId = rootId;
          else out.rootId = rootId;
        }
      }
      return out;
    });
}

/** Sorted-key JSON, so two configs that differ only in key order compare equal. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** The comparison shape of a step for "is the saved definition still what this draft started from" (D9 step 1). */
export function normalizeStepForCompare(s: Step): string {
  return stableJson({
    id: s.id,
    type: s.opType.id,
    config: s.config,
    enabled: s.enabled,
    parentStepId: s.parentStepId ?? null,
    rootId: s.rootId ?? null,
    position: s.position ?? 0,
  });
}

export function normalizeOutputForCompare(o: Output): string {
  return stableJson({
    id: o.id,
    name: o.name,
    kind: o.kind,
    nodeStepId: o.nodeStepId ?? null,
    rootId: o.rootId ?? null,
    config: o.config,
  });
}

const sortedSet = (items: string[]): string[] => [...items].sort();

/** A signature of the saved steps a draft is made against (kept with a kept draft; Outputs are not part of it). */
export function baseSignature(steps: readonly Step[]): string {
  return sortedSet(steps.map(normalizeStepForCompare)).join("|");
}

/** A signature of the saved Outputs a draft is made against (kept with a kept draft as `outputsBase`; HEL-1733 D11). */
export function outputsSignature(outputs: readonly Output[]): string {
  return sortedSet(outputs.map(normalizeOutputForCompare)).join("|");
}

/** True when the freshly read definition is the one the page's base shows. `baseOutputs` is `null` while the page has
 *  not loaded its Outputs: those are then not compared (an unloaded list is not evidence of a change). */
export function definitionMatchesBase(
  definition: { steps: readonly Step[]; outputs: readonly Output[] },
  baseSteps: readonly Step[],
  baseOutputs: readonly Output[] | null,
): boolean {
  const a = sortedSet(definition.steps.map(normalizeStepForCompare));
  const b = sortedSet(baseSteps.map(normalizeStepForCompare));
  if (a.length !== b.length || a.some((v, i) => v !== b[i])) return false;
  if (baseOutputs === null) return true;
  const oa = sortedSet(definition.outputs.map(normalizeOutputForCompare));
  const ob = sortedSet(baseOutputs.map(normalizeOutputForCompare));
  return oa.length === ob.length && oa.every((v, i) => v === ob[i]);
}
