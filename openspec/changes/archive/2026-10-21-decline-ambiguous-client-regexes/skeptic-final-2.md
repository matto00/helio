## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD `7b402cd5f0bc32d6477c9d1e7e8aa93a5b290dba`. I resolved the base live with `resolve-review-base.sh`: `4f729eed7dd52150f056b6f5a20eac856cb794a7`. The diff is three commits and 26 files. It touches the evaluator only (`javaRegex.ts`, plus the new `javaRegexCost.ts` and `javaRegexSets.ts`), tests, the parity corpus, one e2e spec and openspec artifacts. No `.tsx` or CSS file changed, so there is no UI or design-judgment surface.

### What I verified (with evidence)

**Spawn guard.** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/client-regex-backtracking-guard/HEL-1683`.

**What changed since the round-1 CONFIRM.** `git diff --stat e872cf975..HEAD` shows:
- `e2e/hel1683-regex-main-thread.spec.ts`
- `javaRegex.test.ts`: 7 added lines, a new boundary case for a run of dot atoms (`.*....` accepted, `.*.....` declined, `.*.{4}` / `.*.{5}`)
- openspec reports and evidence

No production file changed. Round 1's ground-truth checks of the D2/D3 implementation (full read, random soundness search, mutations, Scala parity spec run) therefore still apply to unchanged code. I re-checked only what moved.

**AC1 is red-first on the base tree with 2 rows. I reproduced this as a real e2e failure without editing the worktree.**
- I put a scratch copy of the spec under the scratchpad, byte-identical except for one `page.route`. That route serves the type-stripped **base** `javaRegex.ts` (`git show 4f729eed7:...`, run through `node:module.stripTypeScriptTypes`) in place of Vite's head module.
- The base module exports only `compileJavaRegex`, the one symbol `steps/stringOps.ts` imports. The route counter logged `[RED] base javaRegex served 2 time(s)`, so the swap took effect.
- I ran it under the e2e flock with `--workers=1 --repeat-each=2`. Both runs failed on the assertion, not on a timeout:
  - `probe pattern ^(.*.*.*.*.*.*.*.*x): longest main-thread task was 492.0 ms, must be <= 100 ms (control 0.0 ms)`
  - the same failure at `480.0 ms`
- In both runs the probe sent no draft-preview request, because the base tree evaluated the probe on the client.
- The global teardown printed `deleted 2 recorded throwaway user(s)`.

**How much the red result depends on a fresh regex compile.** I measured in Chromium (MCP browser, dev server page) with the base `DOT` translation of the probe over 2 cells of `"a"x28+"!"`. The first compile and exec took **366 ms**. Recompiling the same source (warm V8 regex code) took **125 ms**, three times.
- So red depends on a cold compile for its large margin. Even warm it stays above 100 ms on this machine, but only just.
- In the spec the probe source is compiled for the first time in a fresh browser context. Only `(x)` and `(a+)!` are compiled before it, and `compileJavaRegex`'s cache is keyed on the pattern. So the cold path is the one measured, at about 4.8x the bound.
- Slower CI runners make the regression signal larger, not smaller.

**The control is not vacuous.** The saved pattern `(x)` leaves `out` empty. The control edit `(a+)!` must render the exact cell `"a"x28`, and the source cell is `"a"x28+"!"`, so an exact match can only be the computed `out`.
- The test also asserts that no draft-preview request was made in the window.
- In my red runs the control passed on the base tree (0.0 ms, client rows) while the probe failed. That shows the control proves "the client ran in this window" independently of the probe.

**`live.or(budgetError)` cannot pass vacuously.** I checked this against the source.
- `StepPreviewTable.tsx:177-185`: the caption is "live" only when `view.status === "ok" && !view.frameStale`.
- `draftStepView.ts:104-148`: a declined step (`needsServer`) maps through `mapServerResolved`. That is "ok" only when `transport.results` holds a server `step` line for it, and not stale only when `transport.rows.stepId === stepId` (server rows). Otherwise it is "pending" (caption "updating"), "error" or "stale".
- `useDraftPreviewTransport.ts:145-152`: results are exposed only when `state.key === builtKey`. So the control-era state can never show "live" for the probe's draft, and neither can any earlier response.
- The budget branch is filtered on the probe pattern text, and in that state the caption is "stale", not "live".
- Before the `.or()` there is a hard assertion that at least one draft-preview request was sent.
- A non-budget server error, a transport failure or a permanent pending state matches neither locator, so the assertion fails.
- A `429` from the draft-preview in-flight cap is retried by `draftPreviewScheduler.ts:102` after `Retry-After`, well within the 15 s timeout.

**Green, run by me.** I ran `DEV_PORT=7115 BACKEND_PORT=10022 nice -n 19 flock ... npx playwright test e2e/hel1683-regex-main-thread.spec.ts --workers=2 --repeat-each=4 --trace retain-on-failure` and got **4 passed (24.3 s)**.
- Every control, probe and overrun longest task was 0.0 ms.
- Every probe made a `POST /api/pipelines/<id>/draft-preview` request.
- `assert-phase.sh servers ... 7115 10022` printed `PASS servers` first.

**Timing sensitivity on slower runners.** I found no remaining flake path.
- The probe's server outcome is the only speed-dependent part: about 0.75 s for 2 cells against the 2 s budget. Both outcomes are accepted, and each is specific to the probe step.
- The overrun only gets more certain as the runner slows. A runner would have to be more than 2.6x *faster* than this desktop to finish `^(a*a*a*a*a*a*a*a*a*a*)$` on 2 cells within 2 s; that estimate uses the evaluator's 2.6-3.0 s per cell for raw Java, consistent with `evidence/server-overrun.md`'s 2.08 s time-boxed response on 1 cell.
- Results are keyed per request, so a probe budget error cannot satisfy the overrun's unfiltered text locator: it disappears as soon as the draft key changes.
- The fixed waits (1500 ms after the control, 3000 ms probe window) can only cause false passes, never flakes. The probe's long task is synchronous on `fill` (`draftEvaluation.ts:80-95`: no debounce in the client walk), so it always lands inside the window.
- The long-task observer is shown to work in this Playwright Chromium by the red runs.

**Gates I re-ran on the changed files.**
- `HELIO_JEST_MAX_WORKERS=2 npx jest src/features/pipelines/evaluator`: 8 suites, 836 tests passed.
- `tsc --noEmit -p e2e/tsconfig.json`: exit 0.
- `prettier --check` on the spec and `javaRegex.test.ts`: clean.
- `eslint --max-warnings 0` on the spec: exit 0.

**AC2 (normal regexes unchanged, parity corpus green).** The parity corpus is unchanged since round 1, which ran the Scala `PipelineStepParitySpec` (709/0) and the frontend parity test. Today's evaluator jest run covers `javaRegex.test.ts`, including the new dot-run boundary. `git diff base...HEAD -- shared-test-fixtures/` only appends `regex declines:` vectors. No existing expectation was edited.

**Evidence and mtime discipline.** No claim here rests on mtime or directory ordering. Every number above comes from a command or browser output I read myself in this session. The evaluator reports do not disclose unsound evidence mtimes, so there is no gate defect to record.

### Verdict: CONFIRM

### Non-blocking notes
- The comment at `e2e/hel1683-regex-main-thread.spec.ts:9` says "~165 ms per cell". Measured: about 180-250 ms per cell when freshly compiled, about 60 ms per cell warm. Red relies on the fresh compile, so the warm margin over 100 ms on 2 cells is thin (125 ms). The comment should state that red depends on the first compile in a fresh context, so that no future edit compiles the probe source earlier in the test.
- The overrun locator (line 177) is not filtered on `OVERRUN_PATTERN`. It is not vacuous today because results are keyed per request, but filtering it as the probe's locator is filtered would make it self-evidently specific.
- `evaluation-3.md` is untracked in the worktree. Commit it with the delivery artifacts.
- Carry over from round 1: the PR body should disclose the residuals (single-wide O(n^2) per cell on long cells, an accepted constant up to about 21x of `a*b`, conservative over-declines to the server).
