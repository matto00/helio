## Standing Constraints

- [C1] Never read, cat, grep, source or print any .env file; never run env-dumping commands (env, printenv, set, export -p, /proc/*/environ). scripts/concertino/.concertino.env may be read by scripts but never printed.
- [C2] Quoted heredocs only (<<'EOF') or Write/Edit; no backticks or $(...) inside echo strings.
- [C3] No pkill/pgrep/killall; kill only by exact PID; stop servers with stop-servers.sh; delete DB residue only by exact id via the guarded buildUserDeleteSql.
- [C4] jest maxWorkers 3, Playwright workers 2, sbt -J-Xmx3g, nice -n 19.
- [C5] timeout: 600000 on long calls; use sbt testFull (sbt can print TESTS FAILED and exit 0 -- check output).
- [C6] Budget exhausted -> escalate.
- [C12] Every test and guard fails first, with recorded mutations; multi-instance safety argued from the DB, not in-process state.
- [C13] Scratch goes in .concertino/scratch/HEL-1739/ only.
- [C15] Any new DB object the privileged pool uses gets an explicit GRANT to helio_privileged, proven by a NOSUPERUSER migration-chain test.
- [C14] Dev-DB residue cleaned up by exact id. Migrations only against a lane-private DB helio_hel1739, never the shared dev DB.

### Backend

## 1. Backend: schema and repository

- [x] 1.1 Add V144 migration: sequence `pipeline_auto_run_debounce_write_seq` + `write_generation BIGINT NOT NULL DEFAULT nextval(...)` + explicit `GRANT USAGE, SELECT ON SEQUENCE ... TO helio_privileged` (D1)
- [x] 1.2 `upsertDebounce` sets `write_generation = EXCLUDED.write_generation` on conflict-update (fresh value on insert and conflict); other statements unchanged
- [x] 1.3 Add `pendingWriteGeneration(pipelineId): Future[Option[Long]]` (withSystemContext)
- [x] 1.4 Add `cancelIfGeneration(pipelineId, generation): Future[Int]` compare-and-delete ignoring `claimed_at` (D3)

## 2. Backend: run path

- [x] 2.1 `PipelineRunExecutor.executeRun`: snapshot immediately before the admission call (real runs only); failure -> WARN + None; discarded on refusal (D2)
- [x] 2.2 Thread the snapshot to `onUnblockedRunSuccess`; cancel sequenced in `writesChain()`'s chain + recovery siblings, inside the succeeded terminal-win, before `succeeded` is published; WARN-and-continue (D3)
- [x] 2.3 Wire the debounce repo into the executor/succeeded-writes construction (nullable like other optional collaborators); no change to `submit` or the admission transaction

### Frontend

## 3. e2e workaround

- [x] 3.1 Remove the three `cancelPendingAutoRun` calls in `e2e/hel1277-output-history-scrubber.spec.ts` and the helper in `e2e/support/historySeed.ts` (D6)

- [x] 3.2 Refresh the stale comment at `e2e/hel1392-remount-staleness.spec.ts`:207 (auto-run queued by the out-of-band write) if the behaviour changed it
- [x] 3.3 CLAUDE.md `PIPELINE_RUN_AUTO_RUN_MAX_RETRIES` row: add "unless that run succeeds having read its writes (HEL-1739)"

### Tests

## 4. Tests (red first, mutations recorded)

- [x] 4.1 Cancel test: successful real run removes the row armed before it (red on base)
- [x] 4.2 Write-during-run test (test PipelineExecutionBackend calls upsertDebounce in execute): write after snapshot survives the run's success and fires (red via generation-ignoring mutation)
- [x] 4.3 Failure-path test: failed run leaves the row; it fires (red via cancel-on-any-terminal mutation)
- [x] 4.4 Grant test: has_sequence_privilege via ProductTelemetryDbHarness (red by removing the GRANT)
- [x] 4.5 Dry run and refused admission cancel nothing; ABA not cancelled; upsert changes generation on both paths; unclaim/rearm leave the column value unchanged
- [x] 4.6 In-flight carve-out test: write before run, firer tick during run (test-backend seam) -> unclaimed then cancelled, no second run
- [x] 4.7 Run existing HEL-1093/HEL-1504/HEL-505 suites and full `sbt testFull` (passed, executor and evaluator runs). The hel1277 e2e spec was NOT run locally: V144 must not reach the shared dev DB and a lane-private DATABASE_URL override could not be confirmed; CI's e2e job is its measurement, and the removed helper's guarantee is covered by `RunCancelsPendingAutoRunSpec`'s cancel test.
- [x] 4.8 Update spec delta if implementation forces any wording change; record mutations in `.concertino/scratch/HEL-1739/`
