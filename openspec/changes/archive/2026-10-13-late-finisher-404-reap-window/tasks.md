## Standing Constraints

- [C1] The in-transaction run guard must not trip on the run's own succeeded terminal write; every guard test needs a healthy multi-node positive control.

## 1. Run state and response mapping (item 1)

- [x] 1.1 Write the red test: admitted real run, pipeline deleted before the success chain, expect `Left(NotFound("Pipeline not found: <id>"))`; confirm it fails on the unmodified code (Conflict) and record the red output
- [x] 1.2 Add the tri-state run-state read (`Open | Terminal | Missing`) to `PipelineRunRepository` and map it in `PipelineRunExecutor.onRunSuccess` per design D1/D2; verify 1.1 goes green and the existing reaped -> 409 test still passes

## 2. In-transaction guard (item 2)

- [x] 2.1 Write the red concurrency test (design D6(a)): reap after the early check, before a node write; assert no snapshot/history rows, no `succeeded` event, 409; confirm red on unmodified code
- [x] 2.2 Add the guard DBIO (pipeline row `FOR KEY SHARE`, then run row `FOR SHARE`, writable = `completed_at IS NULL OR status = 'succeeded'` per design D3) as the first action of every node snapshot transaction (`overwriteRows` and `overwriteRowsWith` paths); verify 2.1 green
- [x] 2.3 Handle a guard trip per design D4 (stop the fold, no `succeeded` publish, same 404/409 mapping as 1.2); verify with 2.1 and a pipeline-deleted-mid-chain variant answering 404
- [x] 2.4 Add D6(b) (reap blocks on an open node transaction, then reaps) and D6(c) (guarded write vs `PipelineRepository.delete`, both orders, no 40P01); record mutation evidence that each is failable (FOR KEY SHARE on the run row; pipeline-row lock removed)

- [x] 2.5 Add the positive-control test (design D6, CR2): healthy run, >= 2 materialized nodes, history on, one payload opt-in, own `succeeded` terminal write forced before the first node write; assert all writes, `succeeded` published, `Right`, run `succeeded`; record mutation evidence that it goes red with a guard keyed on `completed_at IS NULL` alone
- [x] 2.6 Grep every writer of `status = 'succeeded'` / `writeTerminal(..., "succeeded", ...)` for real runs and record in the evidence that only the executing run's own success chain writes it (design D3 premise)

## 3. Privileged comments (item 3)

- [x] 3.1 Add the inline RLS-bypass justification comments per design D5 at the `reapStaleRunsInternal`, run-state read, Missing-case `findByIdInternal` and guard call sites; verify with `grep -n -B2` on each call site

## 4. Follow-up

- [x] 4.1 File a Linear follow-up (Follow-up label, relatedTo HEL-1518) for the residual window on alert evaluation, binary refs, schema-drift baseline and Output schema writes (design Non-Goals); record its id in the PR body (filed: HEL-1541)

## 5. Verification

- [x] 5.1 `sbt testFull` (HELIO_TEST_JVM_XMX=3g, nice -n 19) and the Scala code-quality check pass; record results
- [x] 5.2 `files-modified.md` lists every modified file by full path
