## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `e075255de403d164ea52543416ca654a0c5e5b57`. Diff base, resolved live with `resolve-review-base.sh`: `54c2f222e09adcaa49fcf0b86bf643a3fc3f3426`.

Evaluator evidence, copied with `cp -p` to `/home/matt/Development/helio/.concertino/runs/HEL-1366/evidence/evaluator-cycle1/`. Every claim below rests on file content, not on mtimes:
- `eval-testFull.log`: `sbt testFull` on the worktree. Tests: succeeded 6090, failed 0, canceled 4. exit=0.
- `eval-red-repro.log`: the new spec run in a throwaway detached worktree at e075255de, with only `PipelineRunService.scala` reverted to the base. Result: 5/5 FAILED. The worktree has been removed.
- `eval-mutation-probe.log` / `eval-mutation-probe-family.log`: the mutant probe described in Phase 2. Results: 5/5 pass, and 258/258 pass across 17 suites.
- `eval-hel1094-repeat.log`: hel1094 `--repeat-each=4 --workers=2` under `nice -n 19`, against a backend I started fresh at 14:29 from the worktree at HEAD (start-servers.sh, ports 6798/9705). Result: 4 passed.
- `eval-touched.log`: the 9 non-quarantined touched specs, workers=3, nice. Result: 20 passed.

The executor's own logs (gitignored, so they would not survive cleanup) were persisted to `/home/matt/Development/helio/.concertino/runs/HEL-1366/evidence/openspec/changes/sse-terminal-after-persist/{red-prefix-run,green-run,hel1094-repeat}.log`.

### Phase 1: Spec Review — FAIL

- AC1 (root cause, no longer wait): PASS. The terminal publish now follows the write chain on all five terminal sites (`PipelineRunService.scala:1153, 1262, 1352, 1381, 1609`). There are no other `RunStatusEvent` terminal publishers in `backend/src/main`. The hel1094 120 s waits are untouched.
- AC2 (red-first ordering proof on every terminal path): PASS. See scrutiny (a) below.
- AC3 (hel1094 repeated): PASS. The executor's 4/4 plus my independent 4/4 against a backend started fresh at HEAD.
- AC4/AC5 (helper consolidation): PASS. See (c) and (d).
- D3 consumer enumeration: PASS. My own grep confirms `registry.publish` is called only from `PipelineRunService.publish`. `eventRegistry` is read only by `PipelineRunStreamRoutes`, and the bus is consumed only by the registry. `AlertEvaluationService` (now awaited before `succeeded`) makes no network calls, so the D1 escape hatch is correctly unused.
- **D2: FAIL (binding design decision not met in substance).** D2 says: "Tests must assert a single terminal event per run". It also requires that the event is published "even when a terminal write fails". The spec's `h.sub.terminals should have size 1` (lines 298, 336, 395) cannot fail. `PipelineRunRegistry.broadcastLocal` completes every subscriber and calls `refs.remove(pipelineId)` on the first terminal event, so a second publish never reaches the test's subscriber. No case makes a terminal write fail, so the publish-on-failure half of `publishTerminalAfter` (`transformWith` rather than `flatMap`) is not exercised at all. The mutation probe in Phase 2 demonstrates both gaps.
- Constraints C1–C6: honoured. The red log is lock-based. The 120 s waits are unchanged. No hook bypass. Runs were worker-capped and niced.

#### Scrutiny (a): red log authenticity — CONFIRMED
- All five failures in `red-prefix-run.log` are at `PipelineRunServiceTerminalOrderingSpec.scala:178`, inside `assertNoTerminalWhileBlocked`, with the message "terminal event received while write blocked (...)". None is a timeout or setup error.
- In every case, `awaitBlockedBy` (the `pg_blocking_pids` non-vacuity check, which fails at line 149) runs before line 178: lines 285 then 286, and 315/316 then 317. A failure reported at line 178 therefore means the non-vacuity check passed first.
- I could not tell from the log alone that the red run used unmodified code, so I reproduced it independently. In a throwaway detached worktree I ran the new spec with only `PipelineRunService.scala` checked out from base `54c2f222e`. The result was the same 5/5 FAILED at the same ordering assertion (`eval-red-repro.log`, lines 272–333).
- Caveat: the succeeded case fails at stage 1, so its stage-2 assertion (row lock released, table lock still held) was never itself observed red. That is inherent to the pre-fix ordering and acceptable. Stage 2 is a guard against a partial fix, and its logic is sound.

#### Scrutiny (b): "exactly one terminal event" — NOT MET by the test; test-level proof IS feasible
- My own reading of the code agrees with the executor's: no current path publishes twice. `executeRun`'s `runFuture.transformWith` routes engine failure to `executeRunFailure`. A later failure inside `executeRunSuccess` returns a failed Future and is not re-routed. Each path calls `publishTerminalAfter` exactly once.
- D2, however, explicitly requires that tests assert this, and the current assertion is structurally unfailable. A test-level proof is feasible without any production seam:
  - Option 1: build the registry with a real `PipelineRunNotifyBus` against the embedded Postgres (precedent: `PipelineRunCrossInstanceSpec`). Then count terminal events per `runId` from a second bus instance's `onReceive`, or from a raw `LISTEN pipeline_run_events` on a dedicated connection. That path has no subscriber removal.
  - Option 2, weaker: re-subscribe immediately after the first terminal event and assert that no further terminal event arrives within a bounded window.

#### Scrutiny (c): 11 `uniqueEmail` replacements — CONFIRMED shape-preserving
Every original was `` `${prefix}-${label}-${Date.now()}-${rand}@example.com` ``. The executor's "example.com throughout" claim is accurate, not an over-generalisation. The prefixes are hel287 (auth-cookie-migration), hel665, hel666, hel716, hel908 (×5 files), and hel912. hel958's original was label-less: `hel958-join-<ts>-<rand>@example.com`. It now calls `uniqueEmail("hel958-join", undefined, "example.com")`, and the shared helper omits the label segment when `label === undefined`, so it produces exactly the original string. Every label literal (register/login/getdash/csrf/logout/pat/sse, composer, entrypoints/proposal, tallviewport, full-flow, split, tail-attach/cr9-trunk-append/cr10-duplicate/cr11-remove, trunk-drag, trunk-reorder, lanes-rejoin) is carried over verbatim. A grep shows no `uniqueEmail`/`registerThenLogin` definitions outside `e2e/support/`.

#### Scrutiny (d): hel1277/1350/1351 — CONFIRMED behaviour-preserving
- Email: the original was `` hel1277-${label}@example.test `` with label `table-${theme}`/`chart-${theme}`. It is now `` prefix: `hel1277-table-${theme}` `` with no label and the default domain `example.test`, which gives an identical string. hel1350 and hel1351 follow the same pattern with `` `hel135x-${theme}` ``.
- Display name stays "HEL-1277"/"HEL-1350"/"HEL-1351". Because no label is passed, `registerUser` appends nothing.
- Logging: `logEmail: false` matches the originals, which logged no throwaway-email line. The `[HEL-NNNN e2e] created user …` lines are kept verbatim at the call site, and I observed them in `eval-touched.log`.
- Tier order (hel1277): register, then `currentUserId` (`/api/auth/me`, asserts 200), then `setUserTierForTest(userId, "beta")`, then `loginThenIsolate`. This is unchanged, and the tier step stays at the call site as D5 requires.
- Isolate: `loginThenIsolate(page, credentials)` is unchanged. Password and CSRF header values are identical (`TEST_PASSWORD`, `X-Helio-Requested-With: 1`).

### Phase 2: Code Review — FAIL

Gates, run fresh by me:
- `sbt testFull`: 6090/0 failed.
- `npm run lint`: exit 0.
- `npm run format:check`: clean.
- `tsc -p e2e/tsconfig.json --noEmit`: exit 0.
- `npm run check:scala-quality`: clean. Soft warnings only, all pre-existing in kind.

`npm test` and the frontend build are not triggered, because no `frontend/**` files changed.

Issues:
1. **Tests not meaningful for D2. Mutation probe: red-before-guard violated.** I changed `publishTerminalAfter` in a throwaway worktree to
   ```scala
   writes.flatMap { v => publish(pipelineId, event); publish(pipelineId, event); Future.successful(v) }
   ```
   This mutant publishes every terminal event twice and never publishes when the terminal write fails. It passed the new spec 5/5 (`eval-mutation-probe.log`) and the whole `*PipelineRun* *RunStream* *Sse*` family, 258/258 across 17 suites (`eval-mutation-probe-family.log`). The two properties D2 and the spec delta promise ("Exactly one terminal event SHALL still be published per run when a terminal write fails") have no guard that can fail.
2. Everything else reviewed clean:
   - `publishTerminalAfter` is a small, well-named single helper (DRY across the five sites).
   - Event content is unchanged, and so are queued/running/node-progress timing.
   - The design's accepted fail-fast edge is documented in a code comment and in files-modified.md.
   - The e2e helper consolidation is minimal. The unused `Page` imports are dropped, and `currentUserId` is a typed four-line helper.

### Phase 3: UI Review — N/A
No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` path changed; the spec delta lives under `openspec/changes/`. I still ran the hel1094 repeat and the touched e2e specs against fresh servers as AC evidence (see above).

### Overall: FAIL

### Change Requests
1. **Make the single-terminal-event assertion failable (D2).** In `backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceTerminalOrderingSpec.scala`, count terminal events per `runId` at the publish level instead of through the registry subscriber, which is removed after the first terminal event. Preferred approach:
   - Construct `new PipelineRunRegistry(bus)` with a real `PipelineRunNotifyBus` on the embedded Postgres (see `PipelineRunCrossInstanceSpec` for construction).
   - Count events received for the run id by a second bus instance via `onReceive`, or by a dedicated `LISTEN pipeline_run_events` JDBC connection.
   - After the first terminal event, wait for a bounded window, then assert that the count is exactly 1.

   Replace or augment the current `h.sub.terminals should have size 1` at lines 298, 336 and 395.
2. **Cover "published even when a terminal write fails" (D2 / spec delta).** Add at least one case in which the path's terminal write chain fails, and assert that exactly one terminal event of the path's status still arrives. Suggested approach, no production seam needed:
   - In the execution-exception `failed` case, install a test-only `BEFORE UPDATE` trigger on `pipeline_runs` that raises for that run id, so that `updateRunTerminal` fails.
   - Assert that a `failed` event arrives, that exactly one was published (using the CR1 counter), and that the submit Future completes.
3. **Prove the new guards are red-able.** Re-run the spec against the mutant in Phase 2, issue 1: `flatMap` plus a double `publish` inside `publishTerminalAfter`. Show that the CR1 and CR2 cases go red, then revert. Save that log next to `red-prefix-run.log`, and persist it, because `*.log` files under the change directory are gitignored.

### Non-blocking Suggestions
- `onUnblockedRunSuccess` previously published `succeeded` as its first statement. Now, any *synchronous* throw while building the chain, before `publishTerminalAfter` is reached, would leave subscribers with no terminal event. Examples are `truncatedReadsToJson`, or a repository method throwing before returning its Future. Before the change, the event had already gone out in that situation. The risk is low because all the repository calls are Future-returning Slick calls. A belt-and-braces option is to build the chain inside `Future.delegate { ... }` (or `Future.unit.flatMap(_ => ...)`), so that a synchronous throw becomes a failed Future and still triggers the publish.
- `PipelineRunService.scala` grew from 1723 to 1749 lines, against a soft budget of about 250 lines, or about 400 before proposing a split. Following CONTRIBUTING.md, propose a split in the PR description.
- The evidence logs under the change directory are gitignored. Persist any log that a later gate needs (the orchestrator/evaluator did that this cycle for red/green/hel1094).
