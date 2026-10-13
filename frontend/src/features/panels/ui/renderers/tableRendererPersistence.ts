import type { SortState } from "../../../../shared/ui/useSortedRows";
import { updateOutput } from "../../../pipelines/services/outputService";
import type { TableColumnFilters } from "../../../pipelines/ui/outputEditor/outputConfigTypes";

export const PERSIST_DEBOUNCE_MS = 300;

/** HEL-448 skeptic final-1 CR1: `updateOutput` can reject for reasons this
 *  surface has no say over -- e.g. a legacy Output whose `fieldMapping`
 *  predates `OutputBindingSpec.Table` having no slots, which fails
 *  HEL-892's merged-config validation with a 400 on every write (4/53
 *  table Outputs in dev as of this writing), or a 403 if `canWrite`'s
 *  snapshot of ownership goes stale mid-session. Design D7 mandates that a
 *  persist failure degrade SILENTLY to session-local -- no toast, no error
 *  surface, the on-screen sort stays exactly as the user left it -- so this
 *  is a DELIBERATE swallow of a config-write rejection, not a missed catch.
 *  Both `updateOutput` call sites below route through this one function so
 *  neither can regress back to a bare unhandled `void updateOutput(...)`. */
export function persistColumnSort(outputId: string, sort: SortState<string>): void {
  void updateOutput(outputId, { config: { columnSort: sort } }).catch(() => {
    // Intentionally silent -- see the function doc comment above.
  });
}

/** HEL-451 design D6 — same minimal-patch, deliberate-swallow shape as
 *  `persistColumnSort` above (design D6 reuses D6/D7's persistence path
 *  exactly); `filters` is already normalized (empty terms stripped, or the
 *  whole value collapsed to `null`) by the caller before this is invoked. */
export function persistColumnFilters(outputId: string, filters: TableColumnFilters | null): void {
  void updateOutput(outputId, { config: { columnFilters: filters } }).catch(() => {
    // Intentionally silent -- see persistColumnSort's doc comment above.
  });
}

/** HEL-465 design.md Decision 6/tasks.md 1.2 — same minimal-patch,
 *  deliberate-swallow shape as `persistColumnSort`/`persistColumnFilters`
 *  above. Clearing to empty MUST call this with `[]`, never skip the call:
 *  `OutputService.mergeConfig` (backend) is a shallow merge that leaves an
 *  omitted key's prior value intact, so an omitted write would silently
 *  fail to clear a previously-persisted pin set. */
export function persistPinnedColumns(outputId: string, pinned: string[]): void {
  void updateOutput(outputId, { config: { pinnedColumns: pinned } }).catch(() => {
    // Intentionally silent -- see persistColumnSort's doc comment above.
  });
}
