## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: 3202f24345da16c1d6a08821ff914c2b3f5daab0. Base resolved live with `resolve-review-base.sh` (main/origin): 7ee3f8e36a71c7ee1027cb4d1481ddb7f9bfddf2. I read the full non-test source diff (`git diff 7ee3f8e3...HEAD -- frontend/src`), plus ticket.md (including the rows-plus-output-meta owner ruling), design.md, tasks.md C1-C6, the spec delta, both e2e specs, files-modified.md, evaluation-2.md and the evidence dir.

### What I verified (with evidence)

**Gates, re-run by me at HEAD**

- `npx jest` on every HEL-1392 suite plus every panels/PanelGrid/MobilePanelStack suite: 48 suites, 394 tests, all pass.
- `npm run typecheck`: exit 0.
- `npm run lint`: exit 0, zero warnings.

**AC trace**

- Root cause, remount: `PanelGrid` swaps `DesktopPanelGrid` for `MobilePanelStack` when the container crosses 768px. It is not RGL key churn. Recorded in design.md Context and probe-premise.md, and consistent with the code.
- Root cause, refetch: `usePanelData`'s per-mount `prevFetchKey` ref, and `useOutputMeta`'s uncached `useState`. Both are fixed in the diff.
- A resize does not refetch rows already held (spec "Crossing the desktop/phone boundary does not refetch rows"):
  - Red-first jest test: `PanelGrid.remountReuse.test.tsx`. The red run is in `evidence/jest-red-first-unmodified-final.txt` ("1 failed").
  - Live, my own run with 8 panels (2 plain tables, pie, bar, 2 persisted-sort tables, 2 control tables), dark theme. After reading the dashboard for more than 30s, I crossed 1400 -> 1000 -> 1400 -> 1000 -> 1400. Every crossing had 0 `/rows` and 0 `GET /api/outputs/:id`.
  - The remainder per crossing matches the reported numbers: `distinct-values` x2-4, `runs/latest`, `run-events`, and on the way up `assertion-status` x8.
  - Cold load: 8 metadata requests (one per Output, so merged) and 10 rows requests (8 stripped + 2 sorted corrections, as disclosed).
- Theme toggle: no remount and no requests (premise measurement). I did not re-measure an in-app toggle. Setting the theme through localStorage requires a reload, so I used that only for the visual check.
- Rate limiter untouched: the diff stat has no backend file (C2).
- Owner-ruling ACs:
  - Metadata merge: `outputMetaCache.ts`.
  - Invalidation on Output writes and pipeline writes/runs: `outputService.ts`, `pipelineService.ts`, and the `pipelineRunFanout.ts` reconcile and live paths.
  - All-`/api` burst counts before and after, with StrictMode and production stated: files-modified.md table and `evidence/burst-*.json`.
  - Cold-load double fetch investigated: StrictMode dev artefact, files-modified.md D6.

**Staleness, my own live probe of the path no in-app write covers**

- I left the dashboard by SPA navigation, so no card was mounted. I then wrote a source row and started a run through raw `fetch`, which bypasses the service-layer invalidation, and waited for the run to reach `succeeded`. Then I navigated back within 30s by history.
- The re-created fan-out entry was seeded with the earlier run id. The reconcile therefore treated the new run as a real observation, called `invalidatePipeline` and notified the listeners, and all 8 cards issued rows requests. The new row "Zeta 999" rendered in every table.
- A second refresh followed. It was the auto-run that the row write queued, as disclosed.
- So D5's reconnect path works live. A sub-second display of the reused window before the refresh is expected under D5.

**Logout**

- `logout` calls `resetOutputFreshness()`. That clears retention, generations, the metadata cache (`onFreshnessReset`) and the fan-out run baselines.
- Row reuse requires `isRetained` and `hasRunBaseline`, so nothing carries across users.

**Staleness spec's "retry up to 4 round trips"**

- It can fail. Its final `expect(after).toEqual({rows:0,meta:0})` runs after the loop.
- The evaluator demonstrated a failing mutated run (`evidence/e2e-evidence/HEL-1392/eval-c2/eval-mutation-spec.diff`).
- What it weakens: it hides a defect that makes one to three post-run crossings refetch. That defect is conservative, not stale, so this is acceptable. The reuse-every-crossing property is separately asserted on every crossing by the burst spec.

**Production-expectation honesty**

- The "about 5 down / 13 up" figure is derived from dev counts by halving the StrictMode-doubled effects. It was not measured on a production build.
- The arithmetic matches my dev observation: `distinct-values` 4 -> 2, the aborted duplicate `runs/latest` drops out, and the 8 `assertion-status` are already one per Output.
- The PR text should say "derived, not measured". See the non-blocking notes.

**Mutations, run by me in a scratch copy (`git archive HEAD frontend`, never in the worktree)**

- A. `outputMetaCache` ignores an invalidation that lands mid-flight -> RED (1 failed).
- C. Page-0 `pending` keeps `lastFetchOk` -> RED.
- F. `updatePipelineStep` does not `invalidateAll` -> RED.
- G. `deleteOutput` does not invalidate -> RED (2 failed).
- H. `useOutputMeta` does not seed from the cache -> RED (PanelGrid and MobilePanelStack remountReuse).
- I. `normalizeQuery` drops the `isFilterActive` equivalence -> RED.
- **E. `fetchPanelPage` reads `currentGeneration` at fulfilment instead of at request start (`panelThunks.ts:365` / `:384`) -> GREEN across the entire frontend suite.**
  - Mutated run: "6 failed, 4972 passed".
  - Unmutated control in the same scratch copy: "6 failed, 4972 passed".
  - Those 6 failures are environmental: drift-guard and fixture tests that read files outside `frontend/`, which are absent in the archive.
  - So this guard has no test at all. See CR1.

**Visual, both themes**

- No CSS or markup changed in the diff.
- I looked at desktop dark (`skeptic-final-1-desktop-dark-cold.png`), phone dark after reuse (`skeptic-final-1-phone-dark-reused.png`, `skeptic-final-1-phone-dark-charts.png`) and phone light after reuse (`skeptic-final-1-phone-light-reused.png`). All are in `/home/matt/Development/helio/.concertino/runs/HEL-1392/evidence/`.
- The reused cards look identical to a fresh load, with the persisted-sort tables still sorted and the sort indicator shown. Light and dark are at parity.
- Phone-stack charts render at a 100px canvas height with 4 ECharts "Can't get DOM width or height" warnings. This is not caused by this change: a cold load directly at phone width (no reuse) gives the same 646x100 canvas and the same warnings.

**Dev DB**

- My throwaway user `90d53b8c-bd12-4d65-8d0b-db70ca641ae9`: its dashboard, pipeline and source were deleted by exact id through the API (all 204). Then its 2 `pipeline_run_rate_window` rows and the user row were deleted by exact id. Post-check: 0 rows.
- matt@helio.dev was not touched.

### Verdict: REFUTE

### Change Requests

1. **Guard with no test: request-start generation stamping.**
   - Location: `frontend/src/features/panels/state/panelThunks.ts:365` (`const generation = currentGeneration(outputId);`) and `:384`.
   - design.md D2 ("fetchPanelPage reads the D1 generation at request start") makes this the guard that keeps the result of a rows request that was in flight when an invalidation landed (a run-succeeded event, an Output or pipeline write) from being reused by the next remount.
   - It matters most exactly when the SSE `refresh()` is swallowed by `inFlightRef` because a request was already in flight. That stale window must then not be reusable.
   - Moving the read to fulfilment (mutation E above) leaves every frontend test green. That contradicts design.md Verification 3 ("Each guard needs a recorded mutation that turns it red") and the executor's "every guard" mutation claim.
   - Required:
     - Add a jest test. Start a page-0 rows request with a deferred `getOutputRows`. Call `invalidateOutput` (and/or `invalidatePipeline`) while it is pending. Resolve it, remount the card within the retention window, and assert that exactly one new rows request is issued.
     - Record mutation E turning it red in `evidence/mutations.txt`.

### Non-blocking notes

- **Production numbers in the PR body.** Label the production per-crossing figures ("~5 down / ~13 up, ~30 per 3 crossings/min") as derived from dev counts, not measured on a production build.
- **Retry-loop evidence.** Echoing evaluation-2: log the per-attempt counts in `staleness-<theme>.json`, so a pass that needed retries is visible.
- **`subscribeWait` early-settled branch** (`usePanelData.ts`). Clear `inFlightRef` there too (evaluation-2 suggestion). It is low risk today.
- **Possible follow-up ticket, unrelated to this change.** Phone-stack chart cards render a 100px-high ECharts canvas, with "Can't get DOM width or height" warnings, both on a cold load at phone width and after reuse.
- **Playwright MCP artefacts.** Snapshot and console logs from my session went to the main checkout's gitignored `.playwright-mcp/`, which is the MCP server's own output root and not configurable from here. Every screenshot I cite is in the evidence dir.
