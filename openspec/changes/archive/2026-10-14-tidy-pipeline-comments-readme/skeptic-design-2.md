## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)
- cwd guard: `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/stale-pipeline-comments-readme/HEL-1451`. HEAD is `e982754f55987b29f9e20b74c468701f2e464a7d`. The only untracked path is the change dir.
- **Round-1 CR1 (port pinning) is resolved.** D5 and task 2.3 now:
  - start this run's own servers with `start-servers.sh "$WORKTREE_PATH" 6883 9790 HEL-1451`, then gate on `assert-phase.sh servers`;
  - run with `DEV_PORT=6883` from the worktree root, which is where `playwright.config.ts` lives (it has `testDir: "./e2e"`, and `DEV_PORT ?? "5173"` is the fallback this closes);
  - record the resolved `baseURL`, and stop the servers via `stop-servers.sh`.

  `workflow-state.md` has `DEV_PORT: 6883` and `BACKEND_PORT: 9790`, which matches.
- **Round-1 CR2 (the `-g` bound) is resolved, and I checked it live.** I ran `DEV_PORT=6883 nice -n 19 npx playwright test e2e/hel813-mobile-touch-target-floor.spec.ts -g "at 430px surface 7: Connectors page" --list`. Output: `hel813-mobile-touch-target-floor.spec.ts:298:11 › HEL-813 mobile touch-target floor guard › at 430px › surface 7: Connectors page` / `Total: 1 test in 1 file`. With `--repeat-each=20` that is exactly 20 runs, and `--workers=2` is within the cap.
- **D1:** `PipelineSchedulerService.scala:213-218` is the comment. `gatedSubmit` (line 230) is an outer `Future.delegate(listByPipelineInternal…).transformWith`. Its empty-reasons branch is `submit(...).transform { case Failure(ex) => log.error; Success(()) }`, and the `recordUnrunnable` branch has its own `.transform`. D1 now handles both round-1 points:
  - it names `submit`'s own lookups as the example (N1);
  - it says not to imply the inner `.transform` is the only guard.
- **D2:** `grep -rn "backfillOutputNode(" backend/src/main` returns 4 hits: `PipelineRunBackfill.scala:61` (def), `PipelineRunService.scala:274` (def) and `:287` (delegation), and `OutputService.scala:77` (`pipelineRunService.backfillOutputNode(...)`). That is the premise, and D2's verification command matches it. The copy at `PipelineRunService.scala:278-284` is accurate as written.
- **D3:** `ls …/services/pipelines/*.scala | wc -l` = 52, and design.md now says 52 (round-1 N2 is fixed). `PipelineAutoRunDebounceFirer.scala` is present and the README omits it. D3 requires every file listed, a re-derive command, no completeness claim, and a grep per role claim. That covers AC3. D6 includes the README's existing "Does NOT hold" claims (N4).
- **D4:** `FireTimeRunConfigGateSpec.scala` is 459 lines, with banners at 226/280/346/391 (each 3 lines). CONTRIBUTING.md:53-56 gives the ~1,000-line threshold. The banners carry four facts, and each is already stated in the class doc or the `should`/test names, so deleting the banners outright loses nothing:

  | Fact | Where it already lives |
  | --- | --- |
  | Gap 2 | `"...(gap 2)" should` at :230 |
  | Gaps 1/3 | test names at :286, :304 and :324 |
  | Red-first base `1bf11f55` | class doc :39-42 |
  | GUARD meaning | class doc :43-45, plus `"negative controls (GUARD)"` at :395 and `"fire-time evaluation error (GUARD)"` at :434 |
- **HEL-1446 overlap (the orchestrator's claim):** I checked it read-only from the main checkout, without touching that worktree. `git diff --name-only origin/main...task/scala-fqn-guard-widen/HEL-1446` lists 77 files. Grepping that list for the planned file set (with `PipelineRunService` matched as a prefix) hits only `PipelineRunServiceTerminalOrderingSpec.scala`, which this change does not touch. So there is no overlap among committed changes. Uncommitted state in that worktree is not covered.
- Coverage: AC1→1.1, AC2→1.2, AC3→1.3, AC4→2.1/2.2, AC5→2.3/2.4, AC6→2.5 plus non-goals. I found no TBDs or placeholders, and no contradictions between the proposal, design and tasks. `.openspec.yaml` has `skip_specs: true`, which fits a change with no behaviour change and no API or schema delta.

### Verdict: CONFIRM

### Non-blocking notes
- The worktree has no root `node_modules` (only `frontend/node_modules`), so `npx playwright` resolves upward to the main checkout's install (`Version 1.55.1`). That works, as `--list` showed. The executor should record `npx playwright --version` in `e2e-flake-probe.md` so the evidence names the runner it used.
- In D4, the sentence "The banners carry two facts not in the `should` names" is followed straight away by the statement that the class doc already carries them. It reads awkwardly but is not contradictory. The executor's grep-per-fact step settles it.
- The "Standing Constraints" heading in tasks.md is empty. That is harmless.
