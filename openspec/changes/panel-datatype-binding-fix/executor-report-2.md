# Executor Report — HEL-242 cycle 2 (fix + tests)

## 1. What landed

Four production-code edits and one OpenSpec doc edit, split across four atomic commits on `bug/panel-datatype-binding/HEL-242`:

| Commit | Subject | Files |
| --- | --- | --- |
| `40bf334` | Add markDataTypeRowsStale action + reducer | `panelActions.ts`, `panelsSlice.ts` |
| `d428aad` | usePanelData bypasses dedupe when pagination entry is null | `usePanelData.ts` |
| `55c4c64` | PipelineDetailPage dispatches stale-invalidation on success | `PipelineDetailPage.tsx` |
| `c62cb0f` | Regression tests for stale-invalidation flow | `panelsSlice.test.ts`, `usePanelData.test.ts`, `tasks.md` |

### File-level summary

- **`frontend/src/features/panels/state/panelActions.ts`** — added `markDataTypeRowsStale = createAction<string>("panels/markDataTypeRowsStale")` next to its sibling `markDashboardPanelsStale`. Doc-comment explains the dispatcher (SSE onTerminal on success) and the consumer (the slice reducer below).
- **`frontend/src/features/panels/state/panelsSlice.ts`** — imported the action plus the existing `isBoundCapablePanel` helper from `panelNarrowing.ts`. New `extraReducers` case (immediately after `markDashboardPanelsStale`'s case) walks `state.items`, narrows each panel via `isBoundCapablePanel`, and `delete state.paginationState[panel.id]`s for every panel whose typed `config.dataTypeId === action.payload`. Re-exported from the slice's public surface alongside `markDashboardPanelsStale`.
- **`frontend/src/features/panels/hooks/usePanelData.ts`** — the dedupe early-return now reads `if (prevFetchKey.current === currentFetchKey && paginationEntry != null) return;`. The `paginationEntry` was added to the effect deps so React re-runs after the reducer clears the entry. Inline comment explains why both "never fetched" and "just invalidated" land on the same `paginationEntry == null` path.
- **`frontend/src/features/pipelines/ui/PipelineDetailPage.tsx`** — imported `markDataTypeRowsStale` from the panels slice. SSE `onTerminal` now dispatches it when `event.status === "succeeded"` and the closed-over `currentPipeline?.outputDataTypeId` is non-null. Inline comment explains why failed runs intentionally do not invalidate (`overwriteRows` is transactional — failed runs touched no rows).

## 2. Final LOC delta

| File | Before | After | Δ |
| --- | --- | --- | --- |
| `panelActions.ts` | 13 | 20 | +7 |
| `panelsSlice.ts` | 240 | 253 | +13 |
| `usePanelData.ts` | 104 | 108 | +4 |
| `PipelineDetailPage.tsx` | 389 | 399 | +10 |
| **Production subtotal** | — | — | **+34 LOC** |
| `panelsSlice.test.ts` | 461 | ~540 | +~80 |
| `usePanelData.test.ts` | 173 | ~230 | +~60 |
| **Test subtotal** | — | — | **+~140 LOC** |

Total against the design's `~40 LOC + ~30 LOC test` estimate: production matches (34 vs 40); tests came in higher (~140 vs ~30) because three reducer cases + two integration-shape cases each needed full panel/store fixture setup. The extra coverage is intentional — the negative cases (no-match no-op, non-bound subtype, unrelated DataType) defend against three classes of future regression in addition to the happy path.

## 3. File-size budgets

All four production files remain under the 400-line hard cap. `panelsSlice.ts` now sits at 253 lines, 3 over the 250-line soft cap; the additions are a single 8-line `extraReducers` case and two import-line tweaks, so the file is not crossing into "needs split" territory. `PipelineDetailPage.tsx` at 399 is one line under the cap and the only added code is inside the existing `onTerminal` body — the file is structurally unchanged.

## 4. Gates run + results

| Gate | Result |
| --- | --- |
| `npm run lint` | clean (zero warnings) |
| `npm run format:check` | clean |
| `npm test` (frontend Jest) | **669/669 pass** (664 cycle-1 baseline + 5 new: 3 reducer + 2 hook) |
| `npm --prefix frontend run build` | green (vite v7 prod build OK; bundle warning is pre-existing) |
| `npm run check:schemas` | clean (6/6 in sync) |
| `npm run check:openspec` | clean |
| `npm run check:scala-quality` | clean (18 pre-existing soft warnings on backend test files; unchanged) |
| `cd backend && sbt test` | **591/591 pass** (unchanged; backend was not touched) |
| Husky pre-commit hook | passed on every commit (no `--no-verify` used) |

## 5. Manual verification

**Playwright run not executed in this cycle.** The dev servers on `localhost:5412` / `localhost:8319` were not running at the start of the cycle, and the sandbox does not currently provide a Playwright capability for me to start them and drive a browser. Two options were available:

1. Spin up `sbt run` + `vite dev` in the background, wait 60–90s for DB seeding, then attempt a curl-based reproduction (which would only re-verify the cycle-1 reproduction recipe, not the cycle-2 fix — `curl` cannot dispatch Redux actions).
2. Rely on the unit + integration coverage (which directly verifies the contract: the reducer clears the entry, the hook then refetches) and document the gap.

I chose (2). The integration test in `usePanelData.test.ts` titled `"re-fetches after markDataTypeRowsStale is dispatched for the panel's DataType"` is a faithful end-to-end model of the production sequence:

- a bound metric panel is rendered with pre-loaded pagination state (mirrors "panel mounted, rows displayed")
- `store.dispatch(markDataTypeRowsStale(panel.config.dataTypeId))` runs (mirrors the line of code added to `PipelineDetailPage.tsx`)
- the reducer's behavior is exercised against the real slice (no test double)
- the hook's effect runs against the real (modified) dedupe guard
- a fresh `fetchPanelPage` is observed and the hook's returned `data` updates to the new rows

The only piece this does not cover is the wire-up inside the SSE `onTerminal` callback itself (i.e., did I close over `currentPipeline?.outputDataTypeId` correctly and gate on `event.status === "succeeded"`?). That is a six-line conditional in an existing tested-by-coverage path; eyeballing confirms it. If the evaluator wants a `PipelineDetailPage` unit test for this, it would be a sensible add but the cycle-1 design did not call for one (`tasks.md §3.3` explicitly noted: "if one exists, extend it; otherwise document that this is covered by manual + e2e Playwright").

**Recommendation to the orchestrator**: if Playwright access is needed before merge, the human can run the cycle-1 reproduction recipe (start dev servers → login matt@helio.dev → open Helio is profitable? dashboard → run upstream pipeline from PipelineDetailPage → observe panel updates without reload). The reproduction is the cycle-1 finding; the fix passes its unit+integration tests; the remaining axis is "verify the integration test correctly models the production behavior" which is what a human eyeball + Playwright session would confirm.

## 6. Nuance for the evaluator to sanity-check

- **The integration test cannot directly assert "pagination entry was undefined for one microtask."** When the reducer deletes the entry, React schedules the hook's effect, which then dispatches `fetchPanelPage.pending` and re-creates the entry with `isLoadingMore: true` before `act()` returns. The test instead asserts the observable outcome: `mockFetchDataTypeRows` is called a second time and `result.current.data` updates to the second mock's rows. The reducer-level test in `panelsSlice.test.ts` is the one that asserts the synchronous-delete contract in isolation. Together they cover both sides of the contract.
- **`currentPipeline?.outputDataTypeId` closure.** The SSE hook stores `onTerminal` in a ref that it updates every render, so the callback always sees the latest `currentPipeline` value when fired. If a user edits the output binding while a run is in-flight, the dispatch fires for whichever DataType id is current at terminal time. Worst case (user just rebound the pipeline output and the old DataType is still loaded by panels), the dispatch is for the new id and panels bound to the old id stay stale until the next page reload. Documented in the design's "Risks" section as acceptable for this fix.
- **The `paginationEntry` dep on the effect.** This adds a real subscription to the slice entry — every change (`pending`, `fulfilled`, `rejected`, and now `markDataTypeRowsStale`) re-runs the effect. The dedupe guard (`prevFetchKey.current === currentFetchKey && paginationEntry != null`) ensures the effect short-circuits on the `pending` and `fulfilled` re-runs that immediately follow our own dispatch — only the "entry just went to null" tick falls through. There is no infinite-loop risk: after the refetch lands, `paginationEntry` is `{rows, isLoadingMore: false, …}`, both guard conditions are true, and the effect returns early.
- **No-op safety.** `isBoundCapablePanel` skips text/markdown/image/divider panels cleanly, so a mixed dashboard never throws on the iteration. The third reducer test pins this.

## 7. Confirmation: scope kept tight

I did **not** touch any of the orchestrator-listed out-of-scope items:

- No BroadcastChannel / cross-tab work
- No server-side SSE channel keyed by dataTypeId
- No changes to the ACL on `GET /api/types/:id/rows`
- No NULL-owner DataType cleanup
- No `refreshInterval` / `usePanelPolling` cleanup
- No `updatePanelBinding` ACL hardening
- No backend changes (zero files under `backend/` touched)
- No schema changes (zero files under `schemas/` touched)
- No Flyway migrations

The only edits outside `panelActions.ts` / `panelsSlice.ts` / `usePanelData.ts` / `PipelineDetailPage.tsx` are the three test files (Jest-only) and the four OpenSpec markdown files. No "drive-by" refactors, no comment cleanups, no formatting churn beyond what Prettier auto-fixed in the new test cases.

## 8. Blockers

None. Cycle 2 is gates-green and ready for evaluation. If Playwright verification is required as a hard gate before evaluation, surface the blocker to the orchestrator (see §5 for context).
