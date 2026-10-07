## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `fafc863380c861265ac8a2e14c883db28c495125`. Review base resolved live with
`resolve-review-base.sh` (exit 0): `70b063a47`. origin/main has since moved on (HEL-1350 `469f4ea93`,
HEL-1341 `6c7cdcdec`). `git merge-tree --write-tree origin/main HEAD` merges cleanly. HEL-1350 touched only
`outputEditor/**`, `panels/history/chartOverlay*` and an e2e spec, so it does not overlap this branch.

The spawn-cwd guard printed `READY ambient=/home/matt/Development/helio branch=task/pipeline-detail-boot-cost/HEL-1354`.

### What I verified (with evidence)

**Root cause (AC1).** The raw probe logs agree with the claim:
- `logs/probe-strictmode-ON-baseline.log.txt`: `total /api requests=13 run-history GETs=2`.
- `logs/probe-strictmode-OFF.log.txt`: `total /api requests=10 run-history GETs=1`.

It is the same harness both times, and the result flips both ways. The base code has an unguarded
`useEffect(() => dispatch(fetchPipelineRunHistory(id)), [dispatch, id])`, which the diff removes. The sibling
mount effect is guarded by `lastFetchedIdRef`. That fits StrictMode's dev-only double-invoke. The report says
plainly that production never paid this cost.

**Fix and deferral (AC1, AC2).** I read the full product diff: `useRunHistory.ts`, `usePipelineDetailPage.ts`,
`pipelinesSlice.ts`, `PipelineDetailPage.tsx` and `RunHistoryModal.tsx`.
- Run history is now fetched in only four situations:
  - on boot, only when this open's own `fetchPipelineById` fulfils with `lastRunTruncated === true`;
  - on a click-time modal open;
  - on a forced post-run refresh, which covers `onTerminal`, `handleRunPipeline` and `handleDryRun`;
  - on Retry.
- Freshness is the per-open token (`runHistoryLoadedOpenId === openId`).
- Latest-request-wins uses `requestId`.
- The modal closes when `id` changes, via the derived-state branch.
- The `data-sources` StrictMode duplicate is removed with a per-mount ref.
- `boot-audit.md` gives every other call a named first-paint consumer and a "keep" decision.
- Effect order is correct: the `openIdRef` sync effect is declared before the boot effect in the same component.

**Measurements (AC3), checked against the raw logs rather than the tables.**
- I recomputed hel910 from `before/after-hel910-b1.json`:
  - Both sides: 20 results, 14 passed and 6 `timedOut`.
  - Before: min 26.66 s, max 31.43 s, passes 26.66–29.92 s.
  - After: min 27.17 s, max 31.62 s, passes 27.17–29.97 s.
  - These match `measurements.md`. "No measurable change" is an honest summary.
  - The reported p50 (29.2 / 29.6 s) is the upper median, i.e. the 11th of 20. The true median is 29.12 / 29.15 s. The convention is the same on both sides and the conclusion does not change (note 1).
- The meta logs (`*-hel910-b1.meta.log.txt`) record:
  - burner PIDs and the sampler PID;
  - the load gate (1.77 and 1.98 before each batch);
  - loadavg after each batch;
  - the SHA.

  That meets C1, except that the exact command and env, including `HEL1298_THROTTLE`, are not written down (note 2).
- I corroborated that 8x throttling was actually applied: my own unthrottled run of the committed hel910 spec took 7.2 s, against 27–31 s in the batches.
- `cycle2-after-truncated.log.txt`: `truncated=true total /api requests=11 run-history GETs=1`.
- The direct-goto TTI is described as "no measurable change". The post-create gain is described as a small 3% at 6x. The write-up states that hel910 headroom is not served by this change. All of that is an honest characterisation.

**Gates, re-run fresh by me in the worktree under `nice -n 19`:**
- `npx jest --maxWorkers=2 src/features/pipelines`: 88 suites, 1155 tests passed.
- `npm run typecheck`: exit 0.
- `eslint --max-warnings=0 frontend/src/features/pipelines`: exit 0.
- `prettier --check` on the changed frontend files: clean.
- `DEV_PORT=6786 BACKEND_PORT=9693 npx playwright test e2e/hel910-pipeline-to-dashboard-flow.spec.ts --workers=1`: 2 passed (7.2 s and 2.5 s).

**The tests catch the bug (AC4).** I did not rely on the evaluator's mutation run. I ran my own 8 mutations in a
scratch copy of `frontend/src`, with `node_modules` symlinked and the worktree untouched. For each one I ran
`PipelineDetailPage.runHistory.test.tsx` and `pipelinesSlice.test.ts`. Every mutation turned red:

| mutation | red tests |
|---|---|
| M1: restore a fetch-on-mount effect (the base behaviour) | 6 |
| M2: post-run refresh not forced | 1 (forced-refresh test) |
| M3: drop the latest-request-wins guard in `fulfilled` | 2 (RTL + slice) |
| M4: freshness ignores `openId` | 3 (revisit / late-response / A→B→A) |
| M5: drop the `sourcesRequestedRef` guard | 1 (StrictMode data-sources) |
| M6: modal does not close on `id` change | 1 |
| M7: token not renewed on `id` change (a `<mount>` token) | 1 (A→B→A) |
| M8: boot chain never fetches on truncated | 2 (truncated open, StrictMode revisit) |

The existing tests in `PipelineDetailPage.test.tsx` were migrated deliberately: history is mocked at the service
and awaited, never seeded. The old "dispatches on mount" test became a no-fetch assertion. The post-run call count
went from 2 to 1 with a reason given. I found no weakened assertion.

**No regressions; UI judgment.** I ran my own headless Chromium script under `nice -n 19`. It did not use the
shared MCP browser or any `/tmp` cookie jar. I ran it against :6786/:9693 in light and dark themes, after
`assert-phase.sh servers` printed `PASS servers`. Results were the same in both themes:
- Boot: 10 `/api` requests, 0 run-history requests, 1 data-sources request.
- Modal loading state: titled "Run history" with no count.
- Error state (500): shared `PageStatus` with Retry. Retry issued exactly 1 more GET, then the list showed.
- A run followed by a modal open: "Run history (1)" in light, "(2)" in dark.
- Truncated open (pipeline GET intercepted): exactly 1 run-history GET, and the banner renders.

Console output was only resource lines: the existing schedule 404 and my injected 500. There were no page errors.

On design, the loading and error states reuse the shared `PageStatus` with no new CSS. The colours come from
tokens, and the states sit in the existing modal chrome. Light and dark match each other and the sibling modal
states. I have no design objection.

Screenshots, persisted:
- `/home/matt/Development/helio/.concertino/runs/HEL-1354/evidence/.concertino/runs/HEL-1354/skeptic-final-1/{light,dark}-2-modal-loading.png`
- `.../{light,dark}-4-modal-error.png`
- `.../dark-5-modal-after-run.png`
- `.../light-6-truncated-banner.png`

Probe output: `.../probe.out`. Mutation logs and script: `.../mut-M*.log.txt` and `.../mut.py.txt`.

**Scope.** `git diff --stat 70b063a47...HEAD` touches only `frontend/src/features/pipelines/{hooks,state,ui}/*`
and this change directory. It does not touch `ci.yml`, `playwright.config.ts`, `.gitignore`,
`outputEditor/**`, `buildChartOption`, or any `e2e/zz-hel1354-*` file.

**Dev-DB rows I created** (`matt@helio.dev` was never touched):
- Users:
  - `e2523e42-af35-4fac-b83b-f8cef8a217df` (`zz-hel1354-skeptic-1791364695612@example.com`), with source `bc3e98cc-74a1-4f6a-be86-a22f618daf78` and pipeline `39771ac9-1d9a-45b7-99ef-5b2d97ddb816`. This came from a first probe attempt that failed on a script bug; its log is superseded by the rerun.
  - `6c6fd15a-4f8f-420c-ab06-a35e3e2dc8fd` (`zz-hel1354-skeptic-1791364707909@example.com`), with source `a1671efb-c2af-4cf5-9e5d-cac57c72f2e8`, pipeline `2441a2e8-be7a-434a-9416-5250f8026483` and three manual runs.
- hel910 spec users: `dfafcc4b-2739-492a-a11a-2c7d9fa457ac` (`hel910-full-flow-1791364815039-46336@example.com`) and `e94f028d-e9ad-4ec7-9656-ed6619d8e690` (`hel910-existing-output-1791364821938-30114@example.com`).

**Gate-defect check (CON-160).** The evaluator's cycle-2 provenance rests on content checksums of the five product
files, not on mtime ordering. I found no reliance on mtime ordering, so there is no gate defect.

### Verdict: CONFIRM

### Non-blocking notes
1. `measurements.md`'s hel910 "all-runs p50" uses the upper median: 29.2 / 29.6 s, against a true median of 29.12 / 29.15 s. Consider reporting the true median in the PR body. The conclusion does not change.
2. The hel910 meta logs do not record the exact command or `HEL1298_THROTTLE=8`, which D5 asks for. 8x is corroborated indirectly: 27–31 s throttled against 7.2 s unthrottled.
3. `evaluation-2.md` is untracked in the worktree (`git status`). The orchestrator should commit it with the delivery artifacts.
4. For the boot path, the StrictMode run-history dedupe is actually done by `lastFetchedIdRef`, not by the thunk `condition` that design D3 credits. The `condition` still dedupes repeat modal-open and Retry dispatches. This is harmless and does not need a change.
5. The run-history modal grows from the one-line loading state to the list, a small height jump. This is acceptable and consistent with other `PageStatus` modals.
6. The branch is based on `70b063a47`. origin/main now includes HEL-1350 and HEL-1341. The merge is clean and the files do not overlap.
