## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD 2c4d967335ffe3f6e43b90cb49ca01fdc11a5f9b against base 1cdd7df9084fe812729ea4731f1eda502b94fd98 (live-resolved).
Commits: 2689bb449 (red evidence + root cause, no spec/product change) -> 2c4d96733 (spec fix + green/mutation evidence).

### Phase 1: Spec Review — FAIL

Verified:
- Root cause is supported by the evidence. I grepped the raw CI error-context.md for both attempts of run 45281484916 (scratch `ci-artifacts/a1/...` and `ci-artifacts/report7/...`, lines 123-132). Both show DOM row order Beta then Alpha, with Beta's id sorting lower (0551b620 < cb15cb7d; 27bdd08c < 83e2ecd1), and focus on `Dismiss notification [active]`. That is exactly where Tab lands from the last row's run button. Focus did not drop or get trapped, and no DOM node was replaced. This rules out the ticket's other candidates (re-render/second toast, focus trap/roving tabindex, scroll container) for the observed failures. The local probe (probe-order.txt) agrees: 6/6 Beta-first runs failed and 2/2 Alpha-first runs passed. The red run (red-run-warm.txt) shows 4/12 failing at line 146 with the CI message.
- The comparator matches. `buildDeniedPipelinesToast` sorts with `a.pipelineId.localeCompare(b.pipelineId)` (frontend/src/features/pipelines/services/deniedPipelinesToast.ts:28). The spec derives `alphaFirst` with `alpha.id.localeCompare(beta.id) < 0`, the same function. It also asserts the rendered order directly (`toHaveText` on `.toast__link`, an exact match on both elements, which also pins the count at 2), so a comparator mismatch would fail loudly rather than pass silently.
- The product-vs-test call (D3) is correct. With real key presses, Tab follows the rendered row order (link, run, link, run), which is what `run-to-update-affordance` promises. The spec's hardcoded Alpha-first order was never promised.
- C1: the diff adds no wait, timeout, retry or toPass. The pre-existing `waitForTimeout(5500)` (the persistence check) is unchanged.
- C2: the red commit 2689bb449 precedes the fix commit and touches no spec or product code.
- C3: no assertion was removed. The keyboard step still proves link -> run -> link -> run with three real `page.keyboard.press("Tab")` calls, in the product's row order, and gains a DOM-order assertion. The later Enter/focus-hand-off assertions are unchanged.
- No scope creep: only e2e/hel1172-multi-denial-toast.spec.ts and change-dir evidence. The D6 shard-weight row was left defaulted with a stated reason.

Issue:
- tasks.md 1.2 is checked `[x]` but was not done as written. It says the reproduction was "per design D1: (a) a cold-start loop restarting servers ... and (b) throttled `--repeat-each` warm runs". green-rate.txt states "Cold-start loop: not run", and red-rate.txt states "no CPU throttle". The deviation is well justified: the cause is data ordering, it was reproduced warm, and both CI failures are explained. But the committed task list asserts work that did not happen. The planning artifacts must reflect what was actually done.

### Phase 2: Code Review — PASS

Gates (my own fresh runs in WORKTREE_PATH, after `nice -n 19 npm ci` in frontend/):
- `npm run lint`: exit 0. `npm run format:check`: exit 0. Targeted eslint and prettier checks on the spec file: clean.
- No `frontend/**` or `backend/**` file changed, so `npm test`, the frontend build and `sbt testFull` were not triggered.
- Full spec file (2 workers, lane servers 7274/10181, lane DB helio_hel1842): 5 passed (scratch eval-full-spec.txt).
- `:105 --repeat-each=20 --workers=2`, run 1: 19 passed, 1 failed (scratch eval-repeat20.txt). The failure was environmental. The repeat5 iteration timed out at `support/isolateLivePage.ts:36` (`page.fill("#email")`, inside registerAndLogin at spec line 109, before any toast code). Its trace shows a Vite module request failing with `net::ERR_NETWORK_CHANGED`, so the app never rendered the login form.
- Run 2: 20 passed (scratch eval-repeat20b.txt). Combined: 39/39 passes for every run that reached the code under review. At p = 1/3, P(0 failures in 39 | defect unchanged) is about 1.4e-7.
- Mutation evidence (mutation-run.txt): with `alphaFirst = true` hardcoded, 5/12 runs fail at the new line-154 `toHaveText` row-order assertion, so the guard is failable.

The code is clear: the comment explains why the order is derived. It has no dead code and no type escapes.

### Phase 3: UI Review — N/A

No trigger path changed (only `e2e/**` and `openspec/changes/**`; no `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**`). The e2e behaviour was exercised under Phase 2.

### Overall: FAIL

### Change Requests
1. `openspec/changes/multi-denial-toast-focus-flake/tasks.md` task 1.2: either uncheck the parts that were not done, or rewrite the task to describe what was actually run and why. For example: "warm `--repeat-each` on [dev], 2 workers, no throttle; the cold-start loop (a) and CPU throttle (b) were not run because the probe showed the cause is id-sorted row order, independent of timing; CI-condition evidence is the two CI error-contexts". Make the same correction wherever design.md D1 still reads "(a) is not optional", for example by adding a one-line deviation note under D1. Do not change any code.

### Non-blocking Suggestions
- The spec computes `localeCompare` in Node and the product computes it in Chromium. For lowercase-hex UUIDs with hyphens at identical positions, the two cannot disagree in practice, and the `toHaveText` DOM-order assertion would surface any divergence. No action needed. Mention it in the PR only if a reviewer asks.
- The PR body should record the D6 decision (shard weight left defaulted) and the spinoff candidate (a deterministic, user-meaningful row order, e.g. by name), as root-cause.md already notes.
