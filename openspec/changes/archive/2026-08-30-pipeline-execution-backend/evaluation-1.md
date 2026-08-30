## Evaluation Report — Cycle 1 (evaluation-1.md)

Commit reviewed: `be3fcc67` on `feature/pipeline-execution-backend/HEL-330` (worktree clean, `git status --short` empty — the commit is real and the tree matches it).

### Phase 1: Spec Review — PASS

Issues: none.

- **Trait shape (design.md Decision 1)** — `PipelineExecutionBackend.execute(pipeline, dataSource, steps, dataSourceRepo, assertionSink, truncationSink)(implicit ec): Future[PipelineExecutionOutcome]` matches the design signature exactly, including the `pipeline` parameter added for round-1 skeptic finding #3. `PipelineExecutionOutcome` reuses the `PipelineRowJson.Row` alias as specified, with the exact four fields.
- **`InProcessExecutionBackend` (1.2)** — verbatim wrapper over `loadRowsWithStats` + `executeWithStepCounts`; `sourceRowCount = sourceRows.size.toLong` reproduces the old inline value exactly. `pipeline` accepted and unused, documented in scaladoc.
- **`PipelineRunService` wiring (Decision 3 / 2.1)** — `executionBackend: PipelineExecutionBackend = null` appended **last**, after `isBlocked`, resolved to `private val backend` via the file's own established null-default convention. No call site edited: `ApiRoutes.scala:288` and `Main.scala` are untouched in the diff.
- **`executeRun` (2.2)** — one `backend.execute(...)` call `.map`ped to the identical downstream 4-tuple `(rows, stepCounts, sourceRowCount, primaryStats)`. SSE publish, `preExec`, `transformWith` failure path, persistence all unchanged.
- **`previewStep` (2.3)** — uses a fresh `new AssertionSink`. Confirmed behavior-preserving against ground truth: `InProcessPipelineEngine.executeWithStepCounts` (line 116) defaults `assertionSink = new AssertionSink`, so the explicit fresh sink is the same value the defaulted parameter produced. `truncationFields(...)` now receives `outcome.sourceRowCount`/`outcome.primaryStats`, which are the same values as the old `sourceRows.size.toLong`/`primaryStats`. The `.recover` block still wraps the whole chain (including load failures), since it is attached outside the `Future`.
- **`SparkJobSubmitter` (Decision 2 / 3.1)** — `execute` is strictly additive: the diff contains **no hunk inside `submit`'s body** (only the class-declaration `extends PipelineExecutionBackend` line and the new method). It calls `loadDataFrame`/`applyStep`/`collectRows` directly on `sparkEc`, touches no `cache`/`pipelineRepo`/`pipelineRunRepo`, and returns the three documented approximations (`Map.empty`, pre-step `df.count()`, `SourceReadStats(false, None)`). No new call site: `grep -rn SparkJobSubmitter src/main` shows only the pre-existing `Main.scala:109` construction and `ApiRoutes.scala:84` parameter, both unmodified — `execute` has zero callers, as designed.
- **tasks.md** — all 10 checkboxes checked and each corresponds to real, verified work (4.2 and 4.3 tests both exist and were observed running, see Phase 2).
- **Scope** — diff is confined to 4 main + 2 test Scala files plus the change dir. No drive-by refactors, no wire/schema/route/migration change.
- **files-modified.md** — present and accurate; all six backend files listed match `git diff --name-status` exactly, with correct per-file descriptions.

### Phase 2: Code Review — PASS

Gates re-run independently by me in `WORKTREE_PATH` (not taken from the executor's report):

| Gate | Result |
| --- | --- |
| `sbt -batch compile` | `[success]` |
| `sbt -batch "testOnly com.helio.spark.* com.helio.domain.engine.* com.helio.services.pipelines.*"` | 581 tests, **581 succeeded, 0 failed** (19 suites) |
| `sbt -batch test` (full suite) | 3844 tests, **3844 succeeded, 0 failed** (244 suites), 3m24s |
| `npm run check:scala-quality` | `clean (145 soft warning(s))` — all pre-existing file-size soft warnings; none introduced by this diff's new files |

Both new tests were confirmed present in the full-run output, not merely asserted:
- `SparkJobSubmitterSpec` → `produce a PipelineExecutionOutcome matching the source data and documented approximations`
- `InProcessPipelineEngineSpec` → `InProcessExecutionBackend … produce the same rows/stepCounts/sourceRowCount/primaryStats as the direct engine calls (task 4.3)`

Pre-commit hook chain applicability: the diff is Scala-only, so `lint`/`typecheck`/`format:check`/`check:schemas` have no changed inputs. `node_modules` is absent in this worktree, so those npm gates could not execute here; this is not a defect of the change — no `frontend/**`, `schemas/**`, or `.mjs` file is touched, and the one hook step that *does* cover Scala (`check:scala-quality`) ran clean.

Checklist:
- **CONTRIBUTING imports/qualifiers** — PASS. No inline fully-qualified names anywhere in the diff; all new symbols imported at the top. `PipelineRunService`'s import line correctly extended with `InProcessExecutionBackend`/`PipelineExecutionBackend`; `SparkJobSubmitter` gains a properly grouped `com.helio.domain.engine.{...}` import. `import PipelineRowJson.Row` in the trait file is a same-package explicit import, not an inline FQN.
- **File-size budgets** — both new files are small (37 and 30 lines).
- **Comments standard** — PASS and notably good: every comment carries a *why* (why not a three-method poll API, why `= null` instead of a real default, why the fresh `AssertionSink`, why the Spark values are approximations). Ticket refs all state the decision inline rather than pointing away.
- **DRY / modular / readable** — PASS. The seam is one small trait plus one 20-line adapter; no duplication introduced.
- **Type safety** — PASS. The `= null` default is the file's own pre-existing, explicitly documented convention (`binaryRefRepo`, `connector`, `auditService`, `system`) and is resolved once into a non-null `private val backend`; it is not reachable as a null at any use site.
- **Error handling** — PASS. No error path altered; `.recover`/`.transformWith` semantics preserved (see Phase 1).
- **Tests meaningful** — PASS. 4.3 is a genuine parity guard (asserts rows/counts/stats against a live direct-engine call on the same inputs, with `sourceRowCount shouldBe 2L` pinning it to a non-empty result so an all-empty degeneration cannot pass silently). 4.2 exercises the second impl for real against Spark, asserting both content and each documented approximation.
- **No dead code / no over-engineering** — PASS. `SparkJobSubmitter.execute` is deliberately caller-less; that is the ticket's own "trait admits a second impl" evidence, exercised by a test, not speculative abstraction.
- **Behavior-preserving** — PASS. The diff genuinely *moves* the two-call chain behind the trait and does nothing else; I found no drive-by behavior change at either call site.

### Phase 3: UI Review — N/A

No trigger matched: the diff touches only `backend/src/**` and `openspec/changes/pipeline-execution-backend/**`. `ApiRoutes.scala`, `schemas/**`, and `openspec/specs/**` are all untouched.

### Overall: PASS

### Change Requests

None.

### Non-blocking Suggestions

- `PipelineRunService.scala:297` — the `.recover { case ex =>` body retains its old indentation while its enclosing block dedented by two spaces, so the recover block now reads as under-indented relative to its brace. Purely cosmetic (no Scala formatter runs in the hook chain), but a two-space re-indent would make the diff cleaner for the next reader.
- `PipelineExecutionBackend.scala:11` — scaladoc typo: "all three of the ticket's phrase's steps" (double possessive); read as "the ticket's phrase — submit → status → read result".
- `InProcessPipelineEngineSpec` parity test calls `engine.loadRowsWithStats(ds, mockRepo)` a second time solely to recover `directPrimaryStats`, discarding the first call's copy inside the tuple destructure. Harmless against the in-memory fake, but a single `Await` returning the full 4-tuple would be shorter and would not depend on the load being idempotent.
- Neither `execute` implementation carries the `override` modifier. Legal in Scala for a concrete implementation of an abstract member and consistent enough here, but adding `override` would make an accidental future signature drift on the trait a compile error at the impl rather than an "object does not implement" error further away.
