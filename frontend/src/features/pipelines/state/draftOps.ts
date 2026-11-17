// draftOps -- HEL-1684 (design.md D1/D1a): the ops a pipeline draft records and the pure functions that replay them over `Step[]`.
// Each applier mirrors the server primitive the same action calls without a draft, so the draft shows the tree Save & run will
// store. A replay validates every op against the steps it is applied to and refuses (returns `null`) one whose ids are gone.

import type { PipelineStepConfig } from "../types/pipelineStep";
import type { Step } from "../types/step";
import { OP_TYPES, isTempStepId, unsupportedOpType } from "./stepNarrowing";

/** Where an insert goes: right after a step, at the head of a root, or at the end of a root's trunk. */
export type DraftAnchor = { after: string } | { head: string } | { append: string };

export type DraftOp =
  | { kind: "delete"; stepId: string }
  | {
      kind: "insert";
      clientId: string;
      type: string;
      config: PipelineStepConfig;
      anchor: DraftAnchor;
    }
  | { kind: "lane"; clientId: string; type: string; config: PipelineStepConfig; parent: string }
  | {
      kind: "duplicate";
      clientId: string;
      of: string;
      type: string;
      config: PipelineStepConfig;
      enabled: boolean;
    }
  | { kind: "reorder"; rootId: string; trunk: string[] };

const CLIENT_ID_PREFIX = "draft-";

/** A step the draft created and the server has not: its id is a client id, never a server id or a temp (`step-N`) id. */
export function isDraftClientId(id: string): boolean {
  return id.startsWith(CLIENT_ID_PREFIX);
}

/** At most 64 characters (the draft-preview id cap). */
export function newClientId(): string {
  return CLIENT_ID_PREFIX + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

const byPosition = (a: Step, b: Step) => (a.position ?? 0) - (b.position ?? 0);

/** One root's trunk, head first, from parent links, mirroring `PipelineService.resolveRootTrunkAnchor`'s walk (the head is the
 *  root's lowest-position parentless step, each next step the first `position == 0` child). Temp (`step-N`) steps are never part
 *  of it: the server has no row for them (D1a). */
export function liveTrunkIds(steps: readonly Step[], rootId: string): string[] {
  const real = steps.filter((s) => !isTempStepId(s.id));
  const head = real.filter((s) => !s.parentStepId && s.rootId === rootId).sort(byPosition)[0];
  const trunk: string[] = [];
  const seen = new Set<string>();
  let cur: Step | undefined = head;
  while (cur && !seen.has(cur.id)) {
    trunk.push(cur.id);
    seen.add(cur.id);
    const parentId: string = cur.id;
    cur = real.filter((s) => s.parentStepId === parentId && (s.position ?? 0) === 0)[0];
  }
  return trunk;
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

function freshStep(
  clientId: string,
  type: string,
  config: PipelineStepConfig,
  enabled: boolean,
): Step {
  const opType = OP_TYPES.find((o) => o.id === type) ?? unsupportedOpType(type);
  return { id: clientId, opType, label: opType.label, config, enabled };
}

/** `spliceInsertReportingInternal` under an anchor step: the new step becomes the anchor's sole child at position 0 and every
 *  existing child of the anchor (trunk continuation and tails) moves under it, keeping its position. */
function spliceAfter(steps: readonly Step[], anchorId: string, fresh: Step): Step[] | null {
  const at = steps.findIndex((s) => s.id === anchorId);
  if (at === -1 || isTempStepId(anchorId)) return null;
  const next = steps.map((s) =>
    s.parentStepId === anchorId && !isTempStepId(s.id)
      ? { ...s, parentStepId: fresh.id, rootId: undefined }
      : s,
  );
  next.splice(at + 1, 0, { ...fresh, parentStepId: anchorId, position: 0, rootId: undefined });
  return next;
}

/** The same primitive with no anchor: the new step heads the root and the root's parentless steps move under it. */
function spliceAtHead(steps: readonly Step[], rootId: string, fresh: Step): Step[] {
  const isHeadLevel = (s: Step) => !s.parentStepId && s.rootId === rootId && !isTempStepId(s.id);
  const first = steps.findIndex(isHeadLevel);
  const next = steps.map((s) =>
    isHeadLevel(s) ? { ...s, parentStepId: fresh.id, rootId: undefined } : s,
  );
  next.splice(first === -1 ? next.length : first, 0, {
    ...fresh,
    parentStepId: undefined,
    rootId,
    position: 0,
  });
  return next;
}

/** `attachTailInternalAction`: a new child of `parentId` at max sibling position + 1 (at least 1), moving nothing. */
function attachLane(steps: readonly Step[], parentId: string, fresh: Step): Step[] | null {
  const at = steps.findIndex((s) => s.id === parentId);
  if (at === -1 || isTempStepId(parentId)) return null;
  const maxPos = steps
    .filter((s) => s.parentStepId === parentId && !isTempStepId(s.id))
    .reduce((max, s) => Math.max(max, s.position ?? 0), 0);
  const next = [...steps];
  next.splice(at + 1, 0, {
    ...fresh,
    parentStepId: parentId,
    position: Math.max(maxPos + 1, 1),
    rootId: undefined,
  });
  return next;
}

/** `reorderTrunkAction`: the root's trunk is relinked in the given order, every trunk node at position 0; tails keep their
 *  parent, so a tail follows its trunk step. Refused unless `trunk` is exactly the root's current trunk (a partial relink would
 *  leave one parent with two position-0 children). */
function relinkTrunk(
  steps: readonly Step[],
  rootId: string,
  trunk: readonly string[],
): Step[] | null {
  const live = liveTrunkIds(steps, rootId);
  if (live.length !== trunk.length || new Set(trunk).size !== trunk.length) return null;
  const liveSet = new Set(live);
  if (!trunk.every((id) => liveSet.has(id))) return null;
  const index = new Map(trunk.map((id, i) => [id, i] as const));
  return steps.map((s) => {
    const i = index.get(s.id);
    if (i === undefined) return s;
    return {
      ...s,
      parentStepId: i === 0 ? undefined : trunk[i - 1],
      rootId: i === 0 ? rootId : undefined,
      position: 0,
    };
  });
}

/** Applies one op to `steps`, or `null` when an id it names is not there (or it would re-create an existing client id). */
export function applyOp(steps: readonly Step[], op: DraftOp): Step[] | null {
  const has = (id: string) => steps.some((s) => s.id === id);
  switch (op.kind) {
    case "delete":
      return has(op.stepId) ? deleteStep(steps, op.stepId) : null;
    case "insert": {
      if (has(op.clientId)) return null;
      const fresh = freshStep(op.clientId, op.type, op.config, true);
      if ("after" in op.anchor) return spliceAfter(steps, op.anchor.after, fresh);
      if ("head" in op.anchor) return spliceAtHead(steps, op.anchor.head, fresh);
      const last = liveTrunkIds(steps, op.anchor.append).at(-1);
      return last === undefined
        ? spliceAtHead(steps, op.anchor.append, fresh)
        : spliceAfter(steps, last, fresh);
    }
    case "lane":
      return has(op.clientId)
        ? null
        : attachLane(steps, op.parent, freshStep(op.clientId, op.type, op.config, true));
    case "duplicate":
      return has(op.clientId)
        ? null
        : spliceAfter(steps, op.of, freshStep(op.clientId, op.type, op.config, op.enabled));
    case "reorder":
      return relinkTrunk(steps, op.rootId, op.trunk);
  }
}

/** The ops in order over `base`; an op that does not apply is dropped, and later ops naming its client id then fail the same way. */
export function replayOps(
  base: readonly Step[],
  ops: readonly DraftOp[],
): { steps: Step[]; keptOps: DraftOp[]; droppedOps: DraftOp[] } {
  let steps: Step[] = [...base];
  const keptOps: DraftOp[] = [];
  const droppedOps: DraftOp[] = [];
  for (const op of ops) {
    const next = applyOp(steps, op);
    if (next === null) droppedOps.push(op);
    else {
      steps = next;
      keptOps.push(op);
    }
  }
  return { steps, keptOps, droppedOps };
}

/** A structure fingerprint (ids, links, positions, kinds; not configs) used to see that a draft's ops leave the tree as it was. */
export function structureKey(steps: readonly Step[]): string {
  return steps
    .map(
      (s) => `${s.id}|${s.parentStepId ?? ""}|${s.rootId ?? ""}|${s.position ?? 0}|${s.opType.id}`,
    )
    .sort()
    .join("\n");
}

/** The reordered trunk of `rootId` read back out of the full `Step[]` a lane reorder produced (D10). `before` is the root's
 *  `liveTrunkIds` BEFORE the move. A lane reorder also relinks the temp step the lane graph swept into it, so the walk follows
 *  parent links but only reports ids that were in `before`, hopping through any temp step on the way; calling `liveTrunkIds` on
 *  the result instead would stop at that temp step and truncate the trunk. */
export function trunkAfterMove(
  newOrder: readonly Step[],
  rootId: string,
  before: readonly string[],
): string[] {
  const inBefore = new Set(before);
  const kids = new Map<string, Step[]>();
  for (const s of newOrder) {
    if (!s.parentStepId) continue;
    const list = kids.get(s.parentStepId);
    if (list) list.push(s);
    else kids.set(s.parentStepId, [s]);
  }
  const nextReal = (id: string, hopped: Set<string>): string | null => {
    const children = kids.get(id) ?? [];
    const real = children.find((c) => inBefore.has(c.id));
    if (real) return real.id;
    for (const c of children) {
      if (!isTempStepId(c.id) || hopped.has(c.id)) continue;
      hopped.add(c.id);
      const found = nextReal(c.id, hopped);
      if (found !== null) return found;
    }
    return null;
  };
  const head = newOrder.find((s) => !s.parentStepId && s.rootId === rootId && inBefore.has(s.id));
  const trunk: string[] = [];
  let cur: string | null = head?.id ?? null;
  while (cur !== null && !trunk.includes(cur)) {
    trunk.push(cur);
    cur = nextReal(cur, new Set());
  }
  return trunk;
}
