# HEL-1353 probe evidence

Probe instrumentation (`evidence/probe-instrumented.test.tsx.txt`, never committed as a test): per-phase
`performance.now()` marks in case (b), a per-test `TEST_END` mark, and a spy on `XMLHttpRequest.prototype.open`
recording URL + current test. Runner: `evidence/run-recipe.sh.txt`. Raw per-run logs/summaries under `evidence/`
(committed text: `evidence/failures.txt` = per-red-run `FAIL <file>` lines and de-duplicated failure messages with counts; full failing-run logs persisted out of repo). All jest runs `nice -n 19 ... --maxWorkers=3`; the burners were
`nice -n 19 sh -c 'while :; do :; done'` x3, PIDs written to a pidfile and killed with `kill <pid>` read from it
(PIDs and `killed <pid>` lines for every recipe are inlined at the end of `evidence/failures.txt`; the original `burner-kill.log` files are persisted, see Persisted evidence below; every pid afterwards "No such process").
No pkill/pgrep/killall.

## Load recipes (and the honest reproduction record)

The design's recipe (3 burners + jest on 12 cores, unpinned) does NOT create contention: 3 burners + 3 workers
use 6 of 12 cores. It never reproduced the red:

| recipe | files | runs | red | file time | worst case (b) |
|---|---|---|---|---|---|
| unpinned, single file (`before-single`) | createPlacement | 10 | 0 | 7.7-8.7 s | 0.52 s |
| unpinned, siblings (`before-siblings`) | `PipelineDetailPage*` (6 files, 167 tests) | 10 | 0 | 27-31 s | 0.55 s |
| `taskset -c 0,1` single (`before-pinned`) | createPlacement | 10 | 0 | 18-19 s | 1.03 s |
| `taskset -c 0` single (`before-pin1`) | createPlacement | 3 | 0 | 36-37 s (the HEL-1277 log's file took 34.6 s) | 1.87 s |
| `taskset -c 0` dir (`before-dir1`) | `src/features/pipelines` | 1 | 0 | 180 s | 2.85 s |
| `taskset -c 0` siblings (`before-sib1`, exploratory) | 6 files | 2 | 1 | 108-120 s | red: case "Y then X", `Exceeded timeout of 5000 ms` (`before-sib1-FAIL-r2.log.gz`) |

The reproducing recipe, used identically for BEFORE and AFTER: **R = 3 burners + jest (`--maxWorkers=3`, the 6
`PipelineDetailPage*` test files), all pinned to one core with `taskset -c 0`** (CPU shared ~7 ways, a CPU-starvation
level in the same class as running jest next to sbt). The pin is a deviation from the design text (the design did
not know unpinned burners do not contend); it is applied identically before and after.

Honesty notes: (1) under R the red hits several cases of createPlacement (and sibling files), not only case (b);
case (b) itself never failed in BEFORE (its loaded max was 4.1 s, 82% of 5 s) -- the HEL-1277 failure on
(b) is the same mechanism hitting a different case that run. (2) Sibling files (`draftCreate`, `creatingStep`,
`PipelineDetailPage.test`) go red under R both before and after (see below); they are out of scope here.

## BEFORE (unfixed file, recipe R, 10 runs, `before-sib1x`)

`createPlacement.test.tsx` red in **6 / 10** runs (r2,r3,r4,r8,r9,r10; 1/1/4/6/7/8 failing cases). Failure messages (de-duplicated
count in failing-case blocks): jest `Exceeded timeout of 5000 ms` x19 (majority), `Unable to find role=...` x3,
`expect(...)` after a waitFor expiry x3. Full logs: `evidence/before-sib1x/FAIL-r*.log.gz`.
Per-case max duration over the 10 runs (ms, from `TEST_END`): a=9984 (own 20 s limit), b0=4013, b1=4108,
c=6566, d(X,Y)/d(Y,X) up to **16573**, e=10663, f=9523, g=8638, h=6441, i=8408, j=7185.
Every non-(a) case's loaded max is above 50% of the 5000 ms default, and 8 of 11 exceed 5000 ms.

## Classification (confirmed / refuted, with numbers)

- **Fixed wait: REFUTED.** Case (b) phases scale with contention instead of sitting on a constant floor
  (render -> `limit_found_clicked` -> `insertAt_done` -> `create_called` -> `resolved` -> `cast_enabled`, ms):
  unloaded 21/53/317/319/341/368; unpinned+burners 37/84/435/437/461/489; pinned 2 cores 91/207/849/850/900/979;
  1 core 162/367/1565/1574/1680/1806; R (before-sib1x) max 308/794/3453/3471/3664/3914. No phase is constant. The page's
  300 ms debounced re-analyze (`usePipelineDetailPage`) is not on the awaited path, and a 300 ms floor cannot explain
  multi-second durations. No `setTimeout` in the test or its helpers.
- **Unresolved promise: REFUTED for the failing waits.** Failures are not pinned to a `waitFor` constant; the case
  completes when given time (after the fix every case passes with the same held-promise `deferredCreate` helper; the
  held create promise is resolved by the test via `act`). The failing assertion is jest's 5 s case timeout (19 of ~28),
  and once that is lifted, testing-library's own 1 s `findBy*` default expires on the same slow phases (`after1-timeout-only`:
  10x "Unable to find" + 10x waitFor-expired assertions across 4/20 red runs). Both are the same slow work meeting a
  wall-clock limit, not a promise that never settles.
- **Fake-timer interplay: REFUTED.** `grep -rn "useFakeTimers\|setSystemTime\|advanceTimers\|fakeTimers"` over the test file,
  `src/test/`, `jest.config.cjs`, `package.json` and `OverlayProvider.tsx`: zero hits. Real timers throughout.
- **Genuinely long work: CONFIRMED (primary cause).** Unloaded each case is 0.3-1.3 s (heaviest (a) 1.3 s); the same
  phases scale uniformly 6-9x under CPU starvation (e.g. `render` 21 -> 308 ms, `insertAt` 317 -> 3453 ms), consistent with a
  full-page render + 8-15 sequential `findBy`/`waitFor` round trips per case being CPU-bound. The two wall-clock
  limits that bite are jest's 5 s case timeout and testing-library's 1 s `asyncUtilTimeout`.
- **Escaped XHR: CONFIRMED as real, PARTIAL as a cause.** Every one of the 12 tests fires exactly one real request:
  `GET /api/pipelines/pipe-1/outputs` (method GET, URL relative -> jsdom `http://localhost/...`, ECONNREFUSED -> the 12
  `AggregateError`s). Source: `outputsSlice.fetchOutputs` -> `outputService.listOutputs`, unmocked in this file (only
  `pipelineService` is). It never leaves a promise pending (it rejects fast), so it is not an unresolved-promise
  cause. Ablation (`ablate-xhr-only`, recipe R, XHR mock only, no timeout change): createPlacement red **3 / 10**
  (vs 6 / 10), per-case max 3.3-6.3 s (a=9.5 s) vs up to 16.6 s before. The mock removes a real CPU cost (socket
  error + virtual-console `console.error` + rejected-thunk re-render per test) and cuts the failure rate, but does not
  eliminate the red on its own.

## Fix (test-side only; `PipelineDetailPage.createPlacement.test.tsx`)

1. `jest.mock("../services/outputService")` stubbing only `listOutputs` -> `[]` (`...requireActual` for the rest): 0 escaped
   XHRs / 0 `AggregateError` after (verified unloaded: `grep -c AggregateError` = 0, 0 `xhr` probe records).
2. `LOADED_CASE_TIMEOUT_MS = 40000` via `jest.setTimeout` (file-scoped; deviation from the design's per-case argument -- Prettier
   re-indents ~550 lines when each `it` gets a non-literal third argument; every case in this file exceeds half of 5 s
   loaded, min 2.8 s, so the effect is identical). >= 2x the worst loaded observation (16.6 s before; 19.3 s seen after).
3. `configure({ asyncUtilTimeout: 20000 })` in `beforeAll`, restored in `afterAll` (the 1 s testing-library default was
   the next limit hit once the case timeout was lifted).
No product file touched; no change to `jest.config.cjs`.

## AFTER (recipe R, identical flags/files)

| attempt | change | createPlacement red runs |
|---|---|---|
| `ablate-xhr-only` | XHR mock only | 3 / 10 |
| `after1-timeout-only` | XHR mock + 40 s case timeout (no asyncUtilTimeout) | 4 / 20 (all findBy 1 s / waitFor expiry, no jest 5 s timeouts) |
| `after2` | + asyncUtilTimeout 20 s (instrumented, per-case-argument form) | **0 / 20** |
| `after3-final` | final committed code (probe removed, `jest.setTimeout` form) | **0 / 20** |

`after2` per-case max (ms): a=9007, b0=3757, b1=3260, c=4175, d=5125, e=**19256**, f=8407, g=8681, h=4496, i=4734, j=2807.
Margin: worst loaded case 19.3 s vs 40 s limit (2.07x); asyncUtilTimeout 20 s vs worst single phase ~2.7-3.5 s.
Reproduction of the red by recipe R before the fix: yes (6/10). BEFORE vs AFTER failure counts (createPlacement file): 6/10 -> 0/20.

Sibling files under R (not fixed here): `draftCreate`, `creatingStep`, `PipelineDetailPage.test` still fail in some
R runs after the fix (`after2` 1/20, `after3-final` 4/20; logs gzipped in `evidence/`). They share the same mechanism
class (default 5 s case timeout / 1 s findBy under CPU starvation) -- spinoff candidate, out of scope.

## PanelCard.test.tsx (HEL-1215) -- read only, not modified

The flake is `src/features/panels/ui/PanelCard.test.tsx:625`, `expect(mockUsePanelPolling.mock.calls.length).toBe(callsBeforeRerender)`
in "PanelCardBody does not re-render when only unrelated PanelCard state changes". It is a **render-count** assertion that
depends on a fixed number of microtask flushes (`await Promise.resolve()` x2 inside `act`) settling a mount-time
`setIsLoading` bailout re-invocation before the baseline is sampled. **Not shared**: the mechanism is microtask-tick
ordering, not wall-clock limits on CPU-bound work; it mocks `outputService` (so no escaped XHR), has no jest-timeout
failure mode, and no phase of it scales with CPU. Different root cause, not escalated, not changed. (Static read only;
I did not run it under load.)

## Persisted evidence (out of repo)

The 22 gzipped failing-run logs (`evidence/**/FAIL-*.log.gz`, `evidence/before-sib1-FAIL-r2.log.gz`), the burner-kill logs
and the instrumented probe copy (`probe-instrumented.test.tsx.txt`) were persisted with `persist-evidence.sh` and removed
from the commit. All live under
`/home/matt/Development/helio/.concertino/runs/HEL-1353/evidence/openspec/changes/createplacement-test-load-timeout/evidence/`
(same relative layout: `<recipe>/FAIL-r<N>.log.gz`, `<recipe>/burner-kill.log`, `probe-instrumented.test.tsx.txt`, `before-sib1-FAIL-r2.log.gz`).
The per-file `READY ref=` values are exactly that directory plus the relative path.
