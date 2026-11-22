## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD f7600e71430ed562e092019e754f163aa29abf2b against base c405b68179c46b59e3f7f06940e3acc5d2031999 (resolved live via resolve-review-base.sh).

### Phase 1: Spec Review — FAIL

The code change matches the design. D1 to D3 and D5 to D7 are honored, and task 4.1 is unchecked as expected (orchestrator, post-push). The AC1 margin statement is wrong, and so is one planning-artifact claim. Details:

- AC1 "the PR states the measured margin": `evidence/margin.md` is the source the PR will quote, and its margin is overstated. See change request 1.
- AC2 "each probe still fails under its mutation": met. I checked the raw runs, not the summary. In `mutation-M1-run.txt`, the HEL-1683 probe fails at spec:291 (373.0 ms, a `toBeLessThanOrEqual(100)` failure, not a timeout) and HEL-1697 fails at spec:374 (561.0 ms). In `mutation-M2-run.txt`, HEL-1807 fails at spec:439 on the no-draft-preview assertion, and its timing read 0.0 ms. margin.md and tasks 3.3 say this plainly. The mutation diffs touch only `frontend/src`, and the committed tree has no such change (`git diff` base...HEAD on frontend/ is empty).
- AC3 "the rest of the e2e suite is unchanged": met. `red-list-dev.txt` and `green-list-dev.txt` differ only by the three hel1683 lines (1080 → 1077 tests, 143 → 142 files). The prod-build list gains exactly those three. The shard plan max goes from 1465 s to 1464 s, so it is not higher (D6). `e2e/shard-weights.tsv` is not edited.
- Planning artifact inaccuracy: in design.md:75 (Risks), the M1 regex cost is "~1.1-1.3 s ... so it is build-independent". The production-build M1 run measured 561.0 ms for the same HEL-1697 frame (mutation-M1-run.txt), roughly half the dev-build figure. So the cost is not build-independent. The mutation still clears the bound by more than 5x, so the gate holds, but the stated rationale is contradicted by the lane's own evidence. See change request 3.
- CONSTRAINTS: none (empty list).

### Phase 2: Code Review — FAIL

Gates I ran myself in WORKTREE_PATH (outputs are in .concertino/scratch/HEL-1816/eval-*.txt). Every one exited 0:
- `npm run lint` passed.
- `npm run format:check` passed.
- `npm run check:e2e-prod-build-projects` passed, and its `:selftest` passed (11 cases).
- `npm run check:e2e-types` passed.

`npm test`, the frontend build and `sbt testFull` were not triggered, because no changed file matches `frontend/**` or `backend/**`. The production build itself was built and served by my own `e2e:prod-build` run below.

Fresh production-build run: I used the HEL-1699 lane sequence with the lane DB and the empty Anthropic key, then restored the lane servers with start-servers.sh (READY 10155/7248). Result: 4 passed (guard plus the 3 probes), and every window read 0.0 ms. Output: .concertino/scratch/HEL-1816/eval-prod-run.txt.

`git diff -w` shows the spec diff is three `{ tag: "@prod-build" }` insertions plus three comment edits. Everything else is Prettier re-indentation. Assertions, patterns, frames and waits are unchanged.

Issues:
- The stated margin is inconsistent with what the observer can measure (change request 1). The probes read a `longtask` PerformanceObserver (spec:95). The Long Tasks API emits entries only for tasks over 50 ms. `longestTask` returns `Math.max(0, ...w.__hel1683)` (spec:154), so "0.0 ms" means the entry list was empty, not that the task took 0 ms. Every window in every committed run prints `(tasks: )`, an empty list. What the evidence actually supports is "no task over 50 ms in any window", so the margin is at least 50 ms. It is not "100 ms". The table's "worst 0.0 / margin 100" rows misstate that. The same applies to the LoAF line "frames: none >= 30 ms": `long-animation-frame` entries also exist only for frames over 50 ms, so the 30 ms filter (spec:165) never sees a 30–50 ms frame. That is pre-existing code and I am not asking for it to change, but margin.md should not read it as resolving below 50 ms.
- The throttled-run claim is not self-authenticating (change request 2). Nothing in `prod-run-throttled.txt` shows that `HEL1808_CPU_THROTTLE=4` was set. Its npm header is identical to the unthrottled runs (`node scripts/e2e-prod-build.mjs e2e/hel1683-regex-main-thread.spec.ts --workers=2`). `applyDiagnosticThrottle` (spec:223) logs nothing. The test-1 duration is 10.3 s against 10.0–10.8 s unthrottled, and every reading is the same 0.0. The column may be correct, but nothing committed distinguishes it from a fourth unthrottled run.
- Stale comment (change request 3). spec:342 still says "with the decline disabled the Playwright harness measures one 1.1-1.3 s main-thread task (1147, 1259, 1349 ms)". It does not say that these numbers are dev-build figures. Task 2.1 required keeping historical numbers "attributed to the dev build". The test now runs on the production build, where M1 measured 561.0 ms.
- No other findings: no dead code, type escape hatches, security surface, or scope creep. README and CONTRIBUTING prose is accurate: grep confirms hel1631, hel1632 and hel1683 are the tagged users.

### Phase 3: UI Review — N/A

None of the changed files match the triggers (`frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**`). They are e2e spec, docs and change artifacts. My production-build e2e run above is recorded as Phase 2 evidence.

### Overall: FAIL

### Change Requests
1. `openspec/changes/prod-build-regex-probes/evidence/margin.md`: restate the margin in terms of what the `longtask` observer can report. Replace the "worst 0.0 / margin to 100 ms = 100" columns with "no long task observed (entry list empty: `(tasks: )` in every run)". State that the Long Tasks API reports only tasks over 50 ms, and that `longestTask` returns `Math.max(0, ...[])` = 0 for an empty list (spec:154). Then give the margin as a lower bound: every window's longest task was under 50 ms, so the margin is at least 50 ms, and it is not measured more finely than that. Apply the same reading to the dev-baseline column, and note that "frames: none >= 30 ms" cannot resolve 30–50 ms frames, because LoAF entries also start at 50 ms. The PR body (task 4.1) must quote this corrected margin.
2. `evidence/margin.md` plus a re-run, or a caveat. The `HEL1808_CPU_THROTTLE=4` column needs evidence that the throttle was set. Either re-run it with the exact command line captured in the file (for example, a first line `HEL1808_CPU_THROTTLE=4 DEV_PORT=7248 BACKEND_PORT=10155 npm run e2e:prod-build -- e2e/hel1683-regex-main-thread.spec.ts --workers=2` written before the output), or state in margin.md that the throttled run's invocation was not recorded and that its output is indistinguishable from the unthrottled runs. Do not change the spec to add logging; this is evidence-only.
3. `e2e/hel1683-regex-main-thread.spec.ts:342`: attribute "1.1-1.3 s (1147, 1259, 1349 ms)" to the dev build, and add the production-build M1 reading. For example: "with the decline disabled the harness measured one 1.1-1.3 s main-thread task on the dev build (1147, 1259, 1349 ms) and 561 ms on the production build (HEL-1816), both far over the 100 ms bound". Correct `design.md:75` the same way: the M1 cost is not build-independent (561 ms on the production build), but it still exceeds the bound by more than 5x.

### Non-blocking Suggestions
- margin.md already notes that the dev baseline also read 0.0, so the ticket's dev-noise false-red premise did not reproduce on this host. Keep that sentence in the PR as well. CI is where HEL-1808 saw the tail, so the PR's CI `e2e-prod-build` timing (task 4.1) is the real measurement.
- A future ticket could switch the bound's measurement to LoAF `blockingDuration`, or add a sub-50 ms probe, if a margin finer than "under 50 ms" is ever needed. That is out of scope here.
