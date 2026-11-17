// pipelineDraft -- HEL-1631 (design.md D1/D2), extended by HEL-1684: the pure model of the client-only draft on the pipeline detail
// page. The draft is an OVERLAY on the saved steps: an ordered log of structure ops (delete, insert, "+ lane", duplicate, reorder;
// `draftOps.ts`) plus config edits and enabled toggles keyed by a saved id or a client id. The saved steps are never mutated, so
// Discard is "clear the overlay". Everything here is pure and unit-tested; the hooks only hold the state.

import type { Output } from "../types/output";
import type { PipelineStepConfig, PipelineStepKind } from "../types/pipelineStep";
import type { DraftOutput, DraftStep } from "../types/draftSave";
import type { Step } from "../types/step";
import { applyOp, isDraftClientId, replayOps, structureKey } from "./draftOps";
import type { DraftOp } from "./draftOps";

export { deleteStep, removalOf } from "./draftOps";

export interface DraftOverlay {
  version: 2;
  /** Structure ops in the order they were made, replayed over the saved steps. */
  ops: readonly DraftOp[];
  /** stepId or clientId -> the edited config (an entry equal to the step's pre-edit config never exists). */
  configs: Readonly<Record<string, PipelineStepConfig>>;
  /** stepId or clientId -> the toggled flag (an entry equal to the step's pre-toggle flag never exists). */
  enabled: Readonly<Record<string, boolean>>;
}

export const EMPTY_OVERLAY: DraftOverlay = { version: 2, ops: [], configs: {}, enabled: {} };

/** Structural equality over JSON-shaped values (key order ignored). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => jsonEqual(v, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao).filter((k) => ao[k] !== undefined);
  const bk = Object.keys(bo).filter((k) => bo[k] !== undefined);
  return ak.length === bk.length && ak.every((k) => k in bo && jsonEqual(ao[k], bo[k]));
}

export function isOverlayEmpty(overlay: DraftOverlay): boolean {
  return (
    overlay.ops.length === 0 &&
    Object.keys(overlay.configs).length === 0 &&
    Object.keys(overlay.enabled).length === 0
  );
}

/** A draft exists exactly when the draft steps differ from the base (every write canonicalises an overlay that does not). */
export function hasDraft(overlay: DraftOverlay): boolean {
  return !isOverlayEmpty(overlay);
}

/** The overlay replayed over `base`: the draft steps, the ops that did not apply (their ids are gone from `base`), and the
 *  config/enabled entries for steps that no longer exist. `dropped` is what the page reports. */
export function replayOverlay(
  base: readonly Step[],
  overlay: DraftOverlay,
): { steps: Step[]; droppedOps: DraftOp[]; droppedEntries: number; dropped: number } {
  const replayed = replayOps(base, overlay.ops);
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
  const droppedOps = replayed.droppedOps;
  return { steps, droppedOps, droppedEntries, dropped: droppedOps.length + droppedEntries };
}

/** The draft steps: `base` with the overlay applied. */
export function applyOverlay(base: readonly Step[], overlay: DraftOverlay): Step[] {
  if (overlay === EMPTY_OVERLAY || isOverlayEmpty(overlay)) return base as Step[];
  return replayOverlay(base, overlay).steps;
}

/** Drops what no longer changes anything (D2): ops that do not apply, ops that leave the tree as the base has it, and
 *  config/enabled entries set back to the step's pre-edit value or for a step that is gone. A result with nothing left is the
 *  canonical `EMPTY_OVERLAY`, so "a draft exists" is exactly "the draft differs from the saved pipeline". `keepOps` (a stale-restored
 *  draft) leaves every op and entry in place, so "Reload the saved pipeline" can still count each one it drops. */
export function pruneOverlay(
  base: readonly Step[],
  overlay: DraftOverlay,
  keepOps = false,
): DraftOverlay {
  const replayed = replayOps(base, overlay.ops);
  const noStructureChange = !keepOps && structureKey(replayed.steps) === structureKey(base);
  const ops = keepOps ? overlay.ops : noStructureChange ? [] : replayed.keptOps;
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
  const next: DraftOverlay = { version: 2, ops, configs, enabled };
  return isOverlayEmpty(next) ? EMPTY_OVERLAY : next;
}

export function withConfig(
  base: readonly Step[],
  overlay: DraftOverlay,
  stepId: string,
  config: PipelineStepConfig,
  keepOps = false,
): DraftOverlay {
  return pruneOverlay(
    base,
    { ...overlay, configs: { ...overlay.configs, [stepId]: config } },
    keepOps,
  );
}

export function withEnabled(
  base: readonly Step[],
  overlay: DraftOverlay,
  stepId: string,
  enabled: boolean,
  keepOps = false,
): DraftOverlay {
  return pruneOverlay(
    base,
    { ...overlay, enabled: { ...overlay.enabled, [stepId]: enabled } },
    keepOps,
  );
}

/** Appends `op` to the log; an op that does not apply to the current draft is not recorded. */
export function withOp(
  base: readonly Step[],
  overlay: DraftOverlay,
  op: DraftOp,
  keepOps = false,
): DraftOverlay {
  if (applyOp(applyOverlay(base, overlay), op) === null) return overlay;
  return pruneOverlay(base, { ...overlay, ops: [...overlay.ops, op] }, keepOps);
}

export function withDeleted(
  base: readonly Step[],
  overlay: DraftOverlay,
  stepId: string,
  keepOps = false,
): DraftOverlay {
  return withOp(base, overlay, { kind: "delete", stepId }, keepOps);
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
): { overlay: DraftOverlay; dropped: number } {
  const { dropped } = replayOverlay(newBase, overlay);
  return { overlay: pruneOverlay(newBase, overlay), dropped };
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
    } else if (s.rootId != null) step.rootId = s.rootId;
    return step;
  });
}

/** Every Output of the saved definition whose node survives the draft, unchanged. An Output bound to the pipeline root
 *  names its root (`fallbackRootId` when the wire omitted it). */
export function toDraftOutputs(
  outputs: readonly Output[],
  draft: readonly Step[],
  fallbackRootId: string | undefined,
): DraftOutput[] {
  const kept = new Set(draft.map((s) => s.id));
  return outputs
    .filter((o) => o.nodeStepId === undefined || kept.has(o.nodeStepId))
    .map((o) => {
      const out: DraftOutput = { id: o.id, name: o.name, kind: o.kind, config: o.config };
      if (o.nodeStepId !== undefined) out.nodeStepId = o.nodeStepId;
      else {
        const rootId = o.rootId ?? fallbackRootId;
        if (rootId !== undefined) out.rootId = rootId;
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
