## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `819b3ac05f0bff88ce9b5c137b1ce4c9c88ff349`. The review base was resolved live with `resolve-review-base.sh` and is `27b4a7402` (origin/main, HEL-1776 merged). HEL-1776's own changes are therefore not in the reviewed diff. The diff is 109 files, +3895/-294.

### Fresh evidence (my own runs; no executor result was taken on trust)

| Gate | Result |
|---|---|
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 ("All matched files use Prettier code style!") |
| `npm run typecheck` | exit 0 |
| `npm test` (3 workers) | exit 0. Root 69 suites / 611 tests; frontend 857 suites / 10168 tests; 0 failed |
| `cd backend && sbt -J-Xmx3g testFull` (the full suite, nice 19) | `[success]`. Tests: succeeded 9994, failed 0, canceled 5. This run is after the executor's late import move. `DashboardGranteePanelRoutesSpec`'s 5 cases pass, and its `[HEL-1780 RLS]` lines match `rls-helio-app.txt` line for line |
| e2e `hel1780-…spec.ts` + `hel1773-…spec.ts` (Playwright 2 workers, lane DB `helio_hel1780`, DB_USER=matt, backend started by me with `ANTHROPIC_API_KEY=` empty, ports 7212/10119) | 13 passed |
| `npm --prefix frontend run build` | Not re-run separately. `tsc --noEmit` and the Vite dev build that the e2e served both ran clean. The executor's `build.txt` exists. Not load-bearing for the verdict |

**Independent mutations.** I ran these in a throwaway detached worktree at the reviewed SHA, then removed it. `git worktree list` is clean, and nothing was changed in WORKTREE_PATH.
- m7: role read from the selected dashboard, not the panel's. Red: 3 tests (usePanelReadScope x2, fetchPanelPage "the role of the PANEL's dashboard decides").
- Fail-open in `fetchPanelPage` (an unknown dashboard reads the Output route). Red: "a panel whose dashboard is absent from the store reads the per-panel route".
- m2: a non-control sort is sent to the server. Red: 5 tests (splitForPanelScope, nonOwner, usePanelSortFilter.panelScope).
- `quick` is sent to the server. Red: 3 tests.
- m10: every change dispatches. Red: D4(e) (i), (ii) and (iii).
- m8: insight Refresh is shown. Red: 2 PanelCard.panelScopeRefresh tests.
- D4(b2): the match count uses the server total. Red: the "1 result., never the 40-row server total" test.
- **The D5 hook key is mutated to `outputId`** (`useOutputFilterCapabilities.ts`: `const key = outputId;`). **GREEN.** Nothing catches it. See CR1.

**Independent UI checks.** I used a scratch copy of the hel1780 spec, run from the scratchpad and never written into the worktree:
- I added a step after the server sort. Quick search "East" shows "Filtered within the 200 loaded rows of 250." and hides the West cells. A zero-match quick search shows "No loaded rows match your filter. Only 200 of 250 rows were searched.". A filter on the non-control column `amount` works too. All three sent **0** rows requests. Afterwards the C11 invariant held: no /api/outputs or /api/pipelines request, no 4xx/5xx and no console error. This passed for the viewer and for the dual-grant user.
- Breakpoints for the viewer on the shared dashboard at 1440/1100/768/375 px: horizontal overflow is 0 px at each, and the invariant held at each. I checked the 1100 and 375 screenshots by eye: the control bar, Filters toggle, table and Load more all render.

### Phase 1: Spec Review — FAIL

- **AC coverage.**
  - Controls with distinct values work. Sort works on the server for control columns and in the browser otherwise. Cross-filter falls back to the client on a non-control dimension. History/compare sparkline, insight body and provenance work. The detail modal view shows controls and provenance. The insight Refresh is hidden. The role is read per panel. The dual-grant user is covered. History payload rows are unreachable.
  - All of these are implemented and observed, either in my e2e run or in my scratch run.
  - The RLS proof runs as the NOBYPASSRLS `helio_app_test` role (`TwoUserRlsApiFixture`, the same mechanism `DashboardSharedListRoutesSpec` uses):
    - Dashboard-only viewer and editor `SELECT outputs`: 0 rows.
    - Each per-panel route: 200 for viewer, editor and dual-grant; 404 for a stranger.
    - Payload rows: 404.
    - This was re-run by me inside `testFull`.
- **No AC silently reinterpreted.** R1–R4 and S1/S2 are honored. `PublicOutputControlScope` is unchanged. No backend production code, no route, no migration (C12).
- **Out-of-scope items untouched, verified in the diff.**
  - `usePanelRunRefresh` and `useDataInvalid` stay owner-only.
  - Warm restore is untouched.
  - The binding section stays read-only.
  - HEL-1776 popover files are untouched (C13). `ProvenanceTrigger.tsx` has a one-line `token ?? ""` removal only.
- **Tasks marked done but not matching (FAIL):**
  - **Task 3.3 / design D5.** The task requires a jest test where "two panels on one shared dashboard bound to one Output with different controls each follow their own capabilities". D10 also lists "`useCrossFilterServerOps` panel-scope decisions". What exists:
    - `filterCapabilitiesStore.panel.test.ts` exercises the store with hand-built keys.
    - `panelThunks.crossFilterKey.test.ts` exercises the thunk's 400 invalidation.
    - No test drives `useOutputFilterCapabilities` / `useCrossFilterServerOps` (or a card) in panel scope. `grep fetchPublicFilterCapabilities` over the tests finds only the store and service tests.
    - Result: the exact defect skeptic-design-1 CR1 was raised to prevent survives every gate. That defect is the hook keying per-panel capabilities by `outputId`, so two panels on one Output share one entry. My mutation above stayed green.
  - **D10 e2e.** The planned e2e step "quick search narrows loaded rows with no request" is absent, and so is any non-control column filter. The behaviour is correct (I verified it in scratch). But the AC says the e2e "exercises each feature above", and R4's quick-search and column-filter half has no e2e coverage. That half carries the only server `400` risk (`quick` is refused outright).
- **Task 3.7 is honestly reported** as "no hidden-feature assertions exist in hel1773". hel1773 passes 8/8 unchanged.
- **CONSTRAINTS (workflow-state.md):**
  - C1–C7 and C9–C13 are honored in the diff and in my runs.
  - C8 (red first) was not followed for the implementation, and files-modified.md says so openly. The substitute red proof is the e2e red on base plus mutations m1–m10. Assessment:
    - `e2e-red-base.txt` is genuine. Four tests are red at the first feature assertion, the `Team` combobox not found (feature hidden, the right reason). One test passes on base (the switch step), as stated.
    - e2e m1, m2, m3, m4, m5 and m8 are red at their own assertions.
    - m6 and m9 are red by test timeout: m6 waiting for the provenance button, m9 waiting for the per-panel distinct-values response. That is red for the stated reason, but not as a crisp assertion.
    - `mutations/jest-m9.txt` is a zero-test run ("Tests: 0 total"), which is non-evidence. It is not cited as m9's proof.
    - The mutation transcripts do not record the mutation diff applied, so they cannot be audited from the file alone. I re-derived m2, m7, m8 and m10 myself; all were red.
    - I accept the red proof, with the evidence-hygiene notes below.

### Phase 2: Code Review — FAIL

- **Gates.** All green (table above). `useCanUseOutputRoutes` has zero remaining hits (the helper is deleted, no dead helper).
- **The "13 failing jest tests, cause unknown" claim.** Check: was anything fixed by editing a test's assertions or a fixture? No assertion was weakened.
  - `jest-after-impl-full2.txt` shows the 13 failures in 8 suites:
    - `PanelGrid.remountReuse`
    - `PanelDetailModal.roles`
    - `PanelCardBody.roles`
    - `MobilePanelStack.detailOrigin`
    - `panelThunks.nonOwner`
    - `usePanelCardInspect`
    - `useOutputHistory.roles`
    - `InsightPanelBody.roles`
  - Every one of those files is in the reviewed diff, so the "fix" is visible.
  - The five `*.roles` / `nonOwner` files are the planned HEL-1773 hidden-feature assertions, inverted to the new behaviour. Each now asserts more, not less: the per-panel call with `undefined` token and `getOutputRows` not called.
  - The other three are fixture plumbing:
    - `PanelGrid.remountReuse`: `ownDashboardsInThisFile("d1")`.
    - `usePanelCardInspect`: a `useAppSelector: () => true` mock, for the owner path.
    - `detailOrigin`: the mock target moved from `ProvenanceTrigger` to the new `PanelProvenance` wrapper.
  - I extracted every non-import `+/-` line of every pre-existing test file in the diff. Apart from the files above, the changes are `dashboardId` added to `fetchPanelPage` args, store/seed swaps and header comments. There are no assertion changes.
- **D1 shim (`configureOwnedStore`, `ownDashboardsInThisFile`). Does it mask fail-closed?**
  - **Not in the current tree.** 19 files import the shim and 18 declare `ownDashboardsInThisFile(...)`. None of them contains a viewer/editor role, `accessRole: "viewer"|"editor"` or `DashboardAccessProvider` (grep: 0 hits in each).
  - Every new panel-scope suite builds its store with RTK's own `configureStore` plus explicit `accessRole` dashboards. These suites are panelReadScope, nonOwner, usePanelSortFilter.panelScope, PanelCard.panelScopeRefresh, TableRenderer.panelScope and crossFilterKey.
  - The fail-closed rule is independently proven red by my fail-open mutation.
  - **Residual risk, non-blocking:** a future non-owner test that imports `configureOwnedStore` and uses `"dash-1"`, `"dashboard-1"`, `"d1"`, `"dash-a"` or `"a"` would silently get owner scope.
  - Also, `renderWithStore.tsx:226-229` seeds declared ids as `{ id, name }` with no `accessRole`. Those read as owner only through `dashboardAccess.ts`'s "no accessRole, no ownerId ⇒ owner" fixture fallback, which is not an explicit owner seed.
- **Correctness of the core.**
  - `panelReadScopeFor` is fail-closed and is the one rule shared by the hooks, `fetchPanelPage` and `usePanelSortFilter`'s D4(e) skip.
  - `splitForPanelScope` is pure and well tested.
  - D4(e):
    - It compares against `lastQuery`, which `fetchPanelPage.pending` writes for page 0, so an in-flight page 0 is compared correctly (task 4.3a).
    - `lastFetchOk === false` still dispatches.
    - `panelQueryRecorded` never touches `latestFetchRequestId`.
  - The cross-filter 400 invalidates the scope's key.
  - The tokenless services omit `token` and never send `token=`. `useOutputHistory`'s `?? ""` is removed.
- **Type safety / security / error handling.** No new `any`. The `as never` casts are confined to the test helpers. No new trust boundary is introduced: the client sends only control columns, and the server still enforces C11.
- **DRY.** The distinct-values fork (`scopeDashboardId ? fetchPublicDistinctValues : getDistinctValues`) is duplicated in three places: `PanelCardBody.tsx:135-145`, `PanelFullscreenOverlay.tsx:162-171` and `usePanelDetailData.ts:43-52`. Non-blocking, see suggestions.
- **Dead code.** `PanelCardBody.tsx:115` `const filterOutput = output;` is now a pointless alias (it used to be the owner gate). Non-blocking.
- **Tests meaningful: FAIL.** CR1. The D5 per-panel keying at the hook, the thing the design added that key for, has no test that can go red.
- **File budgets.** `usePanelData.ts` is 504 lines (base 502), `panelThunks.ts` 471 (base 452), `panelsSlice.ts` 549 (base 540). All were already over ~400 before this change and the growth is small. Non-blocking.

### Phase 3: UI Review — PASS

Servers were started with the canonical `start-servers.sh` (fresh processes, `ANTHROPIC_API_KEY=` empty, lane DB). `assert-phase.sh servers` printed PASS. I stopped them with `stop-servers.sh` (`STOPPED ports=7212,10119`).

- **Happy path.** Viewer, editor and dual-grant feature passes are green. The editor's binding section is read-only ("Bound to an Output").
- **Unhappy/empty paths.** The zero-match client filter on a truncated table shows the new copy, not a bare "No rows match". There are no 4xx/5xx in any pass.
- **No console errors** in any flow, including my extra quick-search and breakpoint passes.
- **Entry points.** Desktop card, phone stack (390 px pass), detail modal and the switch shared → own → shared.
- **Accessible names.** "Team" combobox, "Data provenance", "Refresh <title>", "Filters", "Quick filter across all columns", "Filter column amount". Keyboard: Escape closes the provenance popover and the modal.
- **Breakpoints.** 1440 / 1100 / 768 / 375: 0 px horizontal overflow, invariant held.
- **C10 grep of `e2e/`** for "Not available on shared dashboards yet", "No rows match your filter", "loaded rows of", "No loaded rows", "Sorted within", "Filtered within" and "Panel controls": zero hits outside hel1780. "Data provenance" is an unchanged label, used by hel1762, hel1756 and hel1275. "View details" appears only in hel1773, which passes.
- **Note.** In commit 73b5950e1, the e2e opens the detail modal by clicking the card body instead of "View details", and reorders the two sorts. The reorder is correct under D4(e): changing a server sort to a client sort changes the server part and legitimately dispatches. Neither change weakens an assertion.

### Overall: FAIL

The behaviour is correct, the gates are green and the RLS proof is sound. Two planned tests are missing. One of them, the D5 hook-level per-panel keying, is a real regression hole that a mutation shows to be uncaught.

### Change Requests

1. **D5 / task 3.3: add a hook-level panel-scope cross-filter test that can go red.**
   - Add `frontend/src/features/panels/hooks/useCrossFilterServerOps.panelScope.test.tsx`, or a two-card `PanelCardBody` test.
   - Setup: one shared dashboard (`accessRole: "viewer"`) and two panels bound to the SAME `outputId`. Panel A's controls include column `team`; panel B's include `region`. Mock `fetchPublicFilterCapabilities` to answer per `panelId` (A: `team` with `eq`; B: `region` with `eq`). Activate a cross-filter on `team` from a third panel.
   - Assert:
     - (a) `fetchPublicFilterCapabilities` is called once per panel, with `(dashboardId, panelId)` and no token.
     - (b) A's mode is `server` and B's is `client-fallback`.
     - (c) `getFilterCapabilities` (the Output route) is never called.
   - Record red by mutating `useOutputFilterCapabilities.ts` `const key = scope.kind === "panel" ? panelCapabilitiesKey(...) : outputId;` to `const key = outputId;`. Today that mutation is green across all suites. Save the transcript, and include the diff of the mutation in the transcript.
2. **D10 e2e: add the R4 client-side filter steps** to `e2e/hel1780-shared-dashboard-panel-features.spec.ts` `featurePass`, after step 3:
   - Click the table's "Filters" button.
   - Fill "Quick filter across all columns" with `East`. Assert "Filtered within the 200 loaded rows of 250." is visible, West cells count is 0, and no new `watch.rowsRequests` entry.
   - Fill a no-match term. Assert "No loaded rows match your filter. Only 200 of 250 rows were searched." and still no request.
   - Clear it. Fill "Filter column amount" (a non-control column) and assert no request.
   - Clear and close Filters.
   - I ran exactly these steps in scratch against this HEAD and they pass for viewer and dual-grant, so this is test-only.
   - Show it red with a mutation that sends `quick` to the server (in `splitForPanelScope.ts`, add `quick: intent.filter?.quick` to the server `composeOutputRowsFilter` columns arg): the invariant should go red on the `400`. Save the transcript.

### Non-blocking Suggestions

- **Evidence hygiene.**
  - Delete or relabel `.concertino/scratch/HEL-1780/mutations/jest-m9.txt`. It is a zero-test run ("Tests: 0 total") and reads like evidence.
  - Prefix each mutation transcript with the `git diff` of the mutation applied, so the red can be audited from the file.
  - m6/m9 went red by test timeout. An explicit `expect(...).toBeVisible()` before the click / an explicit assertion would give a crisp line.
- **D1 shim.** `configureOwnedStore.ts:10`: consider dropping the hard-coded `OWNED_BY_DEFAULT` list and requiring each importing file to pass its ids. Also make `renderWithStore.tsx:229` seed `ownedDashboard(id)` (explicit `accessRole: "owner"`) instead of `{ id, name }`, so ownership does not rest on `dashboardAccess.ts`'s no-role fallback.
- **DRY.** Extract the three-way distinct-values fork into one helper, e.g. `distinctValuesFetcher(scope, panelId, outputId)` in `panelReadScope.ts`. Use it from `PanelCardBody.tsx:135`, `PanelFullscreenOverlay.tsx:162` and `usePanelDetailData.ts:43`.
- **Dead alias.** Drop `PanelCardBody.tsx:115` `const filterOutput = output;` and pass `output` directly.
- **Split the clash case.** `splitForPanelScope.ts:74-77` folds a control-column `crossFilterEq` into `ops` even when a control `eq` on the same column already exists. That is safe today, because callers pass `crossFilterEq` only in D5 `server` mode, which already excludes the clash. A guard or a comment would keep it safe if a caller ever changes.

Supporting artifacts (scratchpad, not persisted, not load-bearing; every claim above is restated as an assertion result) are in `/tmp/claude-1000/-home-matt-Development-helio/178232e2-92a2-44f9-8fb7-656468a7b746/scratchpad/`:
- `ev/` holds the gate logs and `sbt-testFull.txt`.
- `e2e/` holds the scratch spec and the `bp-*.png` breakpoint screenshots.
