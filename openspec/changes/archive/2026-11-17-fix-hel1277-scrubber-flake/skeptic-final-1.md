## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: 4eaf79f428c27e09225f6ba4dc23ff84ddc1ad8c. Base resolved live: 54b18b7ce54d9e87cf969f9db947811b415065c1 (one commit ahead).

### What I verified (with evidence)

- **Spawn-cwd guard**: `assert-cwd.sh` returned READY for the worktree and branch.
- **Diff scope**: `git diff BASE...HEAD` touches only `e2e/hel1277-output-history-scrubber.spec.ts` (+3 calls, 1 import), `e2e/support/historySeed.ts` (+24, the new `cancelPendingAutoRun`) and the change dir. No backend, frontend or schema change, which matches D2.
- **CI trace claim (AC1, C1)**: I re-checked this myself. `gh run view 43982387385 --attempt 1` shows `e2e (1)` = failure (attempt 2 succeeded). I downloaded artifact 14285516381 (`playwright-report-shard-1`, not expired) and parsed the dark-theme trace. The history response that the dialog fetched at 00:00:03.649Z has 4 points: 3 `manual` (23:59:57.528, 23:59:57.996, 23:59:58.677) and `2026-11-17T00:00:03.664879Z auto-run hasPayload=false`. The trace's network log has the last `PUT /data-sources/.../rows` at 23:59:58.214Z, so it fired at write + about 5.45 s, which fits the 5 s debounce plus the tick. probe-evidence.md is therefore accurate. Because the trace shows a 4th `auto-run` point, C1's exception applies and calling this the CI failure's cause is allowed. The forced repro is still labelled "forced repro of the mechanism", so C1 holds.
- **UTC-boundary theory**: The cause is a debounced auto-run that happened to land at midnight. Nothing in the replaceRows → upsertDebounce → tick path is keyed on the date.
- **Determinism, not a narrowed window**:
  - `DataSourceService.replaceRows` (backend/.../DataSourceService.scala ~:899) awaits `triggerAutoRunAwaited` before it responds. That calls `upsertDebounce` with fire_at = now + debounce (PipelineAutoRunDebounceRepository:35-45).
  - So the debounce row always exists when the PUT returns 200. The helper deletes it within milliseconds, about 5 s before it can become due. The deletion is asserted to be exactly one row, so if the trigger is ever not armed, the helper fails loudly instead of silently passing.
  - All 3 `putRows` call sites (spec :117, :126, :271) are followed by `cancelPendingAutoRun`.
- **Independent red/green (my own temporary untracked spec copy, now deleted)**: The copy polls the history API for 50 s after run 3, then runs the UI assertions.
  - With the cancel disabled: a 4th point `auto-run` appeared after 8.5 s, and the slider failed with `Expected "2" Received "3"`. Ref: /home/matt/Development/helio/.concertino/runs/HEL-1729/evidence/openspec/changes/fix-hel1277-scrubber-flake/skeptic-red.txt
  - With the cancel: still 3 `manual` points after 50.2 s (more than debounce + one full 30 s tick), and the test passed. Ref: /home/matt/Development/helio/.concertino/runs/HEL-1729/evidence/openspec/changes/fix-hel1277-scrubber-flake/skeptic-green.txt
- **40/40 per test**: I ran the committed spec with `--repeat-each=20 --workers=2 --retries=0` (playwright.config.ts:167 also sets `retries: 0`) against servers pinned to 7161/10068. Result: `80 passed (4.0m)`, exit 0, 0 failed/flaky lines. That is 2 tests x 2 themes x 20. Ref: /home/matt/Development/helio/.concertino/runs/HEL-1729/evidence/openspec/changes/fix-hel1277-scrubber-flake/skeptic-repeat20.txt. This is consistent with the executor's green-repeat20.txt (80 passed).
- **No retries, sleeps or longer timeouts**: Grepping the added e2e lines for timeout/retr/sleep/waitFor finds nothing. The existing `setTimeout(120_000)`, `timeout: 15_000` and `waitForTimeout(800)` were already in main and are untouched.
- **AC3 (product defect?)**: No. The extra point is spec-required dataset-write auto-run behaviour, and there is no duplicate point per run id (the 4 trace points have distinct trigger sources and times). No unit test is owed.
- **Gates on changed files**: eslint `--max-warnings=0` is clean, prettier `--check` is clean, and `tsc --noEmit -p e2e/tsconfig.json` exits 0.
- **Residue**: Both of my temporary runs deleted their pipeline and source in `finally`, and their users through the HEL-1301 teardown ("deleted 1 recorded throwaway user(s)" each). The auto-run row from the red run was consumed when it fired. The repeat run's teardown deleted 80 users. `git status` shows no tracked-file changes; the only untracked file is the evaluator's evaluation-1.md.
- **UI design judgment**: Not applicable. This is a test-only change with no UI diff.

### Verdict: CONFIRM

### Non-blocking notes

- `cancelPendingAutoRun` depends on the pipeline staying auto-runnable (cost verdict allowed). If a future data shape is cost-denied, the helper throws instead of passing. That is loud and intended, but the cause will look unfamiliar to whoever hits it.
- Possible follow-up already noted in the design: should a manual run that has already read a write supersede that write's pending auto-run? This is a product question, out of scope here.
- I left the dev servers on 7161/10068 running for the orchestrator. Stop them with stop-servers.sh.
