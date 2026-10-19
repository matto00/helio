## Standing Constraints

- [C1] Owner rulings 2-8 (ticket.md) are binding: 100,000 rows/node; live-cell budget = 25% of 768 MB, priced by text, with frame release; 1,048,576 chars/text; fail as a step error, no snapshot; NonFatal + ExitOnOutOfMemoryError. Never change a number without an owner escalation.
- [C2] Iron Laws: every bound has a red measurement first (heap or row count, recorded in evidence) and a mutation that turns its spec red.
- [C3] Heap probes in a forked JVM with -Xmx768m, one at a time; `sbt testFull` only under `flock -w 3600 /tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/sbtfull.lock`; load gate (1-min load > 10: sleep 60 s and recheck, up to 30 min) before heavy runs.
- [C4] jest/Playwright at most 2 workers under `nice -n 19`; full e2e only under the `e2e.lock` of the same scratchpad.
- [C5] Never kill/pkill/pgrep/killall; stop servers with `scripts/concertino/stop-servers.sh`. Scratch in `/home/matt/Development/helio/.concertino/scratch/HEL-1660/`, not /tmp.
- [C6] The draft preview's behaviour, walk order and message strings stay byte-identical.

### Backend

## 1. Red-first probe (before any fix)

- [x] 1.1 Add the run-path heap/row probe spec (D6 shapes via `InProcessExecutionBackend.execute`, -Xmx768m); run on unchanged code and record per-kind red (OOM or rows past 100,000) in evidence
- [x] 1.2 Add an OutOfMemoryError-step spec (single-step walk) and a StackOverflowError regex probe on the run path; record both red/current behaviour

## 2. Mechanism

- [x] 2.1 Add `limitLabel` to `PipelineExecutionContext` (default draft) and the label parameter to RowBudget/StringBudget/MemoryLimitMessage; verify HEL-1630 exact-message specs still pass
- [x] 2.2 Thread `ctx.limitLabel` through every step and `ExpressionInterpreter.checkLength` (:271); verify by grep that no "draft preview" literal remains outside the draft label
- [x] 2.3 Make leaf-first an explicit `executeTree` parameter set by `DraftPreviewService`; switch `InProcessPipelineEngineDraftSeamSpec:103-108` and `DraftPreviewHeapSpec:83-92` to it (coupling change, not a fixture fudge); verify parity + draft specs
- [x] 2.4 Add run-only `runRetention` (trunk terminal kept, root and upsertsource frames never tally-released); verify with an engine spec + mutation per effect, and draft specs unchanged
- [x] 2.5 Add `RunLimits` and apply it in `InProcessExecutionBackend.execute` with a REQUIRED `retain` parameter (trait + SparkJobSubmitter too); verify compile
- [x] 2.6 Inject `outputRepo` into `PipelineRunExecutor`, pass Output keys (StepKey/RootKey) and preview/backfill targets; warn (not error) only for Outputs absent from `retain`; mutation: empty `retain` turns the snapshot spec red
- [x] 2.7 D7: SOE arm + `NonFatal` in the sync `try` (:297), boxed-fatal guard in `recoverWith`, `-XX:+ExitOnOutOfMemoryError` in `Dockerfile`; verify the 4 D7 cases (thrown/returned x OOM/SOE) green and their 4 mutations red

### Tests

## 3. Proof

- [x] 3.1 Per-kind run-limit specs (join, unpivot up front; splittext, chunkbytokencount, extractheadings while emitting; union backstop; text cap; memory budget) with exact run wording; each mutated red once (evidence)
- [x] 3.2 Run-level spec: a limit breach yields a `failed` run, `error_log` naming step + limit, no node snapshot; saved preview returns the step error
- [x] 3.3 Heap spec green end to end (service path, real snapshot/history repos, just-under-budget text-light + text-heavy, each real + dry; max taken): all <= 192 MB; set `MaxLiveCells`, record in design.md
- [x] 3.4 AC6 service-level spec: 50,000 x 6 CSV, 10-step chain, both Outputs' snapshots written under the run budget (escalate if not)
- [x] 3.5 Full gates: `sbt testFull` under lock, frontend lint/typecheck/test (no frontend change expected), pre-commit hooks

## Executor notes (design gate round 4 CONFIRM)

- SOE keeps today's wording: `StepExecutionException.from` gives "step execution failed"; specs assert the cause is the SOE plus step id/kind (no allowlist change).
- Terminal fallback is `InProcessPipelineEngine.scala:607`; add a terminal-retention assertion for a lowest root with no trunk steps.
- D7 specs inject fatals through a named seam: one stub step that throws, one that returns `Future.failed`.
- Preview and backfill each call `execute` twice (root-only, then sliced steps); each call gets its own `retain` (root key, then target step key).
