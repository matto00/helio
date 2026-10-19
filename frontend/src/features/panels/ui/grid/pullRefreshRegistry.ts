// Pull-to-refresh fan-out (HEL-1656). There is no dashboard-level refresh: every output-bound panel owns one
// `usePanelData(panel)` whose `refresh()` is guarded against an in-flight request. This registry lets the phone stack
// call each of those once on a qualifying pull and learn when they have all settled, without importing any pipeline-run
// code. Non-output panels never register, so a pull never touches them.

import { createContext, useContext, useEffect, useRef } from "react";

/** A request-timeout ceiling, not a motion timing: busy clears after this long even if a request never settles, so a
 *  hung request cannot pin the indicator (the panel keeps its own spinner and error). */
export const PULL_REFRESH_TIMEOUT_MS = 15000;

interface Entry {
  refresh: () => void;
  isRefreshing: boolean;
}

/** Per-panel state of the current round: `seen` once the panel reported refreshing, `done` after it then stopped. */
interface RoundEntry {
  seen: boolean;
  done: boolean;
}

export class PullRefreshRegistry {
  private readonly entries = new Map<string, Entry>();
  private round: Map<string, RoundEntry> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<(busy: boolean) => void>();

  get busy(): boolean {
    return this.round !== null;
  }

  subscribe(listener: (busy: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  register(panelId: string, entry: Entry): () => void {
    this.entries.set(panelId, entry);
    return () => {
      this.entries.delete(panelId);
      // An unmounted panel can no longer report; it must not hold the round open.
      if (this.round?.delete(panelId)) this.settleIfDone();
    };
  }

  /** Record a panel's `isRefreshing`; notifies only when the value changed, never on a plain re-render. */
  setRefreshing(panelId: string, isRefreshing: boolean): void {
    const entry = this.entries.get(panelId);
    if (entry === undefined || entry.isRefreshing === isRefreshing) return;
    entry.isRefreshing = isRefreshing;
    const slot = this.round?.get(panelId);
    if (slot === undefined) return;
    if (isRefreshing) slot.seen = true;
    else if (slot.seen) slot.done = true;
    this.settleIfDone();
  }

  /** Call every registered panel's refresh once. Returns whether a round started: `false` for a round already running
   *  (a second pull while busy is ignored) or with no output-bound panel (nothing to wait for, no busy state). */
  start(): boolean {
    if (this.round !== null || this.entries.size === 0) return false;
    const round = new Map<string, RoundEntry>();
    for (const [id, entry] of this.entries) {
      // A panel already in flight counts as seen: its refresh() below is a no-op, and its running request is what we wait on.
      round.set(id, { seen: entry.isRefreshing, done: false });
    }
    this.round = round;
    this.timer = setTimeout(() => this.end(), PULL_REFRESH_TIMEOUT_MS);
    this.notify(true);
    for (const entry of [...this.entries.values()]) entry.refresh();
    return true;
  }

  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.round = null;
    this.listeners.clear();
  }

  private settleIfDone(): void {
    if (this.round === null) return;
    for (const slot of this.round.values()) if (!slot.done) return;
    this.end();
  }

  private end(): void {
    if (this.round === null) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.round = null;
    this.notify(false);
  }

  private notify(busy: boolean): void {
    for (const listener of [...this.listeners]) listener(busy);
  }
}

export const PullRefreshContext = createContext<PullRefreshRegistry | null>(null);

/** Register an output-bound panel with the stack's registry for as long as it is mounted. Panels with no output do not
 *  call this with `enabled`, so the pull skips them. */
export function usePullRefreshRegistration(
  panelId: string,
  enabled: boolean,
  refresh: () => void,
  isRefreshing: boolean,
): void {
  const registry = useContext(PullRefreshContext);
  const refreshRef = useRef(refresh);
  const refreshingRef = useRef(isRefreshing);
  useEffect(() => {
    refreshRef.current = refresh;
    refreshingRef.current = isRefreshing;
  });

  useEffect(() => {
    if (registry === null || !enabled) return undefined;
    return registry.register(panelId, {
      refresh: () => refreshRef.current(),
      isRefreshing: refreshingRef.current,
    });
  }, [registry, panelId, enabled]);

  useEffect(() => {
    registry?.setRefreshing(panelId, isRefreshing);
  }, [registry, panelId, isRefreshing]);
}
