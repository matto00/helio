# HEL-1027: Server-side sort, filter and counts for Output rows (client-side row ops only see fetched rows)

## Description

### Context

HEL-448 shipped in-panel column sort as a **client-side** sort over the rows a panel has already fetched. That was an explicit owner ruling: HEL-448 stays frontend-only, the sort control stays live at all times (including while rows are truncated), and this round-trip was deferred here.

The consequence is that a sorted panel ranks only the fetched rows, not the Output:

* The INITIAL fetch for a panel is `pageSize: 200` (`frontend/src/features/panels/hooks/usePanelData.ts:101`, `page: 0`) — this applies to dashboard-grid panels and the detail modal alike.
* Each subsequent "Load more" fetches `pageSize: 50` (`frontend/src/features/panels/ui/PanelCard.tsx:145`, inside `handleLoadMore`).
* The server caps a single request at `Page.MaxLimit = 500` (`backend/src/main/scala/com/helio/domain/model/pagination.scala:13`).
* `fetchPanelPage` sends a server-side `offset`/`limit` (`frontend/src/features/panels/state/panelThunks.ts:329-332`) and `panelsSlice.ts` appends each page.

So on a 10,000-row Output, sorting `revenue desc` in a panel surfaces the largest of the fetched 200 and presents it at the top of the table. A user reading that as "the top revenue" gets a wrong answer, and the failure is silent.

### Correcting the record

HEL-448 originally listed "Server-side sort endpoint" as out of scope with the justification "rows are already fully client-loaded". **That justification was false.** `panelThunks.ts` carried a comment claiming client-side slicing while the code does a server offset/limit and appends pages. The exclusion was re-ruled on its merits (scope discipline for v0.7), not on the original stated reason. Recording this so a future reader does not inherit the false premise — and because HEL-451 / HEL-465 / HEL-469 each need to know how rows actually arrive.

HEL-448 ships a minimal truncation qualifier near the existing "Load more" affordance, shown only when the set is truncated. That is a disclosure, not a fix — the ranking is still partial.

### Filtering and counts (added 2026-09-08, from HEL-451)

HEL-451 (in-panel column filtering) hit the same wall and its counts requirement was moved here, because accurate counts under a filter are the *same server-side capability* as server-side sort — not a separate feature.

HEL-451 as filed required: "When filters are active, the 'Load more' affordance and `hasMore` count reflect the filtered set, not the raw set", with the acceptance criterion "Pagination/counts reflect the filtered set." **That is unsatisfiable client-side.** `hasMore` is server-derived (`panelThunks.ts`, `offset + pageSize < result.total`, where `result.total` is the Output's total). A client-side filter sees only fetched rows and cannot know how many of the UNFETCHED rows match, so no client-side implementation can make a count describe the filtered set.

Fetching the whole Output first was considered and rejected on performance grounds: at `Page.MaxLimit = 500` a 10,000-row Output means 20 sequential requests on every panel a user filters, which is a deliberate regression on exactly the large Outputs where filtering matters. It is also the same trade already refused for sort (gating the control on a fully-loaded set).

HEL-451 therefore ships filtering whose counts and "Load more" affordance describe the **loaded** row set, with the UI stating so rather than implying a whole-Output count. This ticket owns making them true.

**Additional scope from that transfer:**

* Add a filter parameter to `GET /api/outputs/:id/rows`, applied before the offset/limit window (same shape of work as the sort parameter below).
* Return a filtered total so `hasMore` and any displayed count describe the filtered set rather than the raw set.
* Remove or downgrade HEL-451's loaded-scope disclosure once counts are genuinely whole-Output.

### Scope

* Add a sort parameter to `GET /api/outputs/:id/rows` so the ordering is applied before the offset/limit window.
* Resolve the column whitelist / typing story for sorting on arbitrary `node_snapshots` JSON keys — this is the substantive design work and the main reason it was not folded into HEL-448.
* Define pagination reset semantics when the sort changes (an active sort with accumulated pages cannot simply keep appending).
* Decide how the client falls back when a column is not server-sortable.
* Remove or downgrade HEL-448's truncation qualifier once the ranking is complete.
* Add a filter parameter matching HEL-451's actual shipped semantics: case-insensitive **substring ("contains")** matching — a "quick" term (matches if ANY column contains it) ANDed with optional per-column terms (each column's term must also match). There is no richer operator set (no equals/gt/lt) to replicate — see `frontend/src/features/panels/ui/renderers/tableFilterPredicate.ts`.

## Acceptance Criteria

* Sorting a table panel bound to an Output larger than one page ranks the whole Output, not the fetched window.
* Changing the sort resets pagination coherently; no duplicated or dropped rows across pages.
* A column that cannot be sorted server-side has defined, non-silent behaviour.
* Filtering a table panel bound to an Output larger than one page narrows the whole Output, not the fetched window.
* With a filter active, `hasMore` and any displayed count describe the filtered set.
* HEL-451's loaded-scope disclosure is removed or restated to match the new reality.
* HEL-448's truncation qualifier is removed or restated to match the new reality.

## Dependencies

Follow-up to HEL-448 (in-panel column sort). Related lane: HEL-451, HEL-465, HEL-469 under epic HEL-351 (Epic — In-Panel Data Grid). Blocks HEL-915 (Epic — Dashboard variables & parameterized Outputs) — this ticket is its hard prerequisite; design the query parameters so HEL-915 can later reuse them (a dashboard variable is conceptually a filter on the read), but do NO HEL-915 work here — that is a design note, not scope.

## Driver context (not ticket text — orchestrator-gathered, premise-validated against main@55ad1d6d)

* `NodeSnapshotRepository.listRowsPaged` (backend/.../NodeSnapshotRepository.scala:125) already does `ORDER BY row_index ASC` + `OFFSET`/`LIMIT` in SQL — sort/filter can be pushed into SQL. Runs under `ctx.withSystemContext` (RLS-bypassing); `OutputService.rows` gates access via `outputRepo.findById(id, user)` (sharing-aware RLS select) BEFORE calling it — this ownership gate must remain the only access check; sort/filter params must not create a bypass.
* Security: sort/filter column name and value are user-supplied. Must be passed as bound parameters (e.g. `data ->> $key`), never string-interpolated. Test with a hostile column name.
* Typing is the core design work: sorting `data->>'col'` as text mis-orders numbers and dates. Decide how types are known (declared field types vs. inference) and avoid inferring a schema from row 0 (MISTAKES.md trap). Define non-silent behaviour for a column that can't be sorted server-side.
* Other client-side row consumers: HEL-588 cross-filter (client-side over loaded rows, via PanelInspectView's "Filter dashboard by X = Y" — this click→Inspect→action flow is a VERIFIED owner ruling per `openspec/changes/archive/2026-09-25-cross-filter-panels/design.md:3`, out of scope for this ticket's row-fetching change), HEL-572 drill-down/Inspect, and `LoadedScopeDisclosure.tsx` (the removal/rewrite seam for both HEL-448's and HEL-451's qualifier strings). This ticket is about TABLE panels; chart panels plotting the first 200 rows are out of scope unless the ACs force it.
* Pagination reset semantics on sort/filter change: no duplicated or dropped rows across pages (an AC). Include a stable tiebreaker (e.g. `row_index`) in the ORDER BY.
* Performance: consider the cost of sorting/filtering JSON on large snapshots and state explicitly whether an index is needed.
* If a migration is added, **V111 is the next free number** (latest on main is V110).
* Schemas/openspec contract (`schemas/`, `openspec/`) must be updated in the same change as client and server.
