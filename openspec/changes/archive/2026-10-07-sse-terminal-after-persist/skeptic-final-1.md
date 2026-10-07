## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `ea2d2beb0ec2fcc030cfa0e003b1e9bfcc8200a9`. I resolved the diff base live with `resolve-review-base.sh` (exit 0): `54c2f222e09adcaa49fcf0b86bf643a3fc3f3426`. The spawn-cwd guard printed `READY ambient=/home/matt/Development/helio branch=bug/sse-succeeded-before-persist/HEL-1366`.

### What I verified (with evidence)

**Root cause, checked against the CI trace.** I unpacked `.concertino/runs/HEL-1366/ci-evidence/trace.zip` and read `1-trace.network` myself.
- Second run `e92aa937`: the client's `run-events` stream started at 18:47:54.337 and lasted 29 924 ms, so it closed at about 18:48:24.261.
- `GET runs/latest` started at 18:48:24.284 and returned `{"status":"queued"}`. `GET rows` at .366 returned `total: 2`.
- The reconnect at 18:49:26.561 got `succeeded`, rowCount 3, `completedAt` 18:48:24.281.
- The first run won the same race narrowly: `completedAt` 54.212, read at 54.220 returned succeeded, then 2 rows.
- The client dedup is real: `pipelineRunFanout.ts:175` returns early when `data.id === entry.lastObservedRunId`, and `:288` sets that id on a live terminal event.
- The pre-fix code publishes before writing: the base `onUnblockedRunSuccess` and the other four terminal paths call `publish(...)` first and then start the write chain.

The root cause is established from evidence, not inferred.

**Fix, read in full (`PipelineRunService.scala`).**
- The new `publishTerminalAfter` (L986-996) runs `Future.unit.flatMap(_ => writes).transformWith { publish; fromTry }`.
- All five terminal sites now use it, and no direct terminal `publish` remains. Grep shows only `queued` (L1030), `running` (L1076) and `node-progress` (L1088) still publish directly:
  - `executeRunFailure` L1155
  - `onDryRunSuccess` L1264
  - `onWriteBackFailure` L1356
  - `onBlockedRun` L1392
  - `onUnblockedRunSuccess` L1623
- The succeeded event waits on the whole `for` chain: `materializedWrites` → binaryRefs → alertEvaluation → `updateLastRun` → `updateRunTerminal` → assertions → baseline.
- I checked `AlertEvaluationService` for network calls. Its imports are only persistence, JSON and slf4j. It is DB-only, so the D1 escape hatch was rightly not used.

**D2 (no double publish).** `runFuture.transformWith` sends only an engine `Failure` to `executeRunFailure`. A failure inside `executeRunSuccess` is not re-routed there, so no path publishes twice. This agrees with files-modified.md.

**Red-first proof, re-run by me in a throwaway detached worktree at HEAD (removed by exact path afterwards).**
- At HEAD: 7/7 pass (`ref=/home/matt/Development/helio/.concertino/runs/HEL-1366/evidence/openspec/changes/sse-terminal-after-persist/skeptic-final-green.log`).
- With `PipelineRunService.scala` restored to the base: 5 failed, 2 passed (`ref=.../skeptic-final-red.log`).
  - All 5 ordering cases fail with the ordering assertion, "terminal event received while write blocked (...)": succeeded, failed by exception, failed by assertion block, failed by write-back, and dry_run. None fails on a timeout or a setup error.
  - The two failing-write cases pass on the base, as expected. They guard "always publishes exactly once", not ordering.
- My own partial-fix mutant: the succeeded `for` no longer awaits `materializedWrites` (`_ <- Future.successful(materializedWrites)`). The staged-release case fails at stage 2, "node_snapshots still locked after the run-status lock was released", and the other 6 pass (`ref=.../skeptic-final-mutant-partial.log`). The staged release catches exactly the partial fix design D4 names.
- Each lock is checked for non-vacuity by polling `pg_blocking_pids` for a service backend held up by that lock's holder pid (`awaitBlockedBy`).
- Lock release is idempotent and also happens in `afterEach`.

**Full suite.** I relied on the evaluator's pasted output: `eval3-testFull.log` shows `Tests: succeeded 6092, failed 0, canceled 4`. It was run 15:34-15:43, after the HEAD commit at 15:25. The production code has been unchanged since d5ec9a829 (`git diff --stat d5ec9a829 ea2d2beb0` touches only the spec and docs).

**hel1094.**
- `git diff base...HEAD -- e2e/hel1094-sse-fan-out-panel-refresh.spec.ts` is empty. Lines 168 and 199 still use `timeout: 120_000`.
- `assert-phase.sh servers` printed PASS. The backend java process on 9705 has its cwd in this worktree, and the tree is clean at HEAD.
- I ran `--repeat-each=6 --workers=3` under `nice -n 19` with `DEV_PORT=6798`: 6 passed (`ref=.../skeptic-final-hel1094.log`). This is regression evidence only. The backend spec is the proof.

**e2e helper consolidation.** I read every hunk.
- **registerThenLogin removal (hel1277, hel1350, hel1351):**
  - Email shape is unchanged: `prefix-<label>-<ts>-<rand>@example.test`, with `prefix` carrying the old label.
  - Password (`TEST_PASSWORD`) and the CSRF header are the same.
  - Display names `HEL-1277`, `HEL-1350` and `HEL-1351` are unchanged. `logEmail: false` keeps the original log lines exact.
  - hel1277 still sets the tier between register and login, at the call site. `loginThenIsolate` is unchanged.
- **uniqueEmail call sites:** all 11 map to `uniqueEmail(prefix, label, "example.com")`. hel958 maps to `uniqueEmail("hel958-join", undefined, "example.com")`, which gives the identical no-label shape.
- A grep for local `uniqueEmail`/`registerThenLogin` definitions outside `e2e/support/` finds nothing.
- `tsc -p e2e/tsconfig.json`: 0 errors. Prettier `--check` and `eslint --max-warnings=0` on all touched e2e files are clean.
- I ran the touched specs at 3 workers: 20 passed (`ref=.../skeptic-final-touched.log`). The 5 quarantined specs (hel665, hel666, hel716, hel908-tail-attach, hel912) are excluded by `testIgnore` and were covered by tsc, lint and prettier only.

**Spec delta.** I diffed `specs/pipeline-run-sse/spec.md` against the baseline requirement. The change is purely additive: the ordering and exactly-once sentences plus two new scenarios. Nothing in the baseline was dropped.

**AC trace.**
1. Root cause established and fixed at the cause, with the 120 s waits not lengthened: verified above.
2. Failing-first backend test covering every terminal path: red on the base for all 5, green at HEAD, and the partial-fix mutant is caught.
3. hel1094 repeat runs: 6/6 (mine) and 4/4 (evaluator).
4. Three `registerThenLogin` copies removed with behaviour preserved: verified hunk by hunk.
5. Eleven `uniqueEmail` copies replaced, none left: grep is clean.

**UI.** There are no `frontend/**` changes, so the DESIGN.md visual review does not apply.

**Housekeeping.** My touched-spec run created the gitignored top-level `e2e-evidence/` (HEL-1277/1350/1351 screenshots). I moved that exact directory to my scratchpad (`.../scratchpad/e2e-evidence-moved`). No evidence here rests on mtime ordering.

### Verdict: CONFIRM

### Non-blocking notes
- `PipelineRunService.scala` is about 1751 lines, well over the file-size budget. files-modified.md proposes a follow-up split, and I agree it should be filed as a separate behaviour-preserving ticket.
- There is a pre-existing gap that this change neither introduced nor widened: if `applyWriteBacks` returns a failed Future (rather than `Left`), no terminal event is published. That was equally true before this change.
- The accepted edge stands: on a `materializedWrites` failure, `succeeded` can fire while `updateRun` is still in flight. It is documented in files-modified.md and is limited to the write-failure path.
