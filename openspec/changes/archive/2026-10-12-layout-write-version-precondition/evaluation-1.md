## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `4a5864fe22ffa559628fbe60905545b7f9364434`. Diff base: `62164029270bcaadfc0fde2b0f43263cd1314b03`, resolved live with `resolve-review-base.sh`.
Evidence dir: `/home/matt/Development/helio/.concertino/runs/HEL-1457/` (all evaluator logs are prefixed `hel1457-eval-`).

### Gates, run fresh by the evaluator

| Gate | Result | Log |
|---|---|---|
| `npm run lint` | exit 0 | hel1457-eval-lint.log |
| `npm run format:check` | exit 0 | hel1457-eval-format.log |
| `npm run typecheck` | exit 0 | hel1457-eval-typecheck.log |
| `npm run check:schemas` | exit 0 | hel1457-eval-schemas.log |
| `npm test` | 48 + 575 suites, 454 + 6855 tests, all passed | hel1457-eval-jest.log |
| `sbt testFull` | 7395 passed, 0 failed, 4 canceled; `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0` | hel1457-eval-sbt-full.log |
| e2e: hel1457, hel1230, hel1028, hel1023 (DEV_PORT=6889) | 20/20 passed | hel1457-eval-e2e.log |

**Red-first check (C1), reproduced independently.** I made a throwaway worktree detached at the base commit and added only the HEAD versions of `DashboardLayoutConcurrencySpec.scala` and `ApplyProposalSpecBase.scala`. All 6 specs failed on the unfixed code, and they failed for the right reasons: 200 instead of 409, the rename reverted, md/xs reverted, and the placed y=99 item lost. Log: `hel1457-eval-red-base.log`, with `[hel1468-guard] failed=6`.

**Mutation check.** I applied these mutations on HEAD in the same scratch worktree (`hel1457-eval-mutation1.diff`):
- Removed the CAS predicate (`&& d.layoutVersion === cas.expectedVersion`). The in-flight race, unsent-breakpoint and auto-layout race specs went red.
- Removed the trigger's `ELSE NEW.layout_version := OLD.layout_version` pin. The "not settable" spec went red (999 was not equal to 1).

Log: `hel1457-eval-mutation1.log`. The scratch worktree has been removed.

**How the specs are built.** They run on `VerifiedEmbeddedPostgres.start`. The app pool uses role `helio_app_test` (NOSUPERUSER), so it does not bypass RLS. A second superuser connection holds `FOR UPDATE`, and the request is let through only after `pg_stat_activity` shows it waiting on a `Lock`. These are real concurrent transactions.

### Phase 1: Spec Review — FAIL

- All three acceptance criteria are met on the backend:
  - Layout PATCH and auto-layout carry a precondition and return 409.
  - Layout writes no longer rewrite name or appearance (`writeFields` writes only the supplied columns).
  - Tests cover the concurrent placement case and the rename case.
- Client part of AC 1 ("refetches and either reapplies or informs"): the reapply works, but the follow-through after it does not match design D7e/D7c (see below).
- Tasks are all checked. Task 4.3 claims D7e ("refetch panels when the adopted layout has unknown panel ids"). That is implemented in a way that does not refetch: see Phase 3, CR1.
- Constraints:
  - C1: honoured, verified above.
  - C2: honoured. V127 is the next free number on `origin/main` (highest there is V126). V122/V123 are untouched, and no in-flight sibling worktree claims V127.
  - C3: honoured. The CAS takes only the dashboard row lock and adds no panel locks.
  - C4: honoured. No inline FQNs in added Scala lines.
  - C5 (I1): I traced every store and hook path (keepLocal reducers, rename/appearance/upsert/fetch full replaces, class-3 extension, class-4 re-baseline, effect ordering of `storeLayoutVersionRef`, rebased-and-edited). The version sent is never newer than the layout it came from. The failure I found errs stale, not newer (CR2).
- No scope creep. Schemas are updated consistently: `dashboard.schema.json` requires `layoutVersion`, and both request schemas carry `expectedLayoutVersion` with minimum 0. Public dashboard routes do not use `DashboardResponse`, so no public allow-list is widened.

### Phase 2: Code Review — FAIL

Backend: no findings.
- Trigger: the WHEN clause fires on a layout change or an attempted version write. The function pins to OLD (+1 on a layout change). It mirrors V122's `SET search_path` and `ENABLE ALWAYS`, and it is the only trigger on `dashboards`.
- CAS: under READ COMMITTED it re-checks against the committed row. The read-back runs in the same transaction.
- `LayoutCasRetry`: an early 409 when the precondition is supplied, otherwise 3 bounded attempts.
- A supplied version that is stale returns 409 before any merge.
- Insert always writes 0.

Frontend: two defects, both in `useLayoutSave`'s handling of a 409 resolved by rebase. Both are user-visible and measured live (Phase 3).

- **CR1 (D7e not implemented).** `frontend/src/features/panels/hooks/useLayoutSave.ts:245-250` dispatches only `markDashboardPanelsStale(dashboardId)`. That action only resets `panels.status` to `"idle"` and clears `loadedDashboardId` (`panelsSlice.ts:174-183`). Nothing refetches the current dashboard's panels: `App.tsx:178-184` fetches only when `selectedDashboardId` changes, and every other caller follows the mark with `await dispatch(fetchPanels(dashboardId))` (`panelThunks.ts:113-114`, `:149-150`, `:182-183`).
  - Result: the other writer's panel is not rendered until a reload, and `panelsStatus` stays `"idle"`. That turns off `panelsLoaded` for later `buildLayoutPatch` calls and for `useStoredLayoutRepair`.
  - No test covers this. The e2e reloads before it counts grid items, which hides the defect.
- **CR2 (the adopted rebased response is misread as a local edit).** After a rebased retry succeeds with **no** edit during the round trip:
  1. The reducer adopts the response (fresh layout plus the other writer's appended items).
  2. The layout effect (`useLayoutSave.ts:154-197`) sees the previous store layout as an exact prefix of it. `detectPlacementExtension` therefore classes it as a class-3 placement extension: it extends the baseline, leaves `persistedVersionRef` unchanged, and sets pending to true.
  3. The effect has also set `latestLayoutRef` to the adopted layout. So the D7c check at `:235` (`!areDashboardLayoutsEqual(latestLayoutRef.current, nextLayout)`) wrongly concludes "edited during the round trip" and returns early.
  - Result: "Unsaved changes" and "Save now" stay on after a successful save. The next flush sends the stale version, takes another 409 and retries (measured). A `beforeunload` prompt would fire falsely.
  - It converges after one extra round trip and loses no data. I1 still holds because the error is a stale version, not a newer one. But it contradicts D7c ("adopt the response layout + version … it becomes the baseline") and the spec scenario "Drag after a concurrent agent placement … with no user-visible error".
  - The existing DesktopPanelGrid test (`DesktopPanelGrid.layoutConflict.test.tsx`, first `it`) never asserts `hasPendingLayout` after the rebased save, and never asserts that the next flush is a no-op.
- **CR3 (test name overclaims).** `backend/src/test/scala/com/helio/api/routes/dashboards/DashboardLayoutVersionSpec.scala:62` is titled "be 0 on a duplicate and on an import …" but only exercises duplicate. Task 3.7 also says "verify duplicate/import specs".

Other items, all fine:
- DRY/modularity: `LayoutCasRetry` is shared by both writers. `DashboardFieldWriteOps` is split out to keep the repository small.
- Type safety: `dashboardFromConflict` uses an `as Dashboard` cast after an object check. That is acceptable at a 409 boundary; see the suggestion below.
- Error handling: a non-409 failure still refetches and shows a toast.
- No dead code and no TODO/FIXME.

### Phase 3: UI Review — FAIL

I started the servers with `start-servers.sh` (6889/9796) and confirmed them with `assert-phase.sh servers`. The live probe used my own throwaway user `hel1457-eval-1791796834@example.test`, id `2cad3c2e-2844-4b6e-88f1-45047e0aa614`, checked first via `/api/auth/me`. It ran in an isolated headless Chromium context, because the shared MCP browser was logged in as another lane's (HEL-1515) user and I did not take over that session. Both probe dashboards were deleted by exact id. The servers were stopped by exact PID, and ports 6889/9796 are free.

- Happy path: drag, then Save now, is a single 200, and "Unsaved changes" clears (`pending-probe.log`, case a).
- Conflict path: the server side is correct. A drag plus a panel created through the API meanwhile, then Save now, gives PATCH 409 then 200. Both panels are stored and no error toast is shown.
- **CR1 observed:** after the 409 → 200, the grid still shows 1 item and the other writer's panel is not visible. It shows 2 only after a reload.
  - Probe log: `/home/matt/Development/helio/.concertino/runs/HEL-1457/evidence/.concertino/runs/HEL-1457/hel1457-eval-probe/d7e-probe.log`
  - Screenshot: `/home/matt/Development/helio/.concertino/runs/HEL-1457/evidence/.concertino/runs/HEL-1457/hel1457-eval-probe/hel1457-d7e-after-save-no-reload.png` (one panel; header still shows "Unsaved changes" / "Save now").
- **CR2 observed** in `/home/matt/Development/helio/.concertino/runs/HEL-1457/hel1457-eval-probe/pending-probe.log`, case b:
  - After 409 then 200, unsaved is still 1.
  - The second Save now fires another `409 | 200`, after which unsaved is 0.
  - This is self-authenticating evidence: the network status sequence and indicator counts, not mtimes.
- Console: the only console error is the browser's own "Failed to load resource … 409" line for the expected conflict response. No app exceptions.
- Breakpoints and accessibility: the diff adds no markup, CSS or interactive elements. Rendering is unchanged, so no breakpoint regression is possible from this diff. The affected e2e specs (including hel1028's xs case) pass.

### Overall: FAIL

### Change Requests

1. **Refetch the panels when an adopted layout names unknown panels (D7e).** In `frontend/src/features/panels/hooks/useLayoutSave.ts:245-250`, after `dispatch(markDashboardPanelsStale(dashboardId))`, also dispatch `fetchPanels(dashboardId)`, the same pattern as `panelThunks.ts:113-114`. Add a test that fails without it, for example in `DesktopPanelGrid.layoutConflict.test.tsx`: assert that the panels `fetchPanels` service mock is called with `"d1"` after the rebased save adopts `panel-2`. Extend `e2e/hel1457-stale-tab-layout-save.spec.ts` to assert `.react-grid-item` count 2 **before** `page.reload()`.
2. **Do not misread an adopted save response as a placement extension or a local edit (D7c).** In `useLayoutSave.ts`, the decision "edited during the round trip" must not use `latestLayoutRef` after the layout effect may already have replaced it with the adopted response. One approach: mark the adopted response layout (for example, a ref set to `action.payload.layout` that the layout effect checks first and re-baselines with the version as class 4, like `localCommitRef`). Alternatively, decide adoption from the store, i.e. whether the store's current layout equals `dashboard.layout`, rather than from `latestLayoutRef`. Either way the result must be: after a rebased save with no edit in between, `persistedLayoutRef` and `persistedVersionRef` equal the response and pending is false. Add a jest test that runs the real component ordering (rebased save, no second drag) and asserts all of:
   - `store.getState().dashboards.hasPendingLayout === false`
   - a following `flush()` sends no PATCH
   - the existing second-drag case still sends the old version first.
3. **Fix the overclaiming test name.** In `backend/src/test/scala/com/helio/api/routes/dashboards/DashboardLayoutVersionSpec.scala:62`, either add an import assertion (`POST /api/dashboards/import` of an export taken from a dashboard with `layoutVersion > 0`, then `versionOf(imported) shouldBe 0L`) or rename the test to "be 0 on a duplicate".

### Non-blocking Suggestions

- `layoutConflict.ts:isLayoutConflict` treats any 409 as a layout conflict. Consider requiring `dashboardFromConflict(err) !== null` (or the server message) so a future unrelated 409 on `/update` is not rebased.
- The migration comment says "unforgeable". That is accurate for UPDATE only: INSERT can still set any value. Today the app always inserts 0, so this is fine, but a one-word qualifier ("on UPDATE") would make the claim exact. Do not edit V127 once it has been applied anywhere; any wording fix belongs in this unmerged commit only.
- The throwaway user `2cad3c2e-2844-4b6e-88f1-45047e0aa614` still exists in the shared dev DB; its dashboards are deleted. The evaluator does not hold DB credentials (it never reads `backend/.env`), so leave its removal to the run's normal user cleanup.
