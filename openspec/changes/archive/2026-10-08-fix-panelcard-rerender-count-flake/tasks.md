## Standing Constraints

- [C1] No fix without a probe-confirmed root cause and a measured natural red; no natural red within the cap -> stop and report (escalation), never raise the cap.
- [C2] Never loosen the render-count assertion (`<=`, ranges, retries); any assertion-semantics change is an escalation.
- [C3] Load: at most 4 concurrent CPU-heavy processes total, all `nice -n 19`; burner PIDs in a pidfile, killed only via `kill <pid>`; never pkill/pgrep/killall; never `jest --coverage`.
- [C4] No writes under `~` (npm cache/logs to worktree/scratch); never HUSKY=0 / commit -n without disclosure; `git -C`, not cd.
- [C5] No PanelCard.tsx edit without reporting first (HEL-1304 contention); no restructuring (HEL-1365). Exception: the reverted M1 mutation, proven by an empty `git diff` on that file.
- [C6] Failure rates are measured only on un-instrumented tests; N_after >= max(50, ceil(3 / p_before)) with 0 failures, else escalate.

### Frontend

- [x] 1.1 Add temporary render-timeline instrumentation to a scratch copy of the test (not committed); verify it prints each PanelCardBody render with timestamp and cause.
- [x] 1.2 Check `renderWithStore`/test setup for StrictMode or Profiler; verify the harness-artefact hypothesis is confirmed or refuted with file:line evidence.
- [x] 1.3 Run the D2 natural recipe on the COMMITTED (un-instrumented) test (>= 30 single-test, >= 30 file, sibling-contention batch); verify p_before and N and fail count are recorded with full logs of every failure.
- [x] 1.4 Run the D2 deterministic injection; verify the exact `Expected: 2, Received: 3` reproduces and which update it delays.
- [x] 1.5 Write `probe-evidence.md` with each D1 hypothesis confirmed/refuted; if 1.3 had 0 failures, stop here and report.
- [x] 2.1 Apply the D3 fix for the confirmed cause; verify the test passes unloaded and the injection from 1.4 now passes.
- [x] 2.2 Remove all probe instrumentation; verify `git diff` shows only intended changes (no PanelCard.tsx edit unless reported).

### Tests

- [x] 3.1 AFTER: N_after >= max(50, ceil(3 / p_before)) runs of the fixed, un-instrumented test under the identical recipe; verify 0 failures beside BEFORE.
- [x] 3.2 Mutations M1 (memo boundary, reverted; empty PanelCard.tsx diff) and M2 (old settle + forced delay); verify each red 5/5.
- [x] 3.3 Run frontend gates (lint, typecheck, format:check, jest for panels ui) and commit through hooks; verify all pass.
