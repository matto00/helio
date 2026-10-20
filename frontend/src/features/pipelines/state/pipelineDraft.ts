// pipelineDraft -- HEL-1631 (design.md D1/D2): the pure model of the client-only draft on the pipeline detail page.
// The draft is an OVERLAY on the saved steps: config edits, enabled toggles and step deletes. The saved steps are never
// mutated, so Discard is "clear the overlay". Everything here is pure and unit-tested; the hooks only hold the state.

import type { Output } from "../types/output";
import type { PipelineStepConfig, PipelineStepKind } from "../types/pipelineStep";
import type { DraftOutput, DraftStep } from "../types/draftSave";
import type { Step } from "../types/step";

export interface DraftOverlay {
  /** stepId -> the edited config (an entry equal to the saved config never exists). */
  configs: Readonly<Record<string, PipelineStepConfig>>;
  /** stepId -> the toggled flag (an entry equal to the saved flag never exists). */
  enabled: Readonly<Record<string, boolean>>;
  /** Deleted step ids, in the order they were deleted. */
  deleted: readonly string[];
}

export const EMPTY_OVERLAY: DraftOverlay = { configs: {}, enabled: {}, deleted: [] };

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

/** What the server's `deleteInternal` removes and re-links, computed over the supplied steps (HEL-906 splice-on-delete):
 *  the FIRST child by `(position, id)` is promoted onto the deleted step's own slot; every other child and its whole
 *  subtree goes with it. */
export function removalOf(
  steps: readonly Step[],
  deletedId: string,
): { removed: ReadonlySet<string>; headChildId: string | null } {
  const childrenOf = new Map<string, Step[]>();
  for (const s of steps) {
    if (s.parentStepId == null) continue;
    const list = childrenOf.get(s.parentStepId);
    if (list) list.push(s);
    else childrenOf.set(s.parentStepId, [s]);
  }
  const ordered = (id: string): Step[] =>
    [...(childrenOf.get(id) ?? [])].sort(
      (a, b) => (a.position ?? 0) - (b.position ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  const subtree = (id: string, into: Set<string>): void => {
    into.add(id);
    for (const child of ordered(id)) subtree(child.id, into);
  };
  const children = ordered(deletedId);
  const removed = new Set<string>([deletedId]);
  for (const tail of children.slice(1)) subtree(tail.id, removed);
  return { removed, headChildId: children[0]?.id ?? null };
}

/** The steps after deleting `deletedId` the way the server does; unknown ids are a no-op. */
export function deleteStep(steps: readonly Step[], deletedId: string): Step[] {
  const deleted = steps.find((s) => s.id === deletedId);
  if (!deleted) return [...steps];
  const { removed, headChildId } = removalOf(steps, deletedId);
  return steps
    .filter((s) => !removed.has(s.id))
    .map((s) =>
      s.id === headChildId
        ? {
            ...s,
            parentStepId: deleted.parentStepId,
            rootId: deleted.rootId,
            position: deleted.position,
          }
        : s,
    );
}

/** The draft steps: `base` with the overlay applied (deletes replayed in order, then config and enabled edits). */
export function applyOverlay(base: readonly Step[], overlay: DraftOverlay): Step[] {
  if (overlay === EMPTY_OVERLAY || isOverlayEmpty(overlay)) return base as Step[];
  let steps: Step[] = [...base];
  for (const id of overlay.deleted) steps = deleteStep(steps, id);
  return steps.map((s) => {
    const config = overlay.configs[s.id];
    const enabled = overlay.enabled[s.id];
    if (config === undefined && enabled === undefined) return s;
    return {
      ...s,
      ...(config !== undefined ? { config } : {}),
      ...(enabled !== undefined ? { enabled } : {}),
    };
  });
}

export function isOverlayEmpty(overlay: DraftOverlay): boolean {
  return (
    overlay.deleted.length === 0 &&
    Object.keys(overlay.configs).length === 0 &&
    Object.keys(overlay.enabled).length === 0
  );
}

/** A draft exists exactly when the draft steps differ from the base. */
export function hasDraft(overlay: DraftOverlay): boolean {
  return !isOverlayEmpty(overlay);
}

/** Drops overlay entries that no longer change anything: an edit set back to its saved value, an entry for a step the
 *  base does not have, and entries for steps a delete removed. */
export function pruneOverlay(base: readonly Step[], overlay: DraftOverlay): DraftOverlay {
  const byId = new Map(base.map((s) => [s.id, s]));
  const deleted = overlay.deleted.filter((id) => byId.has(id));
  const gone = new Set<string>();
  let steps: Step[] = [...base];
  for (const id of deleted) {
    const before = new Set(steps.map((s) => s.id));
    steps = deleteStep(steps, id);
    const after = new Set(steps.map((s) => s.id));
    for (const b of before) if (!after.has(b)) gone.add(b);
  }
  const configs: Record<string, PipelineStepConfig> = {};
  for (const [id, config] of Object.entries(overlay.configs)) {
    const saved = byId.get(id);
    if (saved && !gone.has(id) && !jsonEqual(saved.config, config)) configs[id] = config;
  }
  const enabled: Record<string, boolean> = {};
  for (const [id, flag] of Object.entries(overlay.enabled)) {
    const saved = byId.get(id);
    if (saved && !gone.has(id) && saved.enabled !== flag) enabled[id] = flag;
  }
  const next: DraftOverlay = { configs, enabled, deleted };
  return isOverlayEmpty(next) ? EMPTY_OVERLAY : next;
}

export function withConfig(
  base: readonly Step[],
  overlay: DraftOverlay,
  stepId: string,
  config: PipelineStepConfig,
): DraftOverlay {
  return pruneOverlay(base, { ...overlay, configs: { ...overlay.configs, [stepId]: config } });
}

export function withEnabled(
  base: readonly Step[],
  overlay: DraftOverlay,
  stepId: string,
  enabled: boolean,
): DraftOverlay {
  return pruneOverlay(base, { ...overlay, enabled: { ...overlay.enabled, [stepId]: enabled } });
}

export function withDeleted(
  base: readonly Step[],
  overlay: DraftOverlay,
  stepId: string,
): DraftOverlay {
  if (overlay.deleted.includes(stepId)) return overlay;
  return pruneOverlay(base, { ...overlay, deleted: [...overlay.deleted, stepId] });
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

/** Re-bases an overlay onto a newly loaded base (Reload the saved pipeline): entries for steps that still exist are kept,
 *  the rest are dropped; `dropped` counts them. */
export function rebaseOverlay(
  newBase: readonly Step[],
  overlay: DraftOverlay,
): { overlay: DraftOverlay; dropped: number } {
  const ids = new Set(newBase.map((s) => s.id));
  const keys = new Set([
    ...Object.keys(overlay.configs),
    ...Object.keys(overlay.enabled),
    ...overlay.deleted,
  ]);
  let dropped = 0;
  for (const id of keys) if (!ids.has(id)) dropped += 1;
  const next = pruneOverlay(newBase, {
    configs: Object.fromEntries(Object.entries(overlay.configs).filter(([id]) => ids.has(id))),
    enabled: Object.fromEntries(Object.entries(overlay.enabled).filter(([id]) => ids.has(id))),
    deleted: overlay.deleted.filter((id) => ids.has(id)),
  });
  return { overlay: next, dropped };
}

/** The final tree as the draft-save body wants it. `enabled` is ALWAYS an explicit boolean: the server reads a missing
 *  `enabled` as true (DraftDiff), so omitting it would silently re-enable every disabled step. */
export function toDraftSteps(draft: readonly Step[]): DraftStep[] {
  return draft.map((s) => {
    const step: DraftStep = {
      id: s.id,
      type: s.opType.id as PipelineStepKind,
      config: s.config as unknown as Record<string, unknown>,
      enabled: s.enabled === true,
      position: s.position ?? 0,
    };
    if (s.parentStepId != null) step.parentStepId = s.parentStepId;
    else if (s.rootId != null) step.rootId = s.rootId;
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
