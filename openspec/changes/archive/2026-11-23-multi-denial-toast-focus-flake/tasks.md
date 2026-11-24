## Standing Constraints

- [C1] Systematic debugging: no fix before a probe-confirmed root cause; no added waits/timeouts/retries as the fix.
- [C2] Red first: the failing run is recorded and committed (as .txt) before any implementation code.
- [C3] No unrelated assertion in any spec is weakened; the keyboard-order assertion still proves Alpha link -> Alpha run -> Beta link -> Beta run with real Tab presses.

## 1. Evidence and reproduction

- [x] 1.1 Download the failed `e2e (7)` artifacts for run 45281484916 per attempt (`playwright-report-shard-7`, `e2e-runner-shard-7`; trace at `test-results/hel1172-multi-denial-toast-f612a-e-focus-never-drops-to-body-dev/trace.zip`; per-attempt logs via `gh api .../runs/45281484916/attempts/{1,2}/jobs` since `gh run view --log` returned attempt 2 for both) into the main checkout's `.concertino/scratch/HEL-1842/`; record where focus was at failure (error-context / trace) in `evidence/ci-artifacts.txt`; verify by quoting the relevant snapshot lines
- [x] 1.2 Reproduce the failure locally on the `[dev]` project: ran warm `--repeat-each` (2 workers, lane DB, lane servers, no CPU throttle); red committed as `red-run-warm.txt`/`probe-run.txt` with the rate in `red-rate.txt` (4/12 unmodified, all at line 146; 6/8 with the read-only probe). The cold-start loop (design D1 (a)) and CPU throttle (D1 (b)) were NOT run: the probe showed the cause is id-sorted row order (random UUIDs), independent of timing, and it reproduced warm; CI-condition evidence is the two CI error-contexts in `ci-artifacts.txt`

## 2. Root cause

- [x] 2.1 Add temporary probe instrumentation (focus/mutation/store-transition log) and capture a failing run's probe output as evidence; verify the output names the event that moves focus or replaces the focused/next element
- [x] 2.2 Write `root-cause.md` in the change dir: the cause, the probe evidence, and the product-vs-test decision per design D3; verify it cites the probe output

## 3. Fix and guard

- [x] 3.1 Implement the minimal fix at the root cause (product if a real keyboard user can hit it); remove probe instrumentation; verify `git diff` contains no added waits/timeouts/retries around the Tab sequence
- [x] 3.2 Add a guard (jest for a product fix, plus the e2e spec) and record a mutation run showing the guard red with the fix reverted; verify the mutation output is committed as `.txt`
- [x] 3.3 Rerun the same conditions that produced red in 1.2 (including the cold-start loop if that produced it) with N_post >= ceil(3/p), p = k/N, per design D5a; commit the green output as `.txt` with the arithmetic stated; verify zero failures across N_post runs

## 4. Regression and housekeeping

- [x] 4.1 Run the toast unit tests (`npm --prefix frontend test -- --testPathPatterns='Toast|toast|deniedPipelines|FormPanelView'`), typecheck, lint, and the full `e2e/hel1172-multi-denial-toast.spec.ts`; verify all pass
- [x] 4.2 Decide on an `e2e/shard-weights.tsv` row per design D6 (expected: leave defaulted and state why in the PR) and, if the file is touched, run the shard planner's own tests; verify they pass
