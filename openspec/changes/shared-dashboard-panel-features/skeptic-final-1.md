## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `cca5bee99b8a8d29faa88aa08ee1bcea7d4dd1b9`. I resolved the review base live with `resolve-review-base.sh`: `27b4a7402` (origin/main, HEL-1776), exit 0. The diff is 111 files, +4289/-302. It changes no backend production file and no CSS file.

### What I verified (with evidence)

**Core invariant: routing is decided per panel and fails closed** (read in code)
- `panelReadScopeFor` (`state/panelReadScope.ts`) returns `output` only when `selectDashboardAccessRole(state, panel.dashboardId) === "owner"`. Any other result, including a dashboard missing from the store, is `panel` scope.
- `fetchPanelPage` now takes `dashboardId` as a required argument and routes with that same function. All four dispatch sites pass `panel.dashboardId`: `usePanelData` initial load and the cross-filter retry, `usePanelSortFilter`, and `PanelCardBody` Load more. The old `items.find` fall-through to `GET /api/outputs/:id/rows` is gone.
- `useCanUseOutputRoutes` is deleted, and grep finds zero production references.
- Every former gated site now reads `usePanelReadScope(panel)`. That covers PanelCard, PanelCardBody, the fullscreen overlay, the detail modal and its data hook, MobilePanelStack via `PanelProvenance`, the cross-filter hook and inspect.
- Owner-only Output-route features stay gated on `scope.kind === "output"`: the data-invalid badge (`useDataInvalid`), `usePanelRunRefresh`, `insightChromeStore` feeding, `usePipelineOwnership`, the in-body "Update insight" button (`!isPublic`), the "open Output" navigation, and `OutputPanelSection` / `OutputControlsEditor` (editors see the read-only "Bound to an Output").

**`useOutputHistory` gate removed: checked for leaks**
- The old owner check is gone (`enabled = enabledRequested`), so every caller must pass a history source in panel scope.
- Callers in the authenticated tree: MetricOutputPanel and ChartOutputPanel (via OutputPanelContent's `historySource`). PanelCardBody, the fullscreen overlay and the detail modal all pass `useHistorySourceFor(scope)`, which is defined in panel scope.
- `useLiveOutputBaseline` is in the pipelines feature, which only the owner reaches.

**R4 split: no non-control column or quick search reaches the per-panel route**
- `splitForPanelScope` sends the server only these terms:
  - a sort on a control column;
  - column filters on control columns;
  - control ops filtered to control columns;
  - the cross-filter `eq` only on a control column, with a clash guard.
- `quick` always stays on the client.
- The split is enforced inside the thunk. A panel missing from state gets an empty control set, so the request carries no sort or filter.
- D4(e): a change that only affects the client part records the new intent (`panelQueryRecorded`) and sends no request.

**Backend proof as NOBYPASSRLS — re-run by me, not taken from the reports**
- Command: `sbt -J-Xmx3g "testOnly ...DashboardGranteePanelRoutesSpec"`. Result: 5 succeeded, 0 failed, exit 0. Persisted at `.concertino/runs/HEL-1780/evidence/.concertino/scratch/HEL-1780/skeptic/backend-spec.txt`.
- The fixture's app pool is `helio_app_test`, created `NOSUPERUSER NOBYPASSRLS` (TwoUserRlsApiFixture:127).
- The spec covers each per-panel route the client uses: rows, rows with a control sort, rows with a control filter, filter-capabilities, distinct-values, history, insight, provenance.
- Results, matching the persisted `rls-helio-app.txt`:
  - Viewer, editor and dual-grant user: 200 on every route.
  - Stranger: 404 on every route. A grantee on an ungranted dashboard: 404.
  - Non-control sort, non-control filter and `quick`: 400. This is why the client must never send them.
  - `SELECT outputs` as `helio_app_test`: dashboard-only viewer 0 rows, dashboard-only editor 0 rows, owner 1 row.
  - `GET /api/outputs/:id/history/:point/rows` and `GET /api/outputs/:id/rows` for a dashboard-only viewer: 404.
- The per-panel history body has no `"id"` and no `hasPayload` (asserted), so no payload-rows link can render. No per-panel payload route was added (no backend production diff).

**e2e — re-run by me on fresh servers**
- Setup: `ANTHROPIC_API_KEY=` empty, `DATABASE_URL` set to the lane DB `helio_hel1780`, `DB_USER=matt`, DEV_PORT=7212 and BACKEND_PORT=10119 pinned, 2 workers.
- Result: `hel1780` + `hel1773`: 13 passed, exit 0. Persisted at `.../skeptic/e2e.txt`.
- I read the spec. Every feature pass (viewer, editor, dual-grant, phone) asserts:
  - zero requests whose path matches `^/api/(outputs|pipelines)(/|$)`;
  - zero `/api` responses with status 4xx/5xx;
  - zero console errors.
- It also asserts that client-only sorts, quick search and non-control filters send no rows request, that no rows request names `amount` or `region`, and that the cross-filter falls back to the client.
- The switch step (shared → own → shared) asserts that no Output or pipeline route names a shared Output, a shared pipeline id or the owner id.

**Jest — re-run by me** on the new and reworked suites: 17 suites, 80 tests passed.
- The suites cover: panelReadScope (fail-closed; panel's own dashboard versus the selected one, both directions), splitForPanelScope, TableRenderer panelScope, the usePanelSortFilter panelScope / D4(e) cases, PanelCard panelScopeRefresh, the per-panel key in filterCapabilitiesStore, the crossFilterKey thunk, publicDashboardService omitting `token`, useCrossFilterServerOps panelScope (two panels on one Output), panelThunks.nonOwner, and the roles suites.
- I took lint, typecheck, format, build and the full jest run (858 suites) from evaluation-2's pasted results. Its mutation transcripts start with their diffs. I did not re-run those mutations, because doing so requires modifying code.

**Acceptance criteria traced**
- Controls, filter capabilities, distinct values, rows with sort and filter: `distinctValuesFetcher`, `useOutputFilterCapabilities` (per-panel key), and the thunk split. Covered by e2e steps 1–3b.
- Cross-filter: R2 client fallback for a non-control dimension, server only for a control column. Covered by e2e step 6 and the hook jest.
- History and compare sparklines: `historySource` is threaded through. Covered by e2e step 4.
- Insight bodies: the "Not available" placeholder branch is removed, the body reads the per-panel insight, and the citation chip uses the public variant. Covered by e2e step 4.
- Provenance: `PanelProvenance` in the card, the phone stack and the detail modal, plus the overlay trigger. Covered by e2e step 5.
- Detail modal view mode: controls and provenance. Covered by e2e step 7.
- Insight Refresh hidden: `showRefresh` fails closed while the kind is unknown. Covered by e2e and PanelCard jest.
- Role read per dashboard: D1. Covered by jest (m7) and the e2e switch step.
- Dual-grant user tested: e2e and backend spec.
- No payload rows for a viewer, and RLS checked as the NOBYPASSRLS role with a stranger 404 on every route: backend spec.

**UI and design judgment**
- No CSS file changed. New visible text reuses existing classes and components: `panel-content__loaded-scope-note`, the DataGrid empty state, OutputViewerControlBar and ProvenanceTrigger.
- The new copy is sentence case and plain: "Sorted within the {loaded} loaded rows of {total}.", "No loaded rows match your filter. Only {loaded} of {total} rows were searched."
- I looked at the e2e screenshots (persisted):
  - `.concertino/runs/HEL-1780/evidence/e2e-evidence/HEL-1780/viewer-shared.png`: the shared card shows the Team control, the Filters toolbar, a server-sorted `team ^` header, the footer provenance icon and Refresh on a non-insight card.
  - `viewer-phone.png`: the control and provenance sit beside the title in the stack.
  - `editor-shared.png`: the detail modal shows the control bar and the provenance icon.
- The grantee surfaces match the owner's, because they are the same components with the same markup.

### Verdict: CONFIRM

### Non-blocking notes
- **Detail modal label touches the edge.** In `editor-shared.png` the modal's "TEAM" control label sits flush against the modal's left edge, with no inset. The `OutputViewerControlBar` markup in `PanelDetailModal` is identical at base 27b4a7402, so owners see the same thing today. It is not introduced here, but grantees now see it too. Worth a polish ticket.
- **Light theme not checked live.** I did not toggle to light theme on a live grantee session; the evidence screenshots are dark. With no CSS change and only existing shared components and classes reused, the light/dark parity risk is the same as the owner's surfaces.
- **Clash guard has no test.** The `splitForPanelScope` clash guard (lines 72-76) has no jest case. Evaluation-2 also noted this: removing the guard leaves every suite green.
- **Test helper is looser than the design.** The D1 fixture shim, `configureStoreOwning(...ids)`, is a slightly looser form than the design's "explicit seeding per file". It has been disclosed and hardened (no default list), so it is acceptable.
- **No red run before implementation.** The implementation was written before any red run (C8 deviation, disclosed). The red proof is the e2e run red on base code (4 of 5 tests, failing for the right reason) plus the mutations. I accept it: the jest suites for the logic that matters (fail-closed routing, the split, D4(e)) have recorded mutation reds that start with their diffs.
- **Gate defect check: none.** No evidence in this round rests on mtime ordering.
- **Servers stopped:** `STOPPED ports=7212,10119`.
