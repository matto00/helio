## Skeptic Report — final gate (round 1, skeptic-final-2.md)

Dimension: per-node snapshot persistence semantics ONLY.

### What I verified (with evidence)

1. **Materialization gating (only nodes with >= 1 Output are persisted)** — `PipelineRunService.scala:663-690`:
   `outputsByNode = outputs.groupBy(_.node.stepId.map(_.value))`, then
   `materializedNodeKeys = outputsByNode.keySet.intersect(nodeOutcomes.keySet)`; the fold writes
   `overwriteRows` + `updateSchemaInternal` only for keys in that intersection. Gating logic is
   correct by construction. **But there is no test** — see CR2.
2. **Every materialized node in a tail chain gets its own snapshot (evaluation-1.md CR2)** — really fixed:
   `InProcessPipelineEngine.scala:305-320` (`foldChain`) records a `NodeOutcome` for EVERY step in the
   chain, not just the last. Service-level test exists and is real:
   `PipelineRunServiceSpec.scala:1195-1225` ("materializes a MID-tail node, not only the tail's terminal
   node") asserts the mid node's rows carry `score` and NOT `finalScore`, while the terminal node's carry
   `finalScore` — genuinely distinct row sets, not the same snapshot read twice.
   Engine-level twin at `InProcessPipelineEngineTreeWalkSpec.scala:128`.
3. **Two Outputs on one node share one row set** — true by construction (the fold is keyed by node, and
   `overwriteRows` is called once per node key, with `updateSchemaInternal` sequenced per Output inside).
   **No test exists** — see CR1.
4. **Failed run leaves prior snapshots untouched** — true by construction: `materializedWrites` lives
   inside `onUnblockedRunSuccess`, reachable only from `executeRun`'s `case Success(...)`
   (`PipelineRunService.scala:514,531,608,663`); the `Failure` branch (`:484-511`) touches only run
   metadata/assertions. Blocked-run path additionally proven by test
   `PipelineRunServiceSpec.scala:452-479` (prior rows captured, re-asserted `shouldBe priorRows` after a
   blocked run). Task 4.5 (exec-failure regression test) is unchecked and explicitly recorded as a
   deferral in `execution-progress.md:54-57` — honest, and acceptable given the structural argument.
5. **Dry run persists nothing** — `PipelineRunService.scala:529` branches `if (isDry)` to
   `onDryRunSuccess`, which never reaches the per-node writes. Test at
   `PipelineRunServiceSpec.scala:1269-1278` asserts `node_snapshots` empty after a dry run over a
   materialized node. (Only `node_snapshots` is asserted, not `outputs.schema` — non-blocking, same
   branch.)
6. **Per-Output schema derivation + the `Seq[InferredField]` -> `Vector[SchemaField]` conversion** —
   done explicitly and correctly at `PipelineRunService.scala:680-684`:
   `inferredFields.map(f => SchemaField(f.name, DataFieldType.asString(f.dataType))).toVector`.
   `SchemaField` is `(name, type: String)` (`PipelineAnalyzeService.scala:14`) and
   `DataFieldType.asString` (`model.scala:601-609`) emits the canonical wire vocabulary. Derivation runs
   per materialized node over that node's own `nodeJsRows`, not the trunk's. Asserted at
   `PipelineRunServiceSpec.scala:1188-1189,1222-1223` (field names per node; types not asserted —
   non-blocking).
7. **Cross-node non-atomicity honestly documented** — yes, not glossed: `design.md:94-97` states it as an
   explicit non-goal, and the code carries the same statement at `PipelineRunService.scala:656-662`
   ("a mid-sequence failure leaves earlier nodes updated and later ones untouched"). The writes are
   sequenced (`foldLeft` over `Future`), so the described behavior is what actually happens.
   `pipeline-execution/spec.md:47-51` words the atomicity scenario per-node, consistent with the caveat.
8. **CR3 alert-evaluation fix** — landed and tested. `PipelineRunService.scala:733-741`: the
   `getOrElse(resultRows)` fallback is gone; `nodeOutcomes.get(nodeKey)` matches `None` -> `log.error(...)`
   + skip. Test `PipelineRunRoutesSpec.scala:950-992` stubs an Output pointing at a fabricated node key
   and asserts the run still 200s and `findActiveByRule(ruleId) shouldBe None` — the rule (`score gt 0`)
   would have fired under the old trunk-rows fallback, so this test is failable, not vacuous.
9. **Gates re-run myself** (not taken from the evaluator's report):
   `sbt -batch 'set Test/parallelExecution := false' 'testOnly ...PipelineRunServiceSpec ...InProcessPipelineEngineTreeWalkSpec'`
   -> `Tests: succeeded 56, failed 0`.
10. UI gate: N/A — backend-only change (no `frontend/**` view changes in my dimension; the only frontend
    diff is `usePipelineRunEvents`, owned by the wire/SSE skeptic).

### Verdict: REFUTE

Two tasks are checked `[x]` as *done tests* that **do not exist anywhere in the repo**, and they back two
ticket ACs and two spec-delta scenarios in exactly my dimension. Everything else in this dimension is
sound; these are cheap, mechanical additions, not a design problem.

### Change Requests

1. **`tasks.md:61` claims "4.3 Test: two Outputs on one node share one snapshot row set" is done — no such
   test exists.** Grep of every `outputRepo.insertInternal` call site in the backend test tree
   (`PipelineRunServiceSpec.scala:171,1172,1209,1210`; `PipelineRunRoutesSpec.scala:168,964`) shows no case
   with two Outputs attached to the *same* node. This backs `ticket.md:23` ("two Outputs on one node share
   one snapshot row set") and `specs/pipeline-execution/spec.md:33-39`. Add a test in
   `PipelineRunServiceSpec` under the HEL-905 block: attach two Outputs to one node, run non-dry, assert
   (a) `nodeSnapshotRepo.listRows(pid, thatNode)` has exactly the expected row count (one row set, not
   doubled) and (b) both Outputs' `schema` are non-empty and equal.
2. **`tasks.md:62` claims "4.4 Test: only materialized nodes appear in `node_snapshots` after a run" is
   done — no such test exists.** No test anywhere asserts a *non-materialized* node has zero snapshot
   rows after a successful run (the only `node_snapshots ... shouldBe empty` assertion in the suite,
   `PipelineRunServiceSpec.scala:1277`, is the dry-run case). This backs `ticket.md:22` and
   `specs/pipeline-execution/spec.md:41-45`. Add a test: pipeline with a materialized node and at least
   one non-materialized node (e.g. Output on the trunk-last step only, plus an intermediate trunk step and
   the root with no Output), run non-dry, assert the materialized node's rows are non-empty AND
   `listRows(pid, <each non-materialized node key>)` is empty. The gating code
   (`PipelineRunService.scala:667`) is correct, so this should be green first try — it is the guard, and
   its absence is why the AC is currently unverified.
3. **Uncheck or correct the claims.** If 4.3/4.4 are instead intended as deferrals, they must be moved to
   the same honest treatment 4.5/4.6 got (`execution-progress.md:54-57`) with a named owning ticket — a
   `[x]` on a test that was never written is the failure mode this gate exists to catch. Preferred fix is
   writing the two tests (CR1/CR2), which is a few minutes' work.

### Non-blocking notes

- The dry-run test (`PipelineRunServiceSpec.scala:1269`) asserts only `node_snapshots`; task 5.3 also names
  `outputs.schema`. Same code branch, so no real risk — one extra assertion would close it.
- Schema *types* (integer/float/string) are never asserted on a persisted Output — only field names
  (`:1189,1222`). `specs/pipeline-run-execution/spec.md:120-131` has integer/float scenarios;
  `SchemaInferenceEngine` has its own coverage, so this is a wiring-level gap only.
- `materializedNodeKeys`'s `intersect` silently drops an Output whose node has no `NodeOutcome`, whereas
  the alert path (CR3) logs an error for exactly that case. Consider the same `log.error` on the snapshot
  path for symmetry — it is the same "real bug elsewhere" signal.
