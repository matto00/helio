## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Cold re-read of `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, then each round-1 CR
checked against the actual sources.

- **CR1 (Decision 3 default-arg compile error) — RESOLVED.** Decision 3 now specifies
  `executionBackend: PipelineExecutionBackend = null` plus an in-body
  `private val backend = if (executionBackend != null) executionBackend else new InProcessExecutionBackend(engine)`.
  This matches the file's own established convention — `PipelineRunService.scala:41-62` uses
  `= null` defaults for `binaryRefRepo`, `alertEvaluationService`, `connector`, `auditService`,
  `system`. `engine` stays a live field (`:79`). Compiles; no static-default scoping problem.
- **CR2 (wrong file / Main.scala) — RESOLVED.** Task 2.4 is gone; tasks.md now has 1.1–1.2,
  2.1–2.3, 3.1, 4.1–4.3 only. `proposal.md` Impact now reads "No `Main.scala` change —
  `PipelineRunService` is constructed only at `ApiRoutes.scala:288`", and design.md carries an
  explicit correction note. `grep -rn "new PipelineRunService" backend/src/main/` still yields
  exactly `ApiRoutes.scala:288`, zero in `Main.scala`.
- **CR3 (Decision 2 unimplementable) — RESOLVED.** Decision 2 now bypasses `submit`/
  `PipelineRunCache` entirely and composes `loadDataFrame`/`applyStep`/`collectRows` directly.
  Verified those three exist on the class (`SparkJobSubmitter.scala:107, 155, 218`, all
  `private[spark]`, callable from a method in the same class) and that `sparkEc` (`:30`) exists.
  `submit` (`:45-105`) is untouched, and task 3.1 makes "byte-for-byte unchanged `submit` body"
  an explicit verification step.
- **CR4 (undefined outcome fields for Spark) — RESOLVED.** Decision 2 pins all three:
  `stepCounts = Map.empty`, `sourceRowCount = df.count()` (documented as pre-step), and
  `primaryStats = SourceReadStats(truncated = false, availableRowCount = None)`. Field names
  match `InProcessPipelineEngine.scala:42`
  (`final case class SourceReadStats(truncated: Boolean, availableRowCount: Option[Long])`).
  A Risks/Trade-offs entry records them as deliberate approximations, and task 4.2 asserts
  exactly those documented values rather than invented ones.
- **CR5 (sinks contract) — RESOLVED.** The trait now carries scaladoc stating an implementation
  with no equivalent concept MUST leave `assertionSink`/`truncationSink` untouched and silently
  ignore both, with Decision 2 restating it for the Spark impl.
- **CR6 (task 4.2 NPE) — RESOLVED at the root.** Because Decision 2's `execute` performs no
  `pipelineRepo`/`pipelineRunRepo`/`cache` writes, `pipelineRepo.updateLastRunInternal`
  (`SparkJobSubmitter.scala:80`, the unguarded call) is never reached — the NPE that
  `SparkJobSubmitterSpec.scala:38`'s `new SparkJobSubmitter("local[*]", mockDsRepo, null)`
  fixture would have triggered via `submit` cannot occur on the `execute` path.

Signature/type conformance checks against real code (all clean):
- Trait's `steps: Vector[PipelineStep]` matches `executeRun`'s own param type
  (`PipelineRunService.scala:404 steps: Vector[PipelineStep]`); `previewStep`'s `slicedSteps`
  derives from the same `listByPipelineInternal` result, so no `.toSeq`/`.toVector` coercion is
  smuggled in.
- `pipeline` is genuinely in scope at both call sites (`executeRun` param `:402`; `previewStep`
  binds it from `pipelineRepo.findByIdShared` at `:231-234`).
- `PipelineExecutionOutcome` fields cover everything the current inline chain feeds downstream:
  `(out, counts, sourceRows.size.toLong, primaryStats)` (`:441`) ↔ `rows/stepCounts/
  sourceRowCount/primaryStats`. `previewStep` likewise only needs `sourceRows.size.toLong`
  (`:277`) — no other use of the intermediate `sourceRows` value exists at either site.
- `collectRows` returns `Seq[Map[String, Any]]` (`:218`), identical to the
  `PipelineRowJson.Row` alias the outcome now uses.
- `previewStep` today calls `executeWithStepCounts(..., truncationSink = truncationSink)` and
  relies on the **defaulted** `assertionSink` (`InProcessPipelineEngine.scala:116`); task 2.3
  correctly mandates a fresh `new AssertionSink` there, which is behavior-identical and does not
  share state with the run path's sink.

Refactor discipline / scope: no wire, route, schema, or persisted-behavior change; no spec deltas
(correctly declared "none" — this introduces no external contract); nothing beyond the ticket's
three scope bullets. Both new files are additive, and the revision itself introduced no new scope.

### Verdict: CONFIRM

### Non-blocking notes

- **Field ordering.** The `private val backend = ... new InProcessExecutionBackend(engine)` must
  be declared *after* the `private val engine` val (`PipelineRunService.scala:79`), or it captures
  a null `engine` and NPEs at execute time. Design shows it that way but doesn't say so.
- **`extends PipelineExecutionBackend`.** Decision 2 / task 3.1 say "implementing the trait" but
  never state that `class SparkJobSubmitter` should actually declare `extends
  PipelineExecutionBackend`. It should — a structurally-matching method alone leaves the ticket's
  "the trait cleanly admits a second impl" AC unverified by the compiler.
- **`dataSourceRepo` is a third silently-ignored trait param on the Spark impl.** The trait
  parameter shadows `SparkJobSubmitter`'s constructor field of the same name, but `loadDataFrame`
  reads the *field*. Same class of gap CR5 fixed for the sinks; worth one scaladoc clause.
- **Task 4.2's "non-null `pipelineRepo` per the file's other test fixtures"** is over-specified and
  slightly inaccurate — the file has exactly one fixture and it passes `null` (`:38`). Since
  `execute` never touches `pipelineRepo`, reusing the existing `submitter` fixture is fine and
  cheaper than fabricating a fake repo.
- Decision 2's `df.count()` is an extra Spark action on an unwired path; acceptable, already
  documented as best-effort.
