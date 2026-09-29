## Skeptic Report — design gate (round N, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/output-routes-api/spec.md` in full.
- Cross-checked D2's typing claims against real code:
  - `backend/src/main/scala/com/helio/domain/model/model.scala:658-762` — `DataFieldType`,
    `FieldTypeCategory` (Structured vs Content), `category()` — confirms the
    Structured/Content split D2 relies on already exists exactly as described.
  - `backend/src/main/scala/com/helio/domain/model/model.scala:898-911` — `Output.schema:
    Vector[SchemaField] = Vector.empty` — confirms the "empty/stale schema" case D2/D3
    handle is a real, reachable state, not a hypothetical.
  - `backend/src/main/scala/com/helio/services/pipelines/OutputService.scala:359-380` and
    `backend/src/main/scala/com/helio/api/routes/pipelines/OutputRoutes.scala:88-102` —
    confirms `OutputService.rows` already has `output` in scope after the
    `outputRepo.findById` ACL gate (task 3.1's schema-resolution step has somewhere correct
    to hook in) and confirms the route's current offset/limit-only parameter parsing.
  - `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/NodeSnapshotRepository.scala:125-159`
    — confirms `listRowsPaged`'s current two-query (count, then page) shape, and confirms
    the codebase's existing Slick `sql"..."`-interpolation convention (e.g. `sql" AND
    node_step_id = $stepId"`) already binds interpolated Scala values as parameters rather
    than splicing raw text — this is the same mechanism D6 proposes for `data ->> $key`, so
    D6's "bound parameter, not string interpolation" security claim is technically sound and
    consistent with how this repository already talks to Postgres. No SQL-injection defect
    in the *mechanism* D6 proposes.
  - `frontend/src/features/panels/ui/renderers/LoadedScopeDisclosure.tsx` — confirms D7's
    description of the current two branches (`!filtering` truncation note vs `filtering`
    "N of M loaded rows match") matches the real component, and that D7's proposed collapse
    to a single "{total} results." reads as correct given `total` becomes Output-wide (D5).
  - `frontend/src/features/panels/state/panelThunks.ts:331` — confirms `hasMore = offset +
    pageSize < result.total` is the only client consumer of `.total`, so D5's total-meaning
    change doesn't silently break another reader.
- Traced the frontend sort/filter data flow to check D4's pagination-reset premise:
  - `frontend/src/features/panels/hooks/usePanelData.ts:52-113` — the fetch effect's
    dedupe key (`currentFetchKey = panel.id + "|" + outputId`) has no sort/filter
    component at all today; nothing in this hook currently reacts to a sort/filter change.
  - `frontend/src/features/panels/ui/renderers/TableRenderer.tsx:250-360` — sort
    (`useSortedRows`/`toggleSort`, seeded once via `defaultSort` with an
    intentionally-empty `useMemo` dep array) and filter (`filters`/`setFilters`, a local
    `useState` seeded once from `columnFilters`) are **both component-local state inside
    `TableRenderer`**, three layers below where fetching happens.
  - `frontend/src/features/panels/ui/PanelCard.tsx:138-150` (`handleLoadMore`) and
    `frontend/src/features/panels/state/panelsSlice.ts:112-114` (`resetPanelPagination`) —
    confirms `fetchPanelPage`/pagination-reset dispatch lives at `PanelCardBody`, not
    `TableRenderer`, and that `resetPanelPagination` is defined but has **zero call sites**
    anywhere in the frontend (`grep -rn "resetPanelPagination" frontend/src` finds only its
    definition and export) — it is unused scaffolding, not an exercised pattern.
  - `frontend/src/features/panels/ui/PanelContent.tsx:203-214` — confirms `columnSort`/
    `columnFilters` flow only *downward* (seed values into `TableRenderer`); there is no
    existing upward callback for "sort changed" / "filter changed" reaching `PanelCardBody`.
- Confirmed via `grep -in "index\|performance"` across `design.md`/`tasks.md`/`proposal.md`
  that none of the three planning documents contain the word "index" or "performance" in
  any decision text (the only "index" hits were unrelated `row_index` references).

### Verdict: REFUTE

### Change Requests

1. **Missing, ticket-mandated performance/indexing decision (design.md).** `ticket.md`'s
   driver context states explicitly: "Performance: consider the cost of sorting/filtering
   JSON on large snapshots and state explicitly whether an index is needed." `design.md`
   contains no decision addressing this at all — no cost analysis, no index decision (yes
   or no), nothing. This isn't a nitpick: D2's own `safe_numeric`/`safe_timestamptz`
   functions wrap every cast in a PL/pgSQL `BEGIN...EXCEPTION WHEN OTHERS` block, and
   PL/pgSQL exception handlers create an implicit subtransaction/savepoint on every
   invocation — a real, well-known Postgres cost when called once per row on a
   `sort=revenue:desc` over the ticket's own working example of a 10,000-row Output, on
   top of `data ->>` extracting from a JSONB column with no index. The ticket asked this
   question directly and design.md must answer it (either "an index is added, here's the
   DDL" or "no index; here is the measured/reasoned justification that a sequential JSONB
   scan + per-row exception-trapped cast is acceptable at expected Output sizes") before
   this is ready for implementation — not deferred silently.

2. **D4's pagination-reset semantics rest on a frontend architecture decision that is
   never made.** D4 says resetting pagination on sort/filter change "mirrors how
   `usePanelData`/`panelsSlice` already reset on other panel-config changes" — but that
   pattern doesn't actually exist today: `resetPanelPagination` (`panelsSlice.ts:112-114`)
   has zero call sites in the frontend, and `usePanelData`'s fetch effect
   (`usePanelData.ts:52-113`) has no sort/filter awareness in its dedupe key. More
   substantively: sort and filter are currently **component-local `useState` inside
   `TableRenderer.tsx`** (`sortState`/`toggleSort` via `useSortedRows`, `filters`/
   `setFilters`), three component layers below `PanelCardBody`, which is where
   `fetchPanelPage` is actually dispatched (`PanelCard.tsx:138-150`). Neither `design.md`
   nor `tasks.md` (4.1/4.2) identifies:
   - where the *authoritative* sort/filter state will live going forward (it cannot stay
     purely local to `TableRenderer` if a change to it must trigger a Redux dispatch three
     layers up), or
   - the new callback-prop plumbing needed from `TableRenderer` → `PanelContent` →
     `PanelCardBody` to carry a sort/filter change up to the fetch-dispatch site, or
   - what happens to `useSortedRows`'s existing client-side re-sort of the already-fetched
     page once the server is doing the real, authoritative sort — is it removed, left as a
     harmless no-op, or does it risk masking a server/client sort-state mismatch (e.g. the
     local `toggleSort` cycling to a direction the server was never asked for)?
   This is exactly the pagination-duplication/drop risk the ticket's AC #2 is worried
   about — "no duplicated or dropped rows across pages" is only as safe as the reset that
   fires on every sort/filter change, and right now there is no described mechanism that
   fires at all. This needs an explicit decision (state ownership + the callback path) in
   `design.md` before execution, not left for the executor to invent mid-implementation.

### Non-blocking notes

- D2/D3/D5/D6/D7 are otherwise well-grounded in real, already-existing code (`DataFieldType`
  categorization, `Output.schema`, the Slick bound-parameter convention, the single
  `.total` consumer) and are sound as far as they go — my objections are about two specific
  omissions (performance/indexing, and the frontend state-ownership/plumbing decision for
  D4), not the overall shape of the change.
- Scope (table panels only; HEL-588/HEL-572 excluded; no HEL-915 work) is correctly bounded
  and consistent between `ticket.md`, `proposal.md`, and `design.md`'s D8.
