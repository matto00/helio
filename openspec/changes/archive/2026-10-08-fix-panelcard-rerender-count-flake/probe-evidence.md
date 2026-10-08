# HEL-1215 probe evidence

## Recipe
`nice -n 19 npx jest --config jest.config.cjs <file> [-t "does not re-render when only unrelated"] -i` run in a loop from
`frontend/`, with 3 `nice -n 19` busy-loop burners (pids in a pidfile, killed via `kill <pid>`) = 4 CPU-heavy procs total.
Sibling recipe: `src/features/panels/ui/PanelCard` (15 files) `--maxWorkers=3`, 0 burners. Rates measured only on the
un-instrumented tests (committed test = BEFORE, fixed test = AFTER).

## BEFORE (committed test)
| recipe | N | fails | p_before |
|---|---|---|---|
| single test (-t), 3 burners | 40 | 4 | 0.10 |
| whole file, 3 burners | 30 | 1 | 0.033 |
| sibling files, maxWorkers=3, 0 burners | 30 | 0 | (never failed; no AFTER needed) |
Every failure: `Expected: 2  Received: 3` at PanelCard.test.tsx:618. Failure logs persisted (before-single-*.log).

## Root cause (CONFIRMED)
Instrumented scratch copy (`PanelCard.scratch.test.tsx.txt`, `useOutputMeta.probe.diff`; uncommitted) timelines:
- Mount: render#1 (mount), render#2 (store/pagination pending), then two `useOutputMeta` instances (PanelCardBody + PanelCard
  line 457) each run `Promise.resolve().then(() => setIsLoading(true))` - a same-value update.
- Those microtasks fire AFTER `renderWithStore` returns, i.e. while `waitFor` has the act environment OFF, so the update
  goes to React's real Scheduler (jsdom: MessageChannel macrotask), not the act queue. React then re-invokes
  `PanelCardBody` once (bail-out render, render#3).
- PASSING run: render#3 lands ~0.8ms after waitFor resolves (inside the 2-tick flush) -> baseline=3, rerender adds none.
- FAILING run: baseline sampled =2 (Scheduler macrotask has not run); render#3 then appears ~2ms after the title-edit
  `rerender` (act flushes all pending root lanes) -> `Expected: 2, Received: 3`.
- Load dependence: Scheduler MessageChannel message vs RTL `asyncWrapper`'s `setTimeout(0)` drain - ordering of a poll-phase
  message vs 1ms timer varies with event-loop load.
Hypotheses: late mount render CONFIRMED; harness artefact: StrictMode REFUTED (no StrictMode in renderWithStore/src/test:
grep empty), profiler none; act-boundary effect CONFIRMED (the update is scheduled outside act); test-to-test leakage
REFUTED as necessary (single -t runs fail at 10%, higher than whole-file 3%); product defect / memo broken REFUTED
(the render happens even with the title-edit rerender removed - see injection).
Real extra render by the rerender itself: REFUTED.

## Injection (mechanism, uncommitted scratch)
Fake `MessageChannel` delaying Scheduler's task by 15ms (`INJECT_DELAY=15`): old settle -> `Expected: 2 Received: 3` 3/3 and
5/5 (M2). With the title-edit rerender REMOVED and a 60ms wait, render#3 still arrives -> it is the deferred
`setIsLoading` bail-out render, not caused by the rerender. With the fix + injection (delay 15/60/0): pass.

## Fix
`PanelCard.test.tsx` only: after the existing flush, a rerender with identical props inside act (before the baseline sample)
makes React process every pending lane synchronously, so the deferred mount-time render is absorbed deterministically.
Assertion stays an exact `toBe`. No PanelCard.tsx / hook edit.

## AFTER (identical recipes)
| recipe | N (>= max(50, ceil(3/p))) | fails |
|---|---|---|
| single test, 3 burners | 50 (need 50) | 0 |
| whole file, 3 burners | 90 (need 90) | 0 |

## Mutations (each 5/5 red)
- M1: PanelCard.tsx:749 `onDataPointSelect={(...a) => handleDataPointSelect(...a)}` -> `Expected: 3 Received: 4` 5/5 (logs m1-*.log);
  reverted, `git diff -- frontend/src/features/panels/ui/PanelCard.tsx` is empty.
- M2: old settle (no settle rerender) + 15ms injection -> `Expected: 2 Received: 3` 5/5; fix + injection -> 5/5 pass.
