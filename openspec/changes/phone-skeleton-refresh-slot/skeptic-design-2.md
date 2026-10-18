## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed tree: HEAD 49021293b96c55fc9d80a6ed79b5b55d925fb6b7 (change dir untracked, artifacts only).

### What I verified (with evidence)

- **Spawn guard**: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=bug/phone-skeleton-refresh-slot/HEL-1646`.
- **Round-1 CRs**:
  - CR1 (D3 premise): the Context now says the right thing. `fetchPanels.pending` sets `loadedDashboardId` and leaves
    `items` alone (`panelsSlice.ts:238-241`), and `DashboardRefreshLine.tsx:27-32` reads `items` on that equality.
    D3 now extracts `showPanelGridSkeleton` (`PanelList.tsx:125-130`) as the one shared predicate. Addressed, but see
    CR1 below.
  - CR2 (replace sites): `upsertDashboardById` (`dashboardsSlice.ts:79-86`) and every `dashboardUpserted` caller
    (`dashboardsSlice.ts:231`, `patchSetsSlice.ts:204`, `combinedProposalsSlice.ts:35`, `useFirstRunTemplate.ts:43`,
    `useFirstRunBuild.ts:88`) are confirmed by grep and listed in D2 and task 2.1. The map reducers are at
    `dashboardsSlice.ts:456/468/481/492`. Addressed.
  - CR3 (load paths): `panelsRestored` (`:157-167`) and `duplicate`/`importDashboard.fulfilled` (`:335-349`) are named
    in D2. Addressed.
  - CR4 (switch cases): added to the spec, D4 and task 3.1. Addressed.
- **Text path during the skeleton**: `deriveDashboardMeta` (`dashboardMeta.ts:86`) returns `unknown` when no feeding
  pipeline is known, so `useDashboardMeta(id, [])` makes `refreshFactOf` return null. During the skeleton the line
  therefore falls through to the reserve branch, as D3 intends.
- **Effect ordering**: `showDashboardPanels` is dispatched only from `App.tsx:177-183` (an effect keyed on
  `selectedDashboardId`). `PanelList` renders beneath App through `<Outlet/>`. On a dashboard switch the panels state
  is still `status: "succeeded"`, with `items`/`loadedDashboardId` belonging to the previous dashboard, until that
  effect runs. In that state `showPanelGridSkeleton` is false: `status` is neither `loading` nor `idle`, and
  `restoringDashboardId` is null.
- **Backend**:
  - The list path is `DashboardRoutes.scala:40` -> `DashboardService.findAll` -> `DashboardRepository.findAll:57-68`
    (owner-only, `withUserContext`).
  - `panels.kind` is NOT NULL (`V94:1213`).
  - `panels_dashboard_id_idx` exists (`V1:21`).
  - There is a CHECK `panels_output_kind_requires_output_id` (`V94:844-846`), and no later migration drops it.
  - `DashboardService.findAll` also has two other callers: `WorkspaceSearchService.scala:86` and
    `WorkspaceContextService.scala:125`.
- **Spec delta**: the MODIFIED header matches `openspec/specs/mobile-dashboard-meta-line/spec.md` exactly, and every
  existing scenario is carried forward. The "absent when unknown" wording was correctly reconciled with HEL-1583's
  shipped reserved slot.

### Verdict: REFUTE

### Change Requests

1. **D2/D3: in the pre-dispatch frame of a dashboard switch, the flag is overwritten with `false`, which breaks the
   markdown-only -> pipeline-fed switch the spec requires.**

   D2 fires `dashboardPipelineFedObserved` "whenever panels are SETTLED for the selected dashboard (D3's predicate
   false)". D3's not-skeleton branch then uses `items` only if `panelsMatchDashboard`, and `[]` otherwise.

   What happens on a switch A -> B (B is pipeline-fed):
   - In the commit that changes `selectedDashboardId`, the panels state is still `succeeded`, with A's items and
     `loadedDashboardId = A`.
   - `showPanelGridSkeleton` is therefore false, so the D3 panel set for B is `[]`.
   - `PanelList`'s effect is a child effect, so it runs before App's `showDashboardPanels` effect
     (`App.tsx:177-183`). It sees `feedingOutputIds([]) = 0` against the stored `true` and dispatches
     `{B, false}`.
   - Then `fetchPanels.pending` shows the skeleton with the flag now false, so no slot is reserved and the cards jump
     27px. That is exactly the "Switching from a markdown-only to a pipeline-fed dashboard" scenario, and the
     pipeline-fed -> pipeline-fed case fails the same way.

   "Not the skeleton" is not the same as "these panels belong to the selected dashboard". Required revision:
   - Define a positive "panels settled for the selected dashboard" predicate. It is true when
     `panelsMatchDashboard(items, id)`, OR `items.length === 0 && loadedDashboardId === id && status === "succeeded"`
     (the existing `currentDashboardPanelsReady` shape at `App.tsx:105-110`).
   - Use that predicate both to gate the D2 refresh effect and to choose D3's branch: settled -> panel rule;
     otherwise (skeleton, OR the pre-dispatch frame with another dashboard's items) -> the flag.
   - Add unit cases for the pre-dispatch state: `status: "succeeded"`, another dashboard's items, flag true. The line
     should reserve and the flag should be left unchanged.

2. **The spec scenario "Unbound output panel" and the task 1.1 "unbound output -> false" test cannot be produced on
   the server.**

   `V94__outputs_model.sql:844-846` adds `CHECK (kind IS DISTINCT FROM 'output' OR output_id IS NOT NULL)`, and no
   later migration drops it. So a stored output panel always has an Output id, and the backend test fixture would be
   rejected by the DB. D1's "`output_id` is a nullable FK; NULL decodes to `""`" also omits this constraint.

   Required revision:
   - Remove that ADDED scenario, or restate it as a client-only invariant: the client `feedingOutputIds` treats `""`
     as unbound.
   - Drop "unbound output" from task 1.1's backend cases.
   - Note the CHECK in D1. The SQL can simply be `kind = 'output'`; keeping `output_id IS NOT NULL` is harmless.

### Non-blocking notes

- `DashboardService.findAll` is shared with the workspace search and context services. Compute the flag in a separate
  batched repo method called only on the `GET /api/dashboards` path, so those callers do not pay for an extra query.
  Run it in the same `withUserContext` (D1/Risks already say "set only by the list route"; keep the query there too).
- `showServerLayout` (`dashboardsSlice.ts:228`) may upsert a list-fetched dashboard, which carries the flag. That is
  fine with `withKnownFlag`, because it only fills a missing value.
- Pre-existing, outside this ticket: in the same pre-dispatch frame `PanelList` shows neither the skeleton nor the
  grid. With CR1's rule the refresh line will at least keep the slot steady through it.
