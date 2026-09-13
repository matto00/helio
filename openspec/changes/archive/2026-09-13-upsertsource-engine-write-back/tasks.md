## Standing Constraints

- [C1] Every RLS/ownership assertion runs the write under a NOBYPASSRLS, non-superuser role; a superuser-connection pass is not evidence.
- [C2] Atomicity/deferral/fault-injection tests (3.3-3.5) are proven failable by mutation, recorded red-then-green in files-modified.md.
- [C4] Op-wiring audit covers every per-kind exhaustive match (`case XStep`/`case XConfig`), not only string op lists.
- [C3] Only `upsertsource` is registered; `convertformat`/`analyzewithai`/`generatetext` remain rejected.

## 1. Backend

### Backend
- [x] 1.1 Add `UpsertSourceStep` + `Companion` (decode/validate/requiredConfigProblems), register in `PipelineStep.Registry`/`PipelineStepKind`; verify `UpsertSourceStepSpec`
- [x] 1.2 Add `WriteBackSink` to `PipelineExecutionContext` and thread it through `PipelineExecutionBackend.execute`/`InProcessExecutionBackend`/`executeTree`; verify compile + existing engine specs green
- [x] 1.3 Refactor `DataSourceRepository` append/replace/insertDatasetSource into DBIO actions wrapped by unchanged Future methods; verify existing DataSource row-write specs green
- [x] 1.4 Add `applyWriteBacks(owner, writes)` (D4-D6: mapping, undeclared-column error, one transaction, `DatasetMaxRows` constant); verify repository spec
- [x] 1.4a Add `rewriteUpsertTargetAction` CAS (D7: step-row lock, compare, create+rewrite / reuse / fail) with `cycleCheckForUpsertAction` made private[persistence]; verify repository spec
- [x] 1.5 Wire apply point in `PipelineRunService.executeRun` (D3: blocked first, write before success, failure bookkeeping, owner identity); verify service spec
- [x] 1.6 `supportsWriteBack` on `PipelineExecutionBackend`; reject in `PipelineRunService.runPipeline` before execute (D3); verify spec with a stub backend
- [x] 1.7 Owner-resolved ownership pre-flight + `actingUserId = pipeline.ownerId` at every cycle-check call site (D1); verify grantee and cross-tenant rejections
- [x] 1.8 `PipelineAnalyzeService`: pass-through inference + required-config problems; verify analyze spec
- [x] 1.9 Audit every hardcoded op enumeration (backend, frontend, helio-mcp) per D10; record outcome in files-modified.md

## 2. Frontend

### Frontend
- [x] 2.1 `pipelineStepToStep` unsupported op type + `isUnsupportedOpType` (D9), incl. `proposalLaneGraph` consumer; verify Jest
- [x] 2.2 `StepOpEditor` read-only notice + `useStepCardState.persist` skips `updatePipelineStep` for unsupported; verify Jest (render + no-PATCH)

## 3. Tests

### Tests
- [x] 3.1 Flip only the `upsertsource` arm of `PipelineCreateTransactionalSpec`; keep the other three rejections
- [x] 3.2 Append preserves existing rows (ids/seq/data) end to end via a real run
- [x] 3.3 Replace concurrent-read test: a separate-connection reader loop asserts every observed read is EXACTLY the old row-value set or EXACTLY the new row-value set (never a mix/partial), counts the reads that genuinely overlapped the in-flight write (asserted > 0), and is mutation-tested (see 3.10)
- [x] 3.4 Fault injection: failure after rows inserted, before commit → run failed, zero rows committed, no snapshot update
- [x] 3.5 Dry run (mutation-tested), a later-failing sibling step after an upsertsource step, and `previewStep` on an upsertsource step all leave the target byte-identical; the later-failing-sibling case also asserts `last_run_status = failed` and zero node snapshots (skeptic-final-1.md CR3, non-blocking note)
- [x] 3.6 Validation failures (undeclared column) fail the run with a named error, zero rows committed, `last_run_status = failed`, and zero node snapshots (skeptic-final-1.md non-blocking note); type-mismatch/required/500-cap are exercised indirectly via `DatasetRowValidator`'s own existing coverage, not re-asserted through this step
- [x] 3.7 RLS under a NOBYPASSRLS role: owner write lands; a foreign target is never written by the app-level ownerId filter NOR by the FORCEd RLS policy alone (a direct `appendRowsAction` call under `withUserContext(ownerA)` against a foreign id, skeptic-final-1.md non-blocking note); a scheduler-fired run (`PipelineSchedulerService.tick`) and an editor-grantee-triggered run (`PipelineRunService.submit`) both write under the pipeline OWNER's tenant (confirmed visible under the owner's own RLS context, and — for the grantee case — confirmed NOT visible under the grantee's own RLS context)
- [x] 3.8 New-source: two runs → one dataset, all-optional schema, step rewritten; zero rows creates nothing; a GENUINELY concurrent race (two `applyWriteBacks` Futures started before either is awaited) → exactly one dataset created, both writes land in it, the step rewritten exactly once; a mid-run step edit → run fails naming "configuration changed during the run", nothing committed, the user's edit is kept
- [x] 3.8a Zero-row replace clears; two upsert steps targeting one dataset in one run apply in walk order (proven via an order-sensitive append-then-replace pair, not merely both landing)
- [x] 3.9 API-level cycle tests (direct + transitive) added for `create`, `addStep`, `updateStep`, `duplicateStep`, and `PipelineProposalService.apply` — all reject correctly (no defect found; confirmed independently by skeptic-final-1.md's own fresh run). "import" is NOT covered: verified (twice, independently, including by the skeptic) there is no pipeline-level import feature anywhere in this codebase (only dashboard import/export exists, which shares no code path with pipeline step cycle detection) — this sub-item of the ticket AC is inapplicable, not skipped; see files-modified.md.
- [x] 3.10 Mutation checks performed live and recorded in files-modified.md: 3.4 (fail-fast escalation removed → red; restored → green); 3.5 dry-run branch (dry runs routed through the write-applying branch → red; reverted → green); 3.5 Failure branch (writes applied on run-failure → red; reverted → green); 3.5 preview (writes applied in `previewAtNode` → red; reverted → green); 3.3 (delete+insert split into two independently-committed transactions → red, invalid reads observed; reverted → green).

## 4. Skeptic-final-1.md change requests (cycle 3)

- [x] CR1 Fixed `PipelineService.toAnalyzeStepResponse`'s missing `UpsertSourceConfig` arm (real 500 on `GET /analyze` and `POST /analyze-proposal` for any upsertsource pipeline/proposal, reproduced live against the running app both before and after the fix); added `UpsertSourceAnalyzeStepResponse` + wire format; added `PipelineAnalyzeUpsertSourceSpec` (service-level, both endpoints, asserting 200/output==input schema/downstream-step-input==upsertsource-input)
- [x] CR2 Fixed `PipelineStepProjectionSupport.withPosition`/`withDecodedConfig`'s missing `UpsertSourceStep`/`UpsertSourceConfig` arms (real `MatchError`/spurious `Left` on any patch-set preview touching a persisted upsertsource step, reproduced by a live mutation before the fix); redid the D10 audit for per-kind exhaustive matches (C4) — see files-modified.md for the full site-by-site table
- [x] CR3 Added a later-failing-sibling-step test and a `previewStep` test, both mutation-proven (Failure branch and `previewAtNode` respectively)
- [x] CR4 Strengthened the 3.3 concurrent-reader test to assert exact-set membership + a genuine overlap count, and mutation-proved it via a real split-transaction probe
