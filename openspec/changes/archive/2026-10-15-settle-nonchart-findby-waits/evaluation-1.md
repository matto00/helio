## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: 7e3479c6a2dd1136470b4d9e2c357559f88168dd. Diff base resolved live: 563a4c476c7f7340cf494deec06dbe6932edff7d.
Spawn-cwd guard: READY.

### Phase 1: Spec Review — PASS
Issues: none.

- AC1: every listed wait is converted to `settleMocks(...)` (inside `act`), then `getBy*`. That covers chartTruncation 94/100/135/155/157/175/184 plus the `waitFor` at 176, PublicDashboardViewerPage.truncation:89, crossFilter 177/187/199/241/249/292/293, FullscreenOverlay.test 285/292, and PanelContent.test 106/126/152/353/426. Chained waits settle in stages (D2). The lazy markdown waits settle by passing `import("./MarkdownPanel")` (D1). crossFilter 302/392/416 became bare `getBy*`. I verified (b) for those three below.
- AC2: measurements.md records BEFORE and AFTER runs for every file, with fired counts. I reproduced one of them myself (below).
- AC3/C1: the changed code contains no timeout, retry, `waitFor` or `setTimeout`, and no stall code. The diff only matches those words in the openspec prose. `git grep "SCRATCH STALL" -- frontend` finds nothing. No product file changed: only 5 test files and `frontend/src/test/settleChartMount.ts`.
- AC4/C4: the diff does not touch `frontend/src/test/networkGuard.ts`, the jest configs or the setup files. No new mocks were added.
- AC5: the full frontend suite passes on HEAD (my run, below).
- Tasks are all checked and match the diff. No scope creep. C2/C3 were honoured.

### Phase 2: Code Review — PASS
Gate runs, all in this worktree with `nice -n 19`:
- `npm run lint` (root, `eslint . --max-warnings=0`): exit 0.
- `npm run format:check`: "All matched files use Prettier code style!", exit 0.
- `npm --prefix frontend run typecheck`: exit 0.
- `npm test`, split into its two halves so the 3-worker cap could be passed explicitly. Under `CI=true` the HEL-1442 config sets no cap, so the flag is needed.
  - Root `CI=true nice -n 19 npx jest --maxWorkers=3`: 51 suites / 469 tests passed, exit 0.
  - `frontend/` `CI=true nice -n 19 npx jest --config jest.config.cjs --maxWorkers=3`: Test Suites 612 passed / 612; Tests 7268 passed / 7268; Snapshots 19 passed; exit 0.
- `npm --prefix frontend run build`: exit 0.

My own stall probe, one red-before / green-after pair. I used the executor's scratch `stalledit.py` read-only, through my own wrapper `scratchpad/eval1612/eprobe.sh`. The wrapper backs up the file, restores it with a trap, uses a cold cache and `--maxWorkers=1`, and runs from `HEL-1612/frontend`. Target was `src/features/panels/ui/PanelCard.crossFilter.test.tsx` with `getOutputByIdMock` stalled on every resolution at `STALL_MS=1200`:
- BEFORE (main 563a4c476 file content, 7 call sites rewritten), N=3: rc=1 in 3/3 runs, fired=7 each time, `Tests: 3 failed, 4 passed, 7 total`. The failures were "never narrows the originating panel's own data" (`Unable to find role="table"`), the metric SUM test (`Unable to find an element with the text: 250`) and the Fullscreen disclosure test (`Unable to find role="table"`). This matches measurements.md exactly.
- AFTER (HEAD file, same edit), N=3: rc=0 in 3/3 runs, fired=7 each time, `Tests: 7 passed, 7 total`.
- `git status --short` was empty after the probes and after the build.

Specific checks requested:
- (a) `Promise.allSettled` in `settleMocks` (`frontend/src/test/settleChartMount.ts`) does not hide a meaningful rejection. Every source passed at a converted call site resolves: `getOutputById`, `fetchHistory`, `fetchPanels`, `fetchMeta`, `fetchRows`, `fetchDatasetSchema` and the `MarkdownPanel` module are all `mockResolvedValue`/`Once` in those tests. The only rejecting stub is HEL-1600's `fetchOutputHistory`, and no call site passes it. If a passed source ever did reject, the component would still receive that rejection through its own promise chain. Every converted site then asserts that content is present with a throwing `getBy*`, so the test would still fail. The one negative assertion (`not.toContain("vs 7d")` in the chartTruncation AC5 test) is paired with a positive control in the same test that uses the same resolving mocks. The doc comment states the tolerance.
- (b) The waits converted to bare `getBy*` are synchronous after the preceding interaction.
  - crossFilter:302 (HEAD 307): Fullscreen's `useOutputMeta` seeds its `useState` from `getOutputMetaCached` in the initializer (`frontend/src/features/panels/hooks/useOutputMeta.ts:21`). The grid card has already populated the cache, so the overlay renders the disclosure in the same `fireEvent.click` commit.
  - crossFilter:392/416 (HEAD 396/420): these follow `act(() => chart.__onEvents.click(...))`, which is a synchronous state update flushed by `act`. In each case the next line on main was already a synchronous `getByText("105")`, which proves that commit had already landed.
  - My AFTER stall run and the executor's 10 clean runs pass.
- (c) There is no stall code, timeout raise or retry in the diff.
- (d) The HEL-1600 network guard is unchanged.

Code quality: `collectPending` removes the duplication between the two helpers. `settleChartMount` behaves exactly as before (`Promise.all`, then the `ChartPanel` import, in one `act`). The new comments explain why (deadline race, two-stage chain, lazy markdown), which follows the CONTRIBUTING.md comment and ticket-reference rules. No `any`, no dead imports: the unused `waitFor` import was removed from chartTruncation.

### Phase 3: UI Review — N/A
This change only touches test files and a test helper (`frontend/src/**/*.test.tsx`, `frontend/src/test/`). Nothing renders differently and no product UI changed. The orchestrator stated that no UI review was needed, so I did not start dev servers.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- `PanelCard.crossFilter.test.tsx:178/189/202/298`, `PanelFullscreenOverlay.test.tsx:286/294` and `PanelContent.test.tsx:433` use a bare `screen.getByRole(...)` statement as an implicit assertion. That is valid and already used elsewhere, but `expect(...).toBeInTheDocument()` would read more consistently with the neighbouring lines.
- measurements.md "Gates" lists frontend `npm run lint`. The root `npm run lint` also passes (my run), so the claim holds either way.
