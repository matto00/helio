import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";

import type { ColumnDef } from "../../../../shared/ui/index";
import type { SortState } from "../../../../shared/ui/useSortedRows";
import type { TableColumnFilters } from "../../../pipelines/ui/outputEditor/outputConfigTypes";
import { normalizeColumnFiltersForWrite } from "./tableFilterPredicate";
import { UNSORTED_SENTINEL, leadingPinnedCount } from "./tableRendererModel";
import {
  PERSIST_DEBOUNCE_MS,
  persistColumnFilters,
  persistColumnSort,
  persistPinnedColumns,
} from "./tableRendererPersistence";
import type { TableRendererProps } from "./tableRendererProps";

type UseTablePersistedStateParams = Pick<
  TableRendererProps,
  "outputId" | "columnOrder" | "pinnedColumns" | "onSortChange" | "onFilterChange"
> & {
  canWrite: boolean;
  columns: ColumnDef[];
  setFilters: Dispatch<SetStateAction<TableColumnFilters>>;
  sortState: SortState<string>;
  toggleSort: (key: string) => void;
};

export function useTablePersistedState({
  outputId,
  columnOrder,
  pinnedColumns,
  onSortChange,
  onFilterChange,
  canWrite,
  columns,
  setFilters,
  sortState,
  toggleSort,
}: UseTablePersistedStateParams) {
  // HEL-448 design D6: the debounced PATCH MUST flush (not cancel) on
  // unmount — closing the panel detail modal unmounts this component, which
  // is exactly the path the "sort persists across detail-modal open/close"
  // AC exercises. A cancelling `clearTimeout`-on-cleanup would turn that AC
  // into a race the user loses whenever they close the modal inside the
  // debounce window.
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSortRef = useRef<SortState<string> | null>(null);

  // HEL-451 design D6: same flush-not-cancel contract as the sort timer
  // above, kept as an INDEPENDENT timer/ref pair — a filter edit and a sort
  // click can each be mid-debounce at the same time, and each must flush
  // its own pending write on unmount regardless of the other's state.
  // `undefined` means "no pending filter write"; `null` is a real pending
  // write that CLEARS the persisted filter (design D1's normalize-to-null).
  const filterPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingFiltersRef = useRef<TableColumnFilters | null | undefined>(undefined);

  // HEL-465 design.md Decision 1 — pin state tracked as a COUNT of leading
  // `columns` entries, not a list of keys: Decision 1 requires the pinned
  // set to always be exactly "the first K columns of the current order", and
  // a count is invariant under reorder by construction ("preserved by
  // position, not identity", per the ticket's AC/design.md Risk) — no
  // re-derivation logic is needed to keep it a valid leading run on reorder;
  // only the KEYS occupying those first K positions change, recomputed
  // below (`pinnedKeys`) from `columns` every render. Seeded once from the
  // persisted value, same "seeded once" precedent as `filters`/`defaultSort`
  // (`useTableRows.ts`) — correct only because `OutputPanelContent` withholds this component
  // behind a skeleton until `useOutputMeta` resolves.
  const [pinnedCount, setPinnedCount] = useState<number>(() =>
    leadingPinnedCount(columns, pinnedColumns ?? []),
  );
  const pinnedKeys = useMemo(
    () => columns.slice(0, pinnedCount).map((c) => c.key),
    [columns, pinnedCount],
  );
  const pinPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPinnedRef = useRef<string[] | null>(null);

  // HEL-465 evaluation-1.md CR2 — `pinnedCount` read via a REF, not a
  // `setPinnedCount` updater's `prevCount` param, inside the reorder effect
  // below. A state updater must be a pure function of its previous value;
  // under `React.StrictMode` (main.tsx), React double-invokes updaters to
  // surface exactly this kind of impurity, which would fire
  // `persistPinnedColumns` — a real side effect — TWICE per reorder. Kept in
  // sync via its own effect rather than read from render, so the reorder
  // effect always sees the true latest value regardless of ordering.
  const pinnedCountRef = useRef(pinnedCount);
  useEffect(() => {
    pinnedCountRef.current = pinnedCount;
  }, [pinnedCount]);

  // HEL-465 skeptic-final-1 CR2 (non-blocking, fixed) — CORRECTS the
  // cycle-2 "have I mounted" boolean guard (`pinMountedRef`) this comment
  // used to describe as sufficient. It was NOT: `React.StrictMode` double-
  // invokes a MOUNT effect (setup → cleanup → setup) as one of its dev-only
  // checks, and a boolean ref flips true on the FIRST of those two
  // invocations, so the second sails straight past the "skip on mount"
  // guard and calls the un-debounced `persistPinnedColumns` with no user
  // interaction at all — confirmed live via network interceptor (skeptic-
  // final-1): a cold page load and a navigate-away-and-back both fired an
  // unsolicited PATCH. The prior version of this comment claimed
  // `persistPinnedColumns` "is never called from inside a function React
  // could invoke more than once" — that was FALSE: an effect body is
  // exactly such a function under StrictMode's mount double-invoke, and
  // this was the live proof.
  //
  // Fixed by seeding the guard with the VALUE last persisted (a no-op key
  // string comparison), not a boolean "have I mounted" flag — a repeat
  // invocation with an unchanged derived value is now a genuine no-op
  // regardless of how many times React calls this effect body, which also
  // makes the separate `pinMountedRef` unnecessary (removed): the initial
  // mount's derived key list is BY CONSTRUCTION identical to the seed
  // value below (both come from the same `columnOrder`/`pinnedColumns`
  // props), so it already reads as "unchanged" without a first-mount
  // special case. Dev-only impact (StrictMode's double-invoke never runs
  // in production) and the write was a no-op (same value re-sent), but it
  // is the same defect class evaluation-1 blocked CR2 on, and it burned a
  // real network write on every table-panel mount in dev.
  const lastPersistedPinnedKeyRef = useRef(pinnedKeys.join("|"));

  // HEL-465 design.md Risk / tasks.md 1.3: a reorder can change WHICH keys
  // occupy the leading K positions even though K itself is unchanged — the
  // persisted VALUE (a key list, not a count) must be re-written
  // IMMEDIATELY (not debounced — this is a structural correction keeping
  // the stored value in sync with the new order, not a user edit) or it
  // silently drifts from the new `columnOrder` between edits.
  useEffect(() => {
    const prevCount = pinnedCountRef.current;
    if (prevCount === 0) return;
    const clamped = Math.min(prevCount, columns.length);
    if (clamped !== prevCount) setPinnedCount(clamped);
    const nextKeys = columns.slice(0, clamped).map((c) => c.key);
    const nextKeyString = nextKeys.join("|");
    // No-op guard (skeptic-final-1 CR2): covers both the genuinely-
    // unchanged-order case and a StrictMode-doubled invocation of this same
    // effect body, which would otherwise re-send an identical write.
    if (nextKeyString === lastPersistedPinnedKeyRef.current) return;
    lastPersistedPinnedKeyRef.current = nextKeyString;
    if (canWrite) {
      persistPinnedColumns(outputId, nextKeys);
    }
    // Deliberately scoped to `columnOrder` alone (task 1.3: "on reorder"),
    // not `columns`/`pinnedCount` — `columns` also changes on unrelated data
    // refreshes (a new page of pagination rows), which must NOT re-fire this
    // immediate, un-debounced persist. `canWrite`/`outputId` are read from
    // the closure, matching the sort/filter effects' own ref-based pattern.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnOrder]);

  // Flush uses refs, not state, so it always sees the latest pending write
  // regardless of this effect's own dependency array.
  useEffect(() => {
    return () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        if (pendingSortRef.current) {
          persistColumnSort(outputId, pendingSortRef.current);
        }
      }
      if (filterPersistTimerRef.current) {
        clearTimeout(filterPersistTimerRef.current);
        if (pendingFiltersRef.current !== undefined) {
          persistColumnFilters(outputId, pendingFiltersRef.current);
        }
      }
      if (pinPersistTimerRef.current) {
        clearTimeout(pinPersistTimerRef.current);
        if (pendingPinnedRef.current !== null) {
          persistPinnedColumns(outputId, pendingPinnedRef.current);
        }
      }
    };
  }, [outputId]);

  // The persist fires from THIS handler (a real user activation) — never
  // from an effect observing `sortState`, which would also fire on mount
  // with the sentinel and PATCH it into every table Output a user merely
  // views (design D6). The asc/desc math below mirrors `useSortedRows`'
  // own `toggleSort` reducer exactly, because `toggleSort`'s state update is
  // async — `sortState` in this closure is still the PRE-toggle value, so
  // the PATCH body is computed independently rather than read back.
  function handleSort(key: string) {
    toggleSort(key);
    const next: SortState<string> =
      sortState.key !== key
        ? { key, direction: "asc" }
        : { key, direction: sortState.direction === "asc" ? "desc" : "asc" };
    // HEL-1027 design.md D4 — unconditional: fires for every caller regardless of `canWrite`,
    // mirroring `toggleSort` above (the local UI update) rather than the persist-write gate below
    // — a non-owner shared-dashboard viewer's sort click still drives the server refetch even
    // though it never reaches `persistColumnSort` (skeptic-design-2.md CR2's exact concern).
    onSortChange?.(next.key, next.direction);
    if (key === UNSORTED_SENTINEL || !canWrite) return;
    pendingSortRef.current = next;
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      persistTimerRef.current = null;
      // Minimal patch — NEVER spread `output.config` here (design D6):
      // `useOutputMeta` is a per-mount snapshot never refreshed after a
      // write, so spreading it would re-send a stale `fieldMapping`/
      // `columnOrder` and turn every sort click into a lost update. The
      // backend's `mergeConfig` preserves untouched keys on its own.
      persistColumnSort(outputId, next);
    }, PERSIST_DEBOUNCE_MS);
  }

  // HEL-451 design D6/task 5: rows filter IMMEDIATELY from local state
  // (`filters`, `useTableRows.ts`) — only the PATCH is debounced, so persistence
  // latency never makes typing feel laggy (design D6, task 5.4). Real user
  // edit only — never fired from an effect on mount, for the same reason
  // `handleSort`'s persist fires from a handler rather than an effect.
  function handleFilterChange(next: TableColumnFilters) {
    setFilters(next);
    // HEL-1027 design.md D4 — unconditional, same rationale as `handleSort`'s `onSortChange`
    // call above.
    onFilterChange?.(next);
    if (!canWrite) return;
    const normalized = normalizeColumnFiltersForWrite(next);
    pendingFiltersRef.current = normalized;
    if (filterPersistTimerRef.current) clearTimeout(filterPersistTimerRef.current);
    filterPersistTimerRef.current = setTimeout(() => {
      filterPersistTimerRef.current = null;
      // Minimal patch — NEVER spread `output.config` (design D6, same
      // rationale as `handleSort`'s PATCH above).
      persistColumnFilters(outputId, normalized);
    }, PERSIST_DEBOUNCE_MS);
  }

  function handleClearFilters() {
    handleFilterChange({});
  }

  // HEL-465 design.md Decision 1/3, tasks.md 3.3 — computes the next
  // leading-run pinned COUNT from where `key` sits in the current order:
  // toggling an already-pinned column unpins it and everything ordered
  // after it (count becomes its own index); toggling an unpinned column
  // pins it and every column ordered ahead of it (count becomes index + 1).
  // Both cases collapse to the same "the pinned set is always the first K
  // columns" invariant this ticket's design rests on. `index === -1` (a key
  // `DataGrid` reported that isn't in the current `columns` at all) is
  // defensive-only — cannot happen via the wired-up pin button, which only
  // ever reports a key from the very `columns` array it was rendered from.
  function handlePinToggle(key: string) {
    const index = columns.findIndex((c) => c.key === key);
    if (index === -1) return;
    const nextCount = index < pinnedCount ? index : index + 1;
    setPinnedCount(nextCount);
    if (!canWrite) return;
    // design.md Decision 6: MUST send `[]` explicitly for the empty case
    // (nextCount === 0 here), never omit the field — `columns.slice(0, 0)`
    // already yields `[]`, so no separate branch is needed to guarantee it.
    const next = columns.slice(0, nextCount).map((c) => c.key);
    pendingPinnedRef.current = next;
    // Kept in sync with the reorder effect's own no-op guard above (skeptic-
    // final-1 CR2) so a reorder landing right after this toggle — before the
    // debounce below fires — compares against what this toggle is ABOUT to
    // persist, not a stale pre-toggle value.
    lastPersistedPinnedKeyRef.current = next.join("|");
    if (pinPersistTimerRef.current) clearTimeout(pinPersistTimerRef.current);
    pinPersistTimerRef.current = setTimeout(() => {
      pinPersistTimerRef.current = null;
      persistPinnedColumns(outputId, next);
    }, PERSIST_DEBOUNCE_MS);
  }

  return { pinnedKeys, handleSort, handleFilterChange, handleClearFilters, handlePinToggle };
}
