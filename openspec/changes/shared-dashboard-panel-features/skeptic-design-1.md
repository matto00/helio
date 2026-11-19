## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: HEAD 62df9ff487cf7dbf08b3e51ccbc8804ccf77a73a (the change directory is untracked; artifacts read from disk).

### What I verified (with evidence)

**The per-panel routes can serve every in-scope feature for a signed-in grantee with no token. Confirmed.**
- `PublicDashboardRoutes.scala:63-205`: `rows` (sort/filter), `filter-capabilities`, `distinct-values`, `output-meta`, `history`, `insight`, `provenance` each take `"token".optional` behind `aclDirective.authorizeResourceWithSharing`. They are mounted under `optionalAuthenticate` (`ApiRoutes.scala:950-952`) with history, insight and provenance services all wired. Provenance is `Option(pipelineRunRepo).map(...)` (`ApiRoutes.scala:589`), and the RLS fixture passes `pipelineRunRepo` (`TwoUserRlsApiFixture.scala:155-171`), so provenance is live in the D9 harness too.
- Data reads after the gate do not depend on the caller's RLS: `PublicPanelOutputResolver` uses `outputRepo.findByIdInternal`, `OutputHistoryRepository.listRecent` and `OutputInsightRepository.latestOk` run in `ctx.withSystemContext`, and `ProvenanceService` reads `*Internal`. So a dashboard-only grantee (0 rows on `outputs` under `helio_app_test`, per `DashboardSharedListRoutesSpec` step (3)) is served.
- Insight `latestOkFor` returns `Option[Option[...]]`. A missing render is `200 {render:null}` and a non-insight Output is `404`, which matches CLAUDE.md.

**The C11 boundary is as the design states.** `PublicOutputControlScope.scala` rejects a non-empty `quick` outright, rejects any `filter.columns` key or `ops[].column` outside `panel.config.controls`, and limits `sort` to control columns. The server's allow-list is `panel.config.controls` including orphaned controls (`PublicPanelRowsResolver.scala:66-67,120,135`). The client's `panel.config.controls` carries the same set, so a split keyed on it agrees with the server.

**History payload rows stay unreachable.** The per-panel history uses `OutputHistoryResponses.public` (summary-only), and no per-panel payload route exists. Specs `OutputHistoryPayloadPublicRoutesSpec` and `OutputHistoryPublicRoutesSpec` already exist to extend. D9(c) adds the `helio_app` 404 for `/api/outputs/:id/history/:point/rows`.

**The RLS proof plan is sound.** D9 uses the `TwoUserRlsApiFixture` / `helio_app_test` mechanism that `DashboardSharedListRoutesSpec.scala:141-200` uses, with each statement labelled by role. It explicitly refuses a local e2e 200 as proof (D10). One caveat: the fixture seeds only three users (A/B/C, `TwoUserRlsApiFixture.scala:69-71`), so the dual-grant and stranger cases need reuse or one more user (non-blocking).

**The gated call sites match the design.** `grep useCanUseOutputRoutes` returns exactly the nine sites D1 lists, plus the definition. `fetchPublicPanelRows` already accepts `sort`/`filter` and omits a missing token (`publicDashboardService.ts:49-66`). `fetchPublicFilterCapabilities` and `fetchPublicDistinctValues` require `token: string` today, as D2 says.

**Table persistence is safe for grantees.** `TableRenderer.tsx:51` sets `canWrite = ownerId === currentUserId`, and the per-panel meta stub has `ownerId: null`. A grantee's sort therefore never reaches `persistColumnSort` (`PATCH /api/outputs/:id`).

**The owner rulings are respected.** R1 to R4 are reflected without contradiction. S1 (hide the insight Refresh) is one of the two options the AC allows.

**Scope fits one lane.** The work is about 20 frontend files, backend tests only, one new e2e plus updates to the HEL-1773 e2e. That is comparable to HEL-1773.

### Defects found in the plan

**F1. Filter-capabilities cache is keyed by Output, not panel (D5).** `filterCapabilitiesStore.ts` keys `entries` by `outputId`. It fetches through `getFilterCapabilities(outputId)` (an Output route), and the thunk's 400 path calls `invalidateCapabilities(outputId)` (`panelThunks.ts:441-443`). D5 only says `useOutputFilterCapabilities` "gains a per-panel source"; it never says how that source is keyed. Per-panel capabilities are narrowed per panel, so two panels bound to the same Output with different controls get different capabilities. That can happen on one shared dashboard, for a plain viewer, no dual grant needed.

If the per-panel source is keyed by `outputId`:
- panel Y can read panel X's capabilities, take `server` mode for X's control column, and get a `400` from Y's per-panel rows route. That breaks C11.
- the `CROSS_FILTER_EQ_REJECTED` self-heal invalidates the wrong key, so the explicit-path mode never flips.

The same collision exists between an owner-scope entry and a panel-scope entry for a user who can see the Output both ways.

**F2. The split's choke point is under-specified (D4).** There are four `fetchPanelPage` dispatch sites:
- `PanelCardBody.tsx:200` (Load more)
- `usePanelSortFilter.ts:143`
- `usePanelData.ts:326` (initial, refresh and replay of `replay?.sort` / `replay?.filter`)
- `usePanelData.ts:360` (the `CROSS_FILTER_EQ_REJECTED` retry)

D4 names only `usePanelSortFilter` and `handleLoadMore` as intent producers. It also says the hooks "keep producing the same intent", while "the non-owner branch forwards server.sort/server.filter". That can be read two ways: split in the hooks, or split in the thunk. Read the first way, the replay and retry paths escape the split.

D4 also does not say what the thunk does with `crossFilterEq` in panel scope. Today it silently drops it (`panelThunks.ts:388-410`). D4/D5 need it forwarded only when its column is a control column.

The "no per-panel rows request names a non-control column or `quick`" invariant only holds if the split is enforced at the one point every path goes through.

**F3. Two routing rules can disagree (D1 vs the thunk).** D1 adds `usePanelReadScope` with the HEL-1773 fail-closed rule: unknown dashboard → viewer → `panel` scope (`selectDashboardAccessRole` / `dashboardAccessRole`). `fetchPanelPage` keeps its own routing decision, `isKnownNonOwnedDashboard(state, scopedPanel.dashboardId)`, which fails **open**: an unknown dashboard, or a panel missing from `state.panels.items`, falls through to `GET /api/outputs/:id/rows` (`panelThunks.ts:393-394`, `dashboardAccess.ts:68-79`).

So a card can be in `panel` scope, split its intent, and still have its request routed to the Output route. D1 claims "role read per panel" closes the switch hazard but leaves this second, differently-failing rule in the path. D1 also does not mention the other routing state keyed per Output rather than per panel: `outputMetaCache.panelScopes` (outputId → scope, toggled by `fetchPanels` at `panelThunks.ts:85-86` and by `showDashboardPanels.ts:65`) and `filterCapabilitiesStore` (F1).

### Verdict: REFUTE

These are small revisions to design.md (and, where noted, tasks.md). None of them reopens an owner ruling.

### Change Requests

1. **D5 / D2: key per-panel capabilities by panel (fixes F1).** The per-panel filter-capabilities source must be keyed by `(dashboardId, panelId)`, the way `publicProvenanceKey` / `publicHistoryKey` already are. It must never share an `outputId` key with the Output-route entry. The thunk's cross-filter `400` path must invalidate the key of the scope that made the request: the per-panel key in panel scope, `outputId` in output scope. Add a jest case to task 3.3: two panels on one shared dashboard, bound to the same Output, with different controls. Assert that each panel's cross-filter mode follows its own capabilities and that the 400-invalidation hits the right key.

2. **D4: enforce the split in the thunk (fixes F2).** State that `splitForPanelScope` runs inside `fetchPanelPage`'s panel-scope branch, using the scoped panel's `config.controls`. That covers all four dispatch sites, including replay and the cross-filter retry, so no caller can bypass it.
   - Specify what the thunk does with `crossFilterEq` in panel scope: fold it into `ops` only when its column is a control column; otherwise drop it from the request. The client-fallback filter still applies.
   - Specify what `paginationState` records, so replay and the TableRenderer client part stay consistent. The full intent is the expected answer, with the split applied on dispatch.
   - Add to task 3.2: a jest case per dispatch site (initial/replay, sort change, load more, cross-filter retry) asserting the per-panel request carries no non-control column and no `quick`.

3. **D1: one routing rule for the thunk and the hooks (fixes F3).** Make `fetchPanelPage`'s Output-vs-per-panel decision follow the same rule as `usePanelReadScope`. For example, the caller passes the panel's `dashboardId` (or the scope) in the thunk args, and the thunk fails closed the way `selectDashboardAccessRole` does. A panel missing from `state.panels.items`, or a dashboard missing from the store, must not silently fall through to `/api/outputs/:id/rows` while the hook believes it is in panel scope.
   - In D1, list the Output-keyed seams and say whether each is changed or knowingly left as is, with the reason: `outputMetaCache.panelScopes`, `filterCapabilitiesStore` (see CR1) and `insightChromeStore`. Leaving `outputMetaCache` as HEL-1773 shipped it is acceptable if stated. The only users who can see one Output both ways are those who can already read it through the Output route.
   - Add a jest case to task 2.1: `fetchPanelPage` for a panel whose dashboard is absent from the store does not call `getOutputRows`.

### Non-blocking notes

- **S1 rationale.** S1 says "there is no grantee-safe refresh", and that is inaccurate. The owner's card-header icon is a free re-read of the stored insight (`PanelCard.tsx:117-120`; `InsightPanelBody.tsx` comment "the card header's icon is the free re-read"). The paid action is the in-body "Update insight" button, which goes through `refreshOutputInsight`. A grantee-safe re-read through the per-panel insight route is possible. Hiding the control is still allowed by the AC and is owner-confirmed, so this does not block. Correct the wording so it does not mislead.
- **D6: remove the empty-token fallback.** `useOutputHistory.ts` calls `fetchPublicOutputHistory(..., publicToken ?? "")`. When `HistorySource.token` becomes optional, that `?? ""` must be removed, not kept. A `token=` empty string reaches `authorizeResourceWithSharing` as `Some("")`. The D2 jest "omits `token`" case should include history.
- **D4 wording.** It says "extend its signature with sort/filter", but `fetchPublicPanelRows` already takes `sort`/`filter`. Harmless.
- **D10 switch step.** `/api/pipelines/*` URLs carry pipeline ids, not Output ids, so the attribution check needs the shared pipeline ids as well. The owned dashboard in that step should use different Outputs and pipelines from the shared one, so attribution is unambiguous.
- **D10 mutation m7.** If m7 cannot be shown red in the e2e (panels may unmount before an effect fires), the D1 jest test (shared panel A mounted while owned dashboard B is selected) must be recorded as the red proof instead. Do not claim m7 from a green-then-assumed e2e.
- **Spec delta.** It has no quick-search scenario for R4, and quick search is the case the server answers `400`. Consider adding: "quick search on a shared table narrows loaded rows and sends no `quick`."
- **D9 fixture users.** The fixture has three users. Plan who is the dual-grant user and who is the stranger for each route; the existing spec makes a stranger by reusing B against an ungranted dashboard.
- **HEL-1776.** `ProvenanceTrigger` changes must stay limited to its props and fetcher, as the design says. Keep away from the `shared/ui` popover files.
