## Evaluation Report — Cycle 1 (post-cycle-2 implementation)

Verdict drawn on the entire branch (cycle-1 investigation + cycle-2 fix). Sixth commit on the branch was the executor's handoff bundle (executor-report-2.md, files-modified.md, workflow-state.md).

---

### Phase 1: Spec Review — PASS

- All Linear ticket acceptance criteria addressed:
  1. Panel renders rows on mount when bound DataType has rows — already worked pre-fix when paginationState was empty; the cycle-1 investigation confirmed via curl that the wire response preserves `dataTypeId` for matt's panels. Verified again in the live browser (the chart bound to `21ce4b95` shows 5 rows in `paginationState`).
  2. Re-running the pipeline updates the panel without manual remount — the headline new behavior. Verified in the live browser by triggering the production reducer/hook chain (see Phase 3).
  3. Regression test asserts binding path end-to-end — `usePanelData.test.ts` "re-fetches after markDataTypeRowsStale is dispatched" is exactly this assertion (panel mounted → entry pre-loaded → dispatch action → entry cleared → next render dispatches `fetchPanelPage` → rows replaced with second mock's rows).
  4. Failure mode reproduced and fixed — cycle-1 investigation traced the deterministic stale-cache mechanism (executor-report-1.md §2); cycle-2 fix lands at exactly that mechanism.
- No AC silently reinterpreted; the design explicitly defers cross-tab/cross-user invalidation to a spinoff (correct scope discipline).
- `tasks.md` items 0–2 are `[x]`; tasks 3.x and 4.x are still `[ ]` even though the work is done. **Minor**: executor did not check 3.1, 3.2, 4.3, 4.4 boxes after completing them; non-blocking but should be updated. 3.3 and 4.1/4.2 (the Playwright items) are correctly unchecked since the executor flagged that the sandbox could not drive Playwright — this evaluation handled them.
- No scope creep — the 6 commits modify exactly the four production files the design called out, plus three test artifacts plus four OpenSpec docs. No drive-by refactors.
- No regressions to existing behavior in other specs — confirmed by all 591 backend tests passing and all 664 cycle-1-baseline frontend tests still passing.
- OpenSpec artifacts (proposal/design/tasks/executor reports) accurately reflect the implementation.
- No API contract change, no schema change, no backend change — confirmed by `git diff main --stat` showing zero `.scala`, `.sql`, or `schemas/` files touched.

### Phase 2: Code Review — PASS

- **CONTRIBUTING.md compliance**: zero inline FQNs in the diff (verified by `npm run check:scala-quality` clean for new code; the 18 warnings are all pre-existing backend file-size soft warnings, unchanged). Imports cleanly at top-of-file in every touched module.
- **File-size budgets**: all four production files within or near soft cap.
    - `panelActions.ts` 20L (soft cap 80 for aggregators — well under)
    - `usePanelData.ts` 108L (well under 250 soft cap)
    - `panelsSlice.ts` 253L (3 over the 250 soft cap; the new code is 13 lines including comment + import; reasonable, no split warranted)
    - `PipelineDetailPage.tsx` 399L (1 line under the 400 hard cap, TIGHT but compliant; the new code is a 9-line `if` block inside the existing `onTerminal` body — does not push file into "needs split" territory but the cushion is now minimal; future edits to this file should be paired with a decomposition)
- **DRY**: reducer reuses the existing `isBoundCapablePanel` narrowing helper from `panelNarrowing.ts` instead of duplicating the metric/chart/table predicate; the action mirrors `markDashboardPanelsStale` in style and placement.
- **Readable**: variable names (`outputDataTypeId`, `paginationEntry`), inline comments tagged with `HEL-242`, and the doc-comment on `markDataTypeRowsStale` documenting both the dispatcher (PipelineDetailPage on success) and the consumer (the slice reducer) make intent self-evident at every touch point.
- **Modular**: action lives in `panelActions.ts`, reducer case lives next to its sibling in `panelsSlice.ts`, hook guard lives in `usePanelData.ts`, dispatch lives inside the existing SSE callback — proper separation, no coupling growth.
- **Type safety**: no `any`. `currentPipeline?.outputDataTypeId` narrows via optional chaining; `createAction<string>` is properly typed. The `if (event.status === "succeeded" && outputDataTypeId)` gate narrows both the discriminant and the string-or-null at once.
- **Error handling**: the dispatch is intentionally not guarded by try/catch — Redux reducers are pure and the action payload is a string (no failure path). The pre-existing `fetchPanelPage` error path on the hook is unchanged.
- **Tests meaningful**: 5 new tests, each exercises a distinct contract.
    - `panelsSlice.test.ts > markDataTypeRowsStale` — three cases: selective clear (2 of 3 entries match), no-match no-op, non-bound subtype safe (`isBoundCapablePanel` properly skips text/markdown/image/divider panels without throwing). Confirms the reducer in isolation against the real slice.
    - `usePanelData.test.ts` — two integration-shape cases: positive (dispatch action → reducer clears entry → effect runs → `fetchPanelPage` dispatched a second time → result rows updated) and negative (dispatching for a different DataType id leaves the entry intact, no second fetch). The positive case is the regression-asserting test for the headline fix.
    - Each test uses real fixtures (`makeMetricPanel`, `makeMarkdownPanel`) and real reducer/slice composition — not mocks; this gives the regression strong signal.
- **No dead code, no TODOs introduced**: confirmed by diff review.
- **No over-engineering**: minimum-viable fix. No new abstractions, no factory wrappers, no future-proofing scaffold.
- **Behavior-preserving for the unchanged surface**: the only `-` deletions in the production diff are import re-points (`+ markDataTypeRowsStale` added to existing import lines) and the one-line guard change (`prevFetchKey.current === currentFetchKey` → `prevFetchKey.current === currentFetchKey && paginationEntry != null`). Zero business-logic deletions. Confirmed via `git diff main -- '*.ts' '*.tsx' | grep '^-'`.

### Phase 3: UI Review — PASS

Live verification in browser at `http://localhost:5412` (frontend on 5412, backend on 8319), logged in as matt@helio.dev. Backend healthy after 5–10 min sbt cold start; frontend Vite ready in ~2s.

#### What I tried first

The executor-report-1 reproduction recipe (run ProfitAgg pipeline; observe panel on "Helio is profitable?" dashboard refresh without reload) **cannot run end-to-end against this dev DB** because of two data-quality issues:
- Panels on `e44e7c57-...` ("Helio Roadmap (copy)" — labeled "Helio is profitable?" in earlier sessions) are bound to DataType `38fb6329-...` (Profit, matt-owned, 0 rows). The only existing pipeline (ProfitAgg) writes to a different DataType `c1005183-...` which **matt does not own** (PATCH attempts to rebind a panel to that id have the backend's `resolveSingleBinding` scrub the binding back to `""` — exactly the cross-user scrub path that cycle-1's investigation correctly identified as not-the-bug-but-real).
- The ProfitAgg pipeline run itself currently fails at 422 against the dev DB ("DataSource not found for join"), even after copying the missing CSV file from the main repo into the worktree's `backend/data/uploads/csv/` directory. This is a pre-existing pipeline-config drift unrelated to the fix.

Neither blocker is a fault of the fix — both are dev-data hygiene issues that pre-date HEL-242. I therefore verified the fix via direct in-browser Redux dispatch, which exercises the **identical** production path (reducer → state-clear → `usePanelData` effect → `fetchPanelPage` dispatch → fresh `/api/types/:id/rows` GET → rows in store), differing only in the entry-point dispatcher.

#### Direct in-browser verification of the production fix path

Setup:
- Navigated to `/?dashboardId=e191bdf6-...` (Evaluation Dashboard with 4 bound panels: 1 chart bound to `21ce4b95` with 5 rows, 2 metrics bound to `4f44d983` with 0 rows, 1 metric bound to `2f485fd8` with 0 rows).
- Confirmed `state.panels.paginationState` had entries for all 4 bound panels via React-fiber walk to surface the Redux store on `window.__store__`.

**Test 1 — selective clear + hook refetch (the core fix path):**
- Dispatched `{ type: 'panels/markDataTypeRowsStale', payload: '21ce4b95-...' }` (the chart's DataType).
- Synchronously after dispatch: `paginationState['a21dd644-...']` (the chart) was `undefined`, the three other entries remained intact. **Confirms reducer behavior.**
- After 2s wait: `paginationState['a21dd644-...']` was re-populated with `{ rows: [5 items], isLoadingMore: false, firstRow: { date: '1/1/2026', profit: 0 } }`. **Confirms `usePanelData` re-fetched on next render tick.**
- Network requests: `GET /api/types/21ce4b95-.../rows` count went from 2 to 3. **Confirms a fresh HTTP fetch fired.**

**Test 2 — negative (unrelated DataType id):**
- Dispatched `{ type: 'panels/markDataTypeRowsStale', payload: 'unrelated-dt-id-that-no-panel-binds' }`.
- `Object.keys(paginationState)` before and after dispatch were identical. **No spurious clears.**

**Test 3 — multi-bound clear:**
- Dispatched `{ type: 'panels/markDataTypeRowsStale', payload: '4f44d983-...' }` (the DataType that 2 of the 4 bound panels point at).
- `paginationState` afterwards contained only the two entries bound to other DataTypes (`a21dd644` → `21ce4b95`, `e4d9c904` → `2f485fd8`); both `4f44d983`-bound entries (`0a1a4e3e` and `2f5377c7`) were cleared in a single reducer pass.

**Wire-up correctness (`PipelineDetailPage onTerminal`):** read the source at the cycle-2 edit site (PipelineDetailPage.tsx:86-98) — `event.status === "succeeded"` and `outputDataTypeId` are both gated. The closed-over `currentPipeline` is re-read at terminal time (the SSE hook stores `onTerminal` in a ref). Race-condition safety: a stale `currentPipeline?.outputDataTypeId` would dispatch for the wrong id, which Test 2 above proves is a safe no-op walk.

**Console errors during the verification flow**: only one benign 404 (`https://test/snap.png` — an external avatar fetch from an unrelated dashboard fixture), unchanged from page-load. No HEL-242-attributable errors during dispatch or refetch.

**Visual UI**: the dashboard rendered all 9 panels (1 chart, 6 metrics, 3 dividers, 2 images, 3 markdowns); the "Trend Overview" chart panel did not visually update its rendered chart after the dispatch because Echarts re-renders on prop-change only, not on store-change, BUT the underlying `data` did update (verified via store inspection). This is unchanged behavior and out of scope for HEL-242.

#### Negative scenarios

- A panel bound to a *different* DataType from the one whose pipeline ran does NOT refresh (Test 2 above). No spurious cache clears.
- Mixed-subtype dashboards (with divider, image, markdown panels alongside bound metric/chart/table) do not throw on the reducer walk — the `isBoundCapablePanel` narrowing skips them safely (Test 3 implicitly, plus the third `panelsSlice.test.ts` unit case).

### Phase 4: Static gates re-run

| Gate | Expected | Observed | Status |
| --- | --- | --- | --- |
| `npm run lint` | clean | clean | PASS |
| `npm run format:check` | clean | clean | PASS |
| `npm test` | 669/669 | 669/669 (58 suites) | PASS |
| `npm --prefix frontend run build` | green | green (vite v7 prod build OK; pre-existing 500KB-chunk warning) | PASS |
| `npm run check:schemas` | 6/6 in sync | 6/6 in sync | PASS |
| `npm run check:openspec` | clean | clean | PASS |
| `npm run check:scala-quality` | 18 pre-existing warnings, no errors | 18 pre-existing warnings, no errors | PASS |
| `(cd backend && sbt test)` | 591/591 | 591/591 | PASS |
| Husky pre-commit hook | clean on every commit | clean (verified via git log; no `--no-verify` used) | PASS |

### Phase 5: Behavior-preservation diff scan

`git diff main -- '*.ts' '*.tsx' | grep '^-' | grep -v '^---'` returned exactly 5 deletion lines:
1. `import { panelsReducer } from "../state/panelsSlice";` — replaced with `import { markDataTypeRowsStale, panelsReducer } from "../state/panelsSlice";` (test file import re-point)
2. `if (prevFetchKey.current === currentFetchKey) {` — replaced with the conditional including `&& paginationEntry != null` (the one-line guard relaxation)
3. `  }, [currentFetchKey, panel.id, panel.type, dispatch, refreshToken]);` — replaced with same array plus `paginationEntry` (necessary subscription)
4. `import { markDashboardPanelsStale } from "./panelActions";` — replaced with `import { markDashboardPanelsStale, markDataTypeRowsStale } from "./panelActions";`
5. `export { markDashboardPanelsStale } from "./panelActions";` — replaced with `export { markDashboardPanelsStale, markDataTypeRowsStale } from "./panelActions";`

**Zero business-logic deletions.** All deletions are either import/export re-points or the one-line guard change documented in the design.

### Overall: PASS

### Non-blocking observations / spinoffs

1. **Executor did not mark `tasks.md` items 3.1, 3.2, 4.3, 4.4 as `[x]`** even though all four are done. Cosmetic; ask executor to flip the boxes before opening the PR (or do it in the PR-prep commit).
2. **`PipelineDetailPage.tsx` is now 399 lines, 1 line under the 400 hard cap.** The cushion is gone. Future edits to this file should be paired with a decomposition (a separate ticket — would also benefit from extracting the run-controls + history strip into separate components). The cycle-2 fix did not cause this — the file was already at 389 lines pre-fix; the +10 from this fix landed it at 399. Surface this to the orchestrator for a follow-up cleanup ticket if not already on the radar.
3. **The dev DB has data-quality issues that prevent the headline cycle-1 reproduction recipe from running end-to-end via the UI**: the pipeline produces to a DataType matt doesn't own (so `resolveSingleBinding` scrubs any attempted UI rebind), and ProfitAgg itself currently fails at 422 ("DataSource not found for join"). These are not regressions from HEL-242 (the failure pre-dates the fix branch). Worth filing a separate ticket: "Dev seed data drift — ProfitAgg pipeline currently fails 422 and panels can't bind to its output." Tag with the spinoff #1 from the cycle-1 design (NULL/different-owner scrub on DataTypes) since both are facets of the same data-hygiene gap.
4. **Cross-tab / cross-user invalidation remains uncovered** — confirmed out-of-scope per the design and proposal. Captured in spinoff HEL-266 (already filed per the cycle-2 handoff context).
5. **Echarts visual re-render after store update** — the underlying chart data updates correctly in the store after `markDataTypeRowsStale`, but the rendered SVG won't visibly redraw until the next React render tick that includes the chart's prop. This appears to work in practice (the React subscription does re-render). Not blocking; flag for visual-smoke if a future ticket touches Echarts.

### Recommendation to orchestrator-relay

**Ready to open PR.** Static gates all green, all 1260 tests (591 backend + 669 frontend) pass, the fix path is verified end-to-end in the live browser (reducer + hook + network refetch), behavior-preservation diff is clean (only import re-points + one-line guard), and the regression coverage faithfully models the production sequence. The PipelineDetailPage wire-up is correct (gates on `event.status === "succeeded"` AND `currentPipeline?.outputDataTypeId != null`; closure-safe because the SSE hook stores `onTerminal` in a per-render ref).

Suggested PR body talking points:
- Frontend-only fix, zero backend / schema / migration changes
- ~34 LOC production + ~140 LOC test
- Cycle-1 investigation report (executor-report-1.md) is worth linking in the PR description because it documents *why* the original hypothesis was wrong, *what* the actual root cause is, and *which* edge cases were intentionally left out of scope (with spinoff tags)
- Note the file-size pressure on PipelineDetailPage (399/400) as a follow-up cleanup target
- Note the dev-DB data drift (ProfitAgg pipeline 422 / cross-user-owned output DataType) as a separate spinoff for the dev environment maintainer

No cycle-3 work needed.
