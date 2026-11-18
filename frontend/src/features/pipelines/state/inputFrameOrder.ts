// inputFrameOrder -- HEL-1732 (design.md D1): the evaluator's input frames (a root's sample, a join/union/lookup source secondary's
// sample) arrive with their row keys in the server's hash order. Every column of a client-evaluated step inherits its position from
// them, so the frames are re-keyed into the source's DECLARED order (the saved analyze's `sourceSchemas`, else the sources list's
// `inferredSchema`, else ascending code-unit order). Memoized so an unchanged order keeps each frame's identity and the array's
// identity: the walker cache, the draft-preview request body and the flash baseline see no change. Saved and draft frames go through
// the same orderer, so they share one key order. Pure.

import type { Frame, RootFrame, Row, SourceFrames } from "../evaluator";
import { put, type Value } from "../evaluator/value";

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** `rows` with every row's keys in `names` order, then the keys `names` does not name in ascending code-unit order. */
export function reorderFrame(rows: Frame, names: readonly string[]): Frame {
  const named = new Set(names);
  return rows.map((row): Row => {
    const keys = Object.keys(row);
    const extras = keys.filter((k) => !named.has(k)).sort(byCodeUnit);
    const out: Record<string, Value> = {};
    for (const name of names)
      if (Object.prototype.hasOwnProperty.call(row, name)) put(out, name, row[name]);
    for (const key of extras) put(out, key, row[key]);
    return out;
  });
}

export type DeclaredNames = (id: string) => readonly string[] | undefined;

export interface InputOrderer {
  /** The roots' frames re-keyed; `declared` is asked per pipeline root id. `slot` names the caller (the saved walk and the draft walk
   *  each keep their own last result, so one never evicts the other's identity). */
  rootFrames: (frames: readonly RootFrame[], declared: DeclaredNames, slot?: string) => RootFrame[];
  /** The source secondaries' frames re-keyed; `declared` is asked per data source id. */
  sourceFrames: (frames: SourceFrames, declared: DeclaredNames, slot?: string) => SourceFrames;
}

export function createInputOrderer(): InputOrderer {
  // sample frame -> (JSON of the ordered names -> its re-keyed frame)
  const memo = new WeakMap<Frame, Map<string, Frame>>();
  const lastRootsBySlot = new Map<string, RootFrame[]>();
  const lastSourcesBySlot = new Map<string, SourceFrames>();

  const ordered = (rows: Frame, names: readonly string[]): Frame => {
    const key = JSON.stringify(names);
    let byNames = memo.get(rows);
    if (byNames === undefined) {
      byNames = new Map();
      memo.set(rows, byNames);
    }
    let out = byNames.get(key);
    if (out === undefined) {
      out = reorderFrame(rows, names);
      byNames.set(key, out);
    }
    return out;
  };

  return {
    rootFrames(frames, declared, slot = "") {
      const lastRoots = lastRootsBySlot.get(slot);
      const next = frames.map((f) => ({
        rootId: f.rootId,
        rows: ordered(f.rows, declared(f.rootId) ?? []),
      }));
      const same =
        lastRoots !== undefined &&
        lastRoots.length === next.length &&
        next.every((f, i) => f.rootId === lastRoots![i].rootId && f.rows === lastRoots![i].rows);
      if (same) return lastRoots!;
      lastRootsBySlot.set(slot, next);
      return next;
    },
    sourceFrames(frames, declared, slot = "") {
      const lastSources = lastSourcesBySlot.get(slot);
      const entries = Object.entries(frames).map(
        ([id, f]) =>
          [id, { rows: ordered(f.rows, declared(id) ?? []), complete: f.complete }] as const,
      );
      const same =
        lastSources !== undefined &&
        Object.keys(lastSources).length === entries.length &&
        entries.every(([id, f]) => {
          const prev = lastSources![id];
          return prev !== undefined && prev.rows === f.rows && prev.complete === f.complete;
        });
      if (same) return lastSources!;
      const next = Object.fromEntries(entries);
      lastSourcesBySlot.set(slot, next);
      return next;
    },
  };
}
