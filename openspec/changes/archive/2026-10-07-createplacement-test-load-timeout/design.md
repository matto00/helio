## Context

See proposal.md (Why). `PipelineDetailPage.createPlacement.test.tsx` renders the full `PipelineDetailPage` (real Redux store, router, theme, overlay provider) against a `jest.mock` of `pipelineService` only. Case (a) already carries an explicit `20000` ms timeout with the comment "heaviest case ... ~1.9s under load"; every other case runs on jest's default 5000 ms (no `testTimeout` in `frontend/jest.config.cjs`). The HEL-1277 failure log shows case (b) (both `it.each` rows) timing out, the file taking 34.6 s, and 12 jsdom `XMLHttpRequest` `AggregateError` socket errors -- i.e. some request escaped the mocks and hit the real network (likely a service imported by a slice the page touches, e.g. `outputsSlice`, that this file does not mock). Unloaded, the file passes (8-10 s warm, 30 s cold).

Constraint: HEL-1354 is concurrently changing the page's boot cost. No `usePipelineDetailPage` behaviour change; the fix is test-side unless the probe proves a product defect, in which case the driver signs off first.

## Goals / Non-Goals

**Goals:**
- A measured, named root cause for the case (b) timeout.
- A fix aimed at that cause, with a before/after failure rate under a fixed, reproducible load recipe.

**Non-Goals:**
- Making the page boot faster (HEL-1354's scope).
- Fixing PanelCard.test.tsx (HEL-1215) -- note only; same-cause finding escalates to the driver first.
- A global `testTimeout` raise in `jest.config.cjs` (would hide future real hangs suite-wide).

## Decisions

### D1. Probe before fix (systematic-debugging law)

Instrument (temporarily, never committed) case (b) and its siblings with per-phase wall-clock marks: render -> first `findByRole("Limit rows")` -> expand click -> `insertAt` (gap click + option `findByRole`) -> `waitFor(create called)` -> `create.resolve` -> final `waitFor(Cast type enabled)` -> assertions. Run each configuration unloaded and under the load recipe (D3). In the same runs, capture every escaped network request (spy `XMLHttpRequest.prototype.open`, or the jsdom virtual console) with its URL and the test it fired in.

The probe must answer, with numbers, each of:
- **Fixed wait**: does any phase block on a real-timer `setTimeout`/debounce in the page path (time in that phase ~constant regardless of load, or a constant floor)? 
- **Unresolved promise**: does any `waitFor`/`findBy` wait on something that never settles in this setup (time pinned to a `waitFor` timeout, or the test only finishes via jest's timeout)? Includes the escaped XHRs: does an un-mocked request leave a thunk pending that the page waits on?
- **Fake-timer interplay**: confirm whether any fake timers are installed anywhere in the path (setup file, helpers). None are expected; state the evidence.
- **Genuinely long work**: is time spread across render/re-render phases and does it scale with CPU contention (load multiplier ~ uniform across phases)?

The probe output (raw timings, escaped-request list, classification) is written to the change directory as `probe-evidence.md` and persisted as evidence.

### D2. Fix chosen by the probe's classification

- Escaped XHR / unmocked service: mock the leaking service(s) in this test file (test-side), and report whether doing so changes duration. This is a test-hygiene fix regardless of whether it is the timing cause, but it is only claimed as the root cause if the probe shows it is.
- Unresolved promise / fixed wait in a test helper: fix the helper (e.g. await the right condition, settle the held promise) so the case no longer waits on it.
- Fixed wait in product code: do NOT change product code unilaterally -- escalate with the evidence (HEL-1354 coordination).
- Genuinely long work: give the affected case(s) an explicit timeout derived from the measured loaded maximum (headroom >= 2x the worst loaded observation), with an inline comment stating the measured unloaded vs loaded durations and why the work is legitimately long. Use one named constant shared by every case in the file whose loaded maximum exceeds ~50% of 5000 ms, matching the existing case (a) convention, rather than a file-wide `jest.setTimeout`.
- If more than one cause applies, fix each and attribute the before/after delta to each where measurable.

### D3. Load recipe and evidence

- Burners: at most 3 `nice -n 19 sh -c 'while :; do :; done'` processes, PIDs written to a scratch pidfile at start and killed with `kill <pid>` from that file only. No `pkill`/`pgrep`/`killall`.
- Jest under test: `nice -n 19 npx jest <file>` from `frontend/` (same niceness as the burners so contention is real), workers capped at <= 3.
- If the single-file run never reproduces the timeout before the fix, add in-jest contention by running the file alongside the sibling `PipelineDetailPage.*.test.tsx` files (`--maxWorkers=3`) and record per-case durations, so the before/after comparison is on margin to the timeout, not only pass/fail.
- Before: >= 10 runs on the unfixed file under the recipe (failure count + per-case max duration). After: >= 20 consecutive green runs under the identical recipe. Full logs of every failing run are kept and persisted.

### D4. PanelCard (HEL-1215) comparison

Read PanelCard.test.tsx's failing assertion (a render-count `Expected 2, Received 3`) and state whether it shares the D1 cause. Expected to differ (render-count assertion vs wall-clock timeout); if the probe shows the same cause, stop and escalate to the driver before any change to it.

## Risks / Trade-offs

- [The single-file recipe may not reproduce the 34.6 s full-suite contention] -> D3 fallback adds sibling-file contention and compares per-case margin, not just pass/fail.
- [Raising a timeout can mask a future real hang] -> only per-case, only with a measured reason, and an unresolved-promise cause is fixed, never timed out.
- [Overlap with HEL-1354] -> test-file-only diff; any product finding escalates.

## Migration Plan

None (test-only).
