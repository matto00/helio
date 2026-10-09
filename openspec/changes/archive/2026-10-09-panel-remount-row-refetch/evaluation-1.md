## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: fcdb69257b03c2e58020e9b9b7f1bd0f758d8e88. The diff base was resolved live to
7ee3f8e36a71c7ee1027cb4d1481ddb7f9bfddf2.

### Phase 1: Spec Review — FAIL

The behaviour is correct and every AC is met. I re-measured each of them myself; details are under Phase 2 and Phase 3.
The phase fails on one artifact defect: the planning artifacts still describe a mechanism that was not built.

| Check                                                                  | Result                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ticket ACs plus the owner-ruling ACs                                   | PASS: root cause (desktop/phone branch swap, `prevFetchKey` reset, `useOutputMeta` had no cache), 0 row refetches across a crossing, red-first jest, no limiter change                                                             |
| No AC reinterpreted                                                    | PASS                                                                                                                                                                                                                               |
| Scope / C5                                                             | PASS: nothing from HEL-1418, no rate-limiter file touched (C2)                                                                                                                                                                     |
| Regressions                                                            | PASS: full jest is green, and toast-only sort failure is preserved (verified live)                                                                                                                                                 |
| API/schema                                                             | N/A: frontend only                                                                                                                                                                                                                 |
| **Tasks match the implementation / artifacts reflect final behaviour** | **FAIL, see CR1**                                                                                                                                                                                                                  |
| CONSTRAINTS C1–C6                                                      | PASS. C6 N1: `usePanelData.ts` early return uses the render-captured `paginationEntry`. N2/N3: `waitForOwnedRequest` records `latestFetchRequestId`, clears `inFlightRef` on settle, and surfaces only that request's `lastError`. |

The artifact defect: `files-modified.md` lists four deliberate divergences, but `design.md` and `tasks.md` were never updated to match:

- `design.md` D2 (lines ~84-104) still specifies the thunk-arg `origin: 'mount' | 'interaction' | 'refresh'`. It also still says the reducer records `lastError` "only when `origin === 'mount'`", and that `dispatchFetch` takes an `origin`.
- `design.md` D3 (line ~111) and D4 (line ~120, "`invalidateOutput(id)` + prime") still specify `primeOutputMeta`, which does not exist.
- `tasks.md` 2.2 is ticked `[x]` but reads "`origin`/`generation` via thunk arg read from `meta.arg`". The implementation has no `origin`, and `generation` comes from the fulfilled payload (`panelThunks.ts:365,384`).
- `tasks.md` 2.3 / D3 say the cache lives "in `useOutputMeta`". It is actually a separate `outputMetaCache.ts`.

These files are archived as the record of the change. As written, a future reader would look for an `origin` field and a `primeOutputMeta` function that do not exist.

### Phase 2: Code Review — PASS

**Gates.** I ran each gate myself in WORKTREE_PATH at fcdb6925:

| Gate                              | Result                                                               |
| --------------------------------- | -------------------------------------------------------------------- |
| `npm run lint`                    | exit 0 (zero warnings)                                               |
| `npm run format:check`            | exit 0                                                               |
| `npm run typecheck`               | exit 0                                                               |
| `npm test`                        | exit 0: root 43 suites / 418 tests; frontend 488 suites / 5137 tests |
| `npm --prefix frontend run build` | exit 0                                                               |

**Red-first, independently reproduced.** I made a throwaway detached worktree at HEAD and reverted every modified non-test source file to 7ee3f8e3, keeping the new tests. `PanelGrid.remountReuse.test.tsx` then fails (`Received +65` calls, `Tests: 1 failed`). It is green on HEAD. The scratch worktree has been removed.

**Mutations I re-ran myself** (not taken from the executor's list):

- Drop the N1 `if (paginationEntry == null) return;` (`usePanelData.ts` ownership block): `MobilePanelStack.remountReuse` goes RED (1 failed).
- Drop `invalidateOutput` from `deleteOutput`: `writeInvalidation.test.ts` goes RED (1 failed).
- Drop `invalidatePipeline` from the LIVE SSE succeeded handler (`pipelineRunFanout.ts`, in the `readLoop`): **stays green (23/23)**. Not blocking: a mounted subscriber `refresh()`es on the same event, so the invalidation only protects the next mount. It is an unguarded line, though (see suggestions).

**Claims checked:**

- **Dropping `origin` keeps a failed user sort toast-only (Verification 3(g)).** Verified by code reading and live.
  - The only reader of `lastError` is `waitForOwnedRequest`, and it surfaces an error only when `lastError.requestId` equals the request id it captured at wait time. An ordinary interaction refetch never reaches it: the parent effect re-runs, then returns at `prevFetchKey === key && paginationEntry`.
  - The jest guard is "a later user-driven refetch that fails is not surfaced..." with mutation M15.
  - Live (Phase 3): forcing the sort request to 404 showed the toast "Output not found". The table stayed mounted with all 6 rows and the "Filters" control, and there was no error banner.
- **D4 classification is complete.** I re-ran the grep: 19 files, 108 hits, and every file is classified in `files-modified.md`.
  - `panelService.ts` (16 hits) only writes panel placement/config, not Output config.
  - `dataSourceService.ts` row/schema/refresh writes reach Output rows only through a run, which is covered by reconcile-on-reconnect (D5) and the live SSE handler.
  - `dashboardService` import/duplicate creates new ids.
  - I found no unclassified write path.
- **Generation from the fulfilled payload.** It is read at request start (`panelThunks.ts:365`), so an invalidation that lands mid-flight leaves the window non-reusable. That is equivalent to the arg-based design.
- **The separate `outputMetaCache` module without `primeOutputMeta`** is simpler. An edit followed by a remount costs one metadata request, as the spec scenario requires.

**Remaining checklist items:**

- Type safety: no `any`; the only `never` is the promise placeholder (`outputMetaCache.ts:43`).
- Error handling: a failed metadata fetch is evicted, and a failed page-0 is never reusable.
- Tests: substantial.
- No dead code, no TODO/FIXME, no inline FQNs.

### Phase 3: UI Review — PASS

**Servers.** `start-servers.sh` reused healthy servers. I confirmed that the processes on :6824 and :9731 have their cwd in this worktree's `frontend/` and `backend/`.

**Burst spec, re-run by me** (`hel1392-remount-request-burst.spec.ts`, 3 cases, all passed). The numbers match the executor's exactly:

| Measurement      | Requests                    |
| ---------------- | --------------------------- |
| Cold load        | 39 (rows 12, outputs/:id 8) |
| Crossing down    | 7 (0 rows, 0 metadata)      |
| Crossing up      | 15 (0 rows, 0 metadata)     |
| 3-crossing burst | 29                          |

Panels showing "Rate limit exceeded": 0. Evidence:

- `/home/matt/Development/helio/.concertino/runs/HEL-1392/evidence/e2e-evidence/HEL-1392/eval-c1/burst-after-read_30s_on_the_dashboard_then_3_crossings_in_a_burst.json`
- `.../eval-c1/burst-after-crossing_within_seconds_of_the_first_load.json`
- `.../eval-c1/burst-after-an_active_cross_filter_then_a_crossing.json`

**Staleness spec, re-run by me** (`hel1392-remount-staleness.spec.ts`, dark and light): both pass. Evidence: `.../eval-c1/staleness-dark.json`, `.../eval-c1/staleness-light.json`.

**Manual check in the running app** (my own throwaway user and 4-panel dashboard: table, bar chart, persisted-sort table, control table):

- Desktop to phone (1440 to 1000): no `/rows`, no `GET /outputs/:id`.
- Phone to desktop: 9 requests (distinct-values ×2, runs/latest ×2, assertion-status ×4, run-events ×1), with 0 rows and 0 metadata.
- Theme toggle, both directions: 0 requests.
- 1000 to 768 to 360 (all within the phone stack): 0 requests and no horizontal overflow (scrollWidth 360).
- After a failed sort, crossing correctly refetched T1. That was 1 metadata request (the sort PATCH invalidated the Output) plus stripped and sorted rows. The fresh ascending order rendered with no error.
- Console errors: only the 404 I injected. Two ECharts "Can't get DOM width" warnings appeared on the phone-stack mount; they are warnings, not errors, and I did not attribute them against main.
- Screenshots: `.../eval-c1/eval-phone1000-dark.png`, `eval-phone1000-light.png`, `eval-768-light.png`, `eval-360-light.png`, `eval-1100-dark.png`. Both themes render normally.
- There are no new interactive elements, so no accessibility or keyboard surface changed.

**Dev DB.** All my throwaway data was removed by exact id:

- Dashboard, pipeline and source deleted via the API (204 each).
- Users removed by exact id in SQL, together with their 7 `pipeline_run_rate_window` rows: 57c0f4e1-e602-45f0-8002-4e14717f532c, f16af5c0-1534-4ffe-9120-cb4f132cbc7f, a0e309fd-ac19-4fb5-997c-de743248232c, 819e625d-df4d-458a-866c-0fefcf2fdfcb, 8ed9cabe-a68f-4ad6-833b-0a7f677ff661, b23baccc-e69c-43a7-94b6-befc935118d1.
- Before deletion, these users owned 0 dashboards, 0 pipelines and 0 sources.

### Overall: FAIL

### Change Requests

1. **Bring `design.md` and `tasks.md` in line with what was built.** This is an artifact-only fix; no code change is needed.
   - (a) Rewrite `design.md` D2's "Pagination state fields", "`dispatchFetch` origin" and "Error surfacing, scoped" bullets, and the `origin: 'refresh'` mention in the Refresh bullet, to describe the implementation:
     - `generation` is read at request start and returned in the fulfilled payload.
     - There is no `origin`.
     - Every non-cross-filter-eq page-0 rejection records `lastError {requestId, message, kind}`.
     - A card surfaces it only for the request id it waited on (N3), which is what keeps a user-driven sort/filter failure toast-only.
   - (b) In D3, drop `primeOutputMeta` and say the cache lives in `frontend/src/features/panels/state/outputMetaCache.ts`. Note that a write only invalidates, so the next mount refetches.
   - (c) In D4, change "`invalidateOutput(id)` + prime" to "`invalidateOutput(id)`".
   - (d) Reword `tasks.md` 2.2 (and 2.3's "in `useOutputMeta`") to match.
   - Run `rg -n "origin|primeOutputMeta|meta\.arg" openspec/changes/panel-remount-row-refetch/{design,tasks}.md` afterwards. It should return only the unrelated "origin/main" and "regardless of origin" hits.

### Non-blocking Suggestions

- The live-SSE `invalidatePipeline(pipelineId)` in `pipelineRunFanout.ts` (`readLoop` succeeded branch) has no test: removing it leaves the suite green. A one-case test would guard it. For example: subscribe, emit a succeeded SSE event with a new runId, then assert `currentGeneration` was bumped for an Output registered to that pipeline.
- Verification 3(g) is guarded only at hook level. A `PanelCard`-level jest test would pin the full contract: a rejected sort refetch shows the toast and keeps the table and the Filters control mounted, with no error banner. I verified this behaviour live.
- `waitForOwnedRequest` (`usePanelData.ts`) does not unsubscribe on unmount. The subscription ends once the entry settles, but tying it to the effect cleanup would avoid a `setState` after unmount.
- `resetOutputFreshness()` on logout does not clear `lastObservedRunIdByPipeline`. This is harmless today because retention is cleared and reuse needs retention, but resetting it too would make "next user starts clean" literal.
- `usePanelData.ts` (395 lines), `panelsSlice.ts` (459) and `pipelineService.ts` (430) are over CONTRIBUTING's soft budget. As the executor noted, propose the split in the PR description.
