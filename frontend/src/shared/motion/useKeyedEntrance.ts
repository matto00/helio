import { useState, type CSSProperties } from "react";

import "./motion.css";

export type EntrancePhase = "enter" | "pop" | null;

export interface Entrance {
  /** `enter`: part of the first population (staggered); `pop`: first seen later (a single rise); `null`: no entrance. */
  phase: EntrancePhase;
  /** The stagger position within the first population; 0 for a later key. */
  index: number;
}

export interface KeyedEntranceOptions {
  /** Whether the first population staggers in (false: it appears at once). */
  playInitial: boolean;
  /** What a key that first appears after the first population does. */
  later: "pop" | "none";
}

const NONE: Entrance = { phase: null, index: 0 };

/** Keyed entrance (HEL-1584, DESIGN.md §10): the keys present on a surface's first non-empty render stagger in the order
 *  the caller gave them; a key that first appears later pops in once (or stays still, per `later`); a key that leaves and
 *  returns counts as later. It returns the phase and stagger index only, never a className, so a caller whose item is
 *  positioned by a transform it does not own (react-grid-layout) can put the animation on an inner element. Re-renders never
 *  replay an entrance: an entry is recorded once and only changes when its key leaves. The latch is React's "adjust state
 *  while rendering" (the `useStaggeredEntrance` pattern), which resolves in the same pass and adds no commit; it resets
 *  only on remount, or a caller-chosen React `key`. */
export function useKeyedEntrance(
  keys: readonly string[],
  options: KeyedEntranceOptions,
): { entranceOf: (key: string) => Entrance } {
  const [entries, setEntries] = useState<ReadonlyMap<string, Entrance> | null>(null);

  let current = entries;
  if (current === null) {
    if (keys.length > 0) {
      const first = new Map<string, Entrance>();
      keys.forEach((key, index) => {
        first.set(key, options.playInitial ? { phase: "enter", index } : NONE);
      });
      setEntries(first);
      current = first;
    }
  } else {
    let next: Map<string, Entrance> | null = null;
    const present = new Set(keys);
    for (const key of keys) {
      if (!current.has(key)) {
        next ??= new Map(current);
        next.set(key, options.later === "pop" ? { phase: "pop", index: 0 } : NONE);
      }
    }
    for (const key of current.keys()) {
      if (!present.has(key)) {
        next ??= new Map(current);
        next.delete(key);
      }
    }
    if (next !== null) {
      setEntries(next);
      current = next;
    }
  }

  const resolved = current;
  return { entranceOf: (key: string) => resolved?.get(key) ?? NONE };
}

/** The className and style for an entry on a flow list item (one that owns no inline transform): the entrance class for
 *  its phase and the stagger index. `emphasized` lengthens a staggered rise to `--motion-duration-emphasized`
 *  (panel and card rises only, DESIGN.md §10). An entry with no phase yields no class. */
export function entranceClassProps(
  entry: Entrance,
  options: { emphasized?: boolean } = {},
): { className: string; style: CSSProperties } {
  if (entry.phase === "enter") {
    return {
      className: options.emphasized ? "motion-enter motion-enter--emphasized" : "motion-enter",
      style: { "--motion-index": entry.index } as CSSProperties,
    };
  }
  if (entry.phase === "pop") return { className: "motion-pop", style: {} };
  return { className: "", style: {} };
}
