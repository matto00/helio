import type { ResourceKind } from "../../../shared/chrome/resourceNavigation";

/**
 * HEL-503 design.md D1/D2, task 1.0 — recents support three kinds, not four: outputs were never
 * recorded (HEL-519 shipped before Output existed as a resource kind), and `ResourceRef`'s
 * `"output"` arm requires a `pipelineId` a bare `{kind, id}` recent entry cannot carry. Retyping
 * this store (rather than leaving `RecentEntry["kind"]` as the now-widened `ResourceKind`) is
 * what keeps `useRecentPaletteActions.ts:65`'s `{ kind: entry.kind, id: entry.id }` assignable
 * to `ResourceRef` and `:12`'s `Record<RecentEntry["kind"], LucideIcon>` exhaustive.
 */
export type RecentKind = Exclude<ResourceKind, "output">;

/** One recorded arrival at a resource. Most-recent-first, de-duplicated by `kind`+`id` (a
 * re-visit MOVES an entry, never duplicates it — task 2.1).
 *
 * skeptic-final-1.md CR1 — `title` is persisted AT RECORD TIME, not resolved lazily from a
 * Redux slice that may not have loaded on the current route (`/` never fetches
 * `sources`/`pipelines` — only `SidebarBody.tsx`'s per-section effect does — so a lazy-resolve
 * design rendered zero source/pipeline rows on the app's own default landing route). This
 * follows design.md D4's own principle ("retain when unsure — a stale entry beats a silently
 * missing one"): a title can go stale after a rename until the next visit, which is strictly
 * better than the row vanishing. `title` is OPTIONAL so an entry written before this field
 * existed (or one somehow missing it) degrades to the pre-existing resolve-from-slice path
 * (`useRecentPaletteActions.ts`) rather than being dropped or invalidating the whole blob. */
export interface RecentEntry {
  kind: RecentKind;
  id: string;
  visitedAt: number;
  title?: string;
}

export const RECENT_HISTORY_STORAGE_KEY = "helio.recentVisits";

/** Fixed cap — the least-recently-visited entry is discarded once exceeded (task 2.1). */
export const RECENT_HISTORY_MAX_ENTRIES = 10;

/**
 * HEL-503 design.md D1, task 1.0 (round-2 CR1) — a `Record<RecentKind, true>`, NOT an array
 * annotation. `const VALID_KINDS: readonly RecentKind[]` CANNOT fail the build when a kind is
 * added to `RecentKind` — an array annotation does not require the array literal to be
 * exhaustive over the type's members. A `Record` keyed by `RecentKind` IS checked for missing
 * keys, so adding a kind here breaks the build until this map is updated, which is the
 * exhaustiveness property the plan actually needs. `VALID_KINDS` is derived from this map's keys
 * rather than re-listed, so there is exactly one place the set of valid kinds is written down.
 */
const RECENT_KINDS: Record<RecentKind, true> = { dashboard: true, source: true, pipeline: true };
const VALID_KINDS: readonly RecentKind[] = Object.keys(RECENT_KINDS) as readonly RecentKind[];

function isRecentEntry(value: unknown): value is RecentEntry {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    candidate.id.length > 0 &&
    typeof candidate.visitedAt === "number" &&
    Number.isFinite(candidate.visitedAt) &&
    typeof candidate.kind === "string" &&
    (VALID_KINDS as string[]).includes(candidate.kind) &&
    // `title` is optional (migration: an entry written before this field existed has none) —
    // when PRESENT it must be a non-empty string; a malformed non-string/empty `title` on an
    // otherwise well-shaped entry fails the WHOLE blob, same as any other wrong-shape field
    // (design.md D3's "discard the whole blob" rule, not a per-entry patch-up).
    (candidate.title === undefined ||
      (typeof candidate.title === "string" && candidate.title.length > 0))
  );
}

/**
 * design.md D3 — strictly more than `ThemeProvider`'s precedent supplies: `JSON.parse` is
 * wrapped in try/catch AND every entry is shape-validated. Well-formed JSON of the wrong shape
 * is not a valid history — the WHOLE blob is discarded rather than partially trusted, since a
 * partially-valid blob could still hold e.g. a `null`-id entry that slipped past an earlier bug.
 * Every failure path (absent key, malformed JSON, wrong shape, `getItem` throwing) returns `[]`
 * — an empty history is a normal state, never an error state.
 */
export function loadRecentHistory(storageKey: string = RECENT_HISTORY_STORAGE_KEY): RecentEntry[] {
  if (typeof window === "undefined") return [];
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(storageKey);
  } catch {
    return [];
  }
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed) || !parsed.every(isRecentEntry)) return [];
  return parsed;
}

/**
 * design.md D3 — `setItem` throws on quota exhaustion and in some private-browsing modes. A
 * failed write must NEVER break navigation — the caller's actual action (recording a visit)
 * still succeeds in memory; only persistence across reloads is lost.
 */
function saveRecentHistory(entries: RecentEntry[], storageKey: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(entries));
  } catch {
    // Storage unavailable/full — the in-memory store above already reflects the visit; only
    // persistence across reloads is lost, and that is an acceptable degrade (design.md D3).
  }
}

export interface RecentHistoryStore {
  getEntries(): RecentEntry[];
  subscribe(listener: () => void): () => void;
  /** Records an arrival at `{kind, id}`: moves an existing entry for the same `kind`+`id` to the
   * front (never duplicates it), then caps the list at `RECENT_HISTORY_MAX_ENTRIES`, discarding
   * the least recent. `title` is persisted alongside the entry when the caller has one on hand
   * (skeptic-final-1.md CR1) — a re-visit re-records it, so a rename self-heals on next visit.
   * Callers WITHOUT a resolvable title yet (none observed today; every recording site — the
   * dashboards listener, the sources/pipelines route effect — has the title in hand at record
   * time) may omit it; the palette then falls back to resolving from the live Redux slice. */
  recordVisit(kind: RecentKind, id: string, title?: string): void;
  /** Drops every entry of `kind` whose `id` is not in `existingIds` (task 4.2). Callers must only
   * call this once that kind's collection has genuinely resolved (design.md D4) — this function
   * itself does not know or check that; see `recentVisitsListeners.ts`. */
  pruneMissing(kind: RecentKind, existingIds: ReadonlySet<string>): void;
}

/** Framework-free observable store, deliberately not React state — mirrors `commandRegistry.ts`'s
 * own rationale: it must be writable from non-component code (the dashboards Redux listener, the
 * sources/pipelines route effect) and readable via `useSyncExternalStore`. A factory (rather than
 * only a singleton) so unit tests get an isolated instance instead of sharing global state. */
export function createRecentHistoryStore(
  storageKey: string = RECENT_HISTORY_STORAGE_KEY,
): RecentHistoryStore {
  let entries: RecentEntry[] = loadRecentHistory(storageKey);
  const listeners = new Set<() => void>();

  function notify() {
    for (const listener of listeners) listener();
  }

  return {
    getEntries() {
      return entries;
    },
    recordVisit(kind, id, title) {
      const withoutExisting = entries.filter((entry) => !(entry.kind === kind && entry.id === id));
      const entry: RecentEntry =
        title !== undefined
          ? { kind, id, visitedAt: Date.now(), title }
          : { kind, id, visitedAt: Date.now() };
      entries = [entry, ...withoutExisting].slice(0, RECENT_HISTORY_MAX_ENTRIES);
      saveRecentHistory(entries, storageKey);
      notify();
    },
    pruneMissing(kind, existingIds) {
      const next = entries.filter((entry) => entry.kind !== kind || existingIds.has(entry.id));
      if (next.length === entries.length) return;
      entries = next;
      saveRecentHistory(entries, storageKey);
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The one instance the running app actually uses — everything else (the listeners, the palette
 * hook) reads/writes through this. */
export const recentHistoryStore = createRecentHistoryStore();
