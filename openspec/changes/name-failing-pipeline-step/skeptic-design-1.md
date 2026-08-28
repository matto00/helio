## Skeptic Report — design gate (round 1, skeptic-design-1.md)

## What I verified (with evidence)

All checks run against the worktree tree, not against the artifacts' narrative.

**Cited file/line locations — verified TRUE except one.**
- `PipelineRunService.scala:218` (`previewStep`) and `:374` (`run`) both flatten to the literal
  `"Pipeline execution failed"`. Confirmed by `grep -n` and by reading `:205-225` / `:365-385`.
- `SparkJobSubmitter.scala:94` — `val errorMsg = "Pipeline execution failed"`. Confirmed (tasks 2.4).
- `StringOpsStep.scala` companion `apply` — the unsupported-operation `IllegalArgumentException` naming
  the bad value and listing `SupportedOperations` is at `:96-98`, matching the ticket's "~line 96".
- `InProcessPipelineEngine.executeWithStepCounts` is at `:58-74` and is exactly the `foldLeft` over
  `step.evaluate` the design describes — it does hold both `step` and the failure. Decision 1 is sound.
- `PipelineAnalyzeService.inferStringOps` (`:430-435`) reads only `json.fields("outputColumn")` and never
  `operation`. The "validationError = None for a step that cannot possibly run" claim is TRUE.
- **FALSE:** design Decision 3 cites `SparkJobSubmitterSpec` "~:332, :339". The actual exact-match
  assertions are at **`:360`** (`runs.head.errorLog shouldBe Some("Pipeline execution failed")`) and
  **`:367`** (`cached.get.error shouldBe ...`). See CR1.

**HEL-311 claim — TRUE.** Not inferred: the code carries the attribution in-place. `PipelineRunService.scala:215-217`
(`// HEL-311: keep the "Pipeline execution failed" prefix, drop the raw exception tail; log the detail
server-side.`) and `:366-372` (`// HEL-311: this single errMsg fans out to three client-visible surfaces —
the SSE errorLog event, RunStatusResponse.error, and the persisted PipelineRunRecord.errorLog`). This also
independently corroborates the design's three-surface fan-out claim and task 2.3.

**Enumerated exact-string tests — complete and correct (line numbers aside).** `grep -rn "Pipeline execution
failed" backend/src` returns exactly: `PipelineRunRoutesSpec:533,:634,:756`; `HookRoutesSpec:324`
(`should not include`); `SparkJobSubmitterSpec:360,:367`; `PipelineRunServiceSpec:380` (`should not include`).
Design Decision 3 names every one of these files and directions; no test was missed.

**"Each named step object holds its own supported-value set" — TRUE but materially uneven.**
`StringOpsStep.SupportedOperations` (`:94`), `FillNullStep.SupportedStrategies` (`:80`),
`WindowStep.SupportedFunctions` (`:100`, plus `FieldRequired` `:101`), `PivotStep.SupportedAggs` (`:76`) are
all real `private val`s. But `AggregateStep`/`GroupByStep`/`UnionStep`/`JoinStep` have **no set at all** —
their supported values exist only as literal `case` arms plus a hardcoded string inside the error message
(e.g. `AggregateStep.scala:97-99` `"Supported: sum, avg, min, max, count"`; `GroupByStep.scala:72`;
`UnionStep.scala:78-80`; `JoinStep.scala:75-77`). See CR3.

**"`IllegalArgumentException` is the type every step's hand-written config validation throws" — TRUE, strongly.**
`grep -n "throw new" *.scala | grep -v IllegalArgumentException` in `domain/steps/` returns **zero** results.
The only other failure channels are `Future.failed`: `DateBucketStep:63,:80` (both also `IllegalArgumentException`),
and `LookupStep:84` / `JoinStep:53` / `UnionStep:67` (DataSource-not-found). Decision 3's allowlist is
correctly grounded.

**Decision 6 in/out-of-scope split — verified correct, and I could not find an omission.** The set of step
files containing a `throw` is exactly `{StringOps, FillNull, Window, Pivot, Aggregate, GroupBy, Union, Join}`
— an exact one-to-one match with Decision 6's in-scope list, including the sub-cases (`fillnull` `constant`
requires `value` at `FillNullStep:91`; `window` `field` at `WindowStep:112` and positive `offset` at `:120`).
I read each of the eight throw sites: **every one is decidable from config alone** — none consults row data,
the schema, or a repository. The out-of-scope items map to real code: `datebucket`'s unparseable-timestamp is
`DateBucketStep:63/:80` (a data condition), and DataSource-existence is `Union:67`/`Join:53`/`Lookup:84`
(repo access the analyze layer lacks — and `PipelineAnalyzeService.scala:86` does already document that
limitation for `union`, as claimed). Steps with silent no-op behaviour on a bad value (`ComputeStep`,
`SortStep`, `DedupeStep`, `CastStep`, `RenameStep` — all zero throws) are correctly *not* in scope here,
since they are not "validation that exists but only fires at execution"; they are HEL-860's subject.

**Decision 7 / HEL-860 fit — genuinely extendable, verified by reading the code.** `CastConfig.decode`
(`CastStep.scala:20-27`) and `RenameConfig.decode` (`RenameStep.scala:21-28`) both do
`obj.fields.get("casts"/"renames") match { case Some(o: JsObject) => ...; case _ => Map.empty }` — a mistyped
key falls through to `Map.empty`, i.e. a silently-stored no-op, exactly HEL-860's bug. Detecting that
*requires* the raw JSON object including keys the decoder ignores, so Decision 7's raw-`String` hook is the
right shape and 860 extends rather than fights it. I also confirmed the raw config string is what
`PipelineAnalyzeService`'s per-kind dispatch already carries (`:101`, `inferX(config: String, ...)`), so the
hook signature needs no plumbing change. The single-`Option[String]` join corollary is likewise necessary.

**Acceptance criteria — all six still unsatisfied on this tree**, and traced to tasks: AC1 → 1.1-1.3/2.1-2.3
+ 5.1; AC2 → 3.1-3.5 + 5.3; AC3 → 5.3; AC4 → 1.3/5.2; AC5 → 4.1-4.2; AC6 → 6.1 (reachable — `analyze_pipeline`
does surface `validationError`, `helio-mcp/src/context.ts:1169`). I also checked for hidden analyze-side test
churn the tasks don't enumerate: every `stringops`/`fillnull` fixture in `PipelineAnalyzeServiceSpec`
(`:127,:756,:765,:773`) uses a *valid* enum value, so the new validators break none of them.

### Verdict: REFUTE

Three required revisions. The artifacts are unusually well-grounded — the prose-against-code sweep found
almost everything true — but there is one internal contradiction that would mislead the executor into
editing green tests, and one soundness hole in the design's own anti-drift invariant.

### Change Requests

1. **Correct the `SparkJobSubmitterSpec` line citations in design.md Decision 3.** It cites "~:332, :339";
   the assertions are at `:360` and `:367`. (`:332` is the test's `in` line, `:339` is mid-fixture.)

2. **Resolve the Spark-path contradiction between design.md Decision 3 and tasks.md 2.4 — it is a deferred
   decision that changes what the executor does.** Decision 1 wraps failures in
   `InProcessPipelineEngine.executeWithStepCounts` only; `SparkJobSubmitter.scala:94` is a *separate*
   flattening on a *separate* path. Decision 3 nonetheless pre-announces that `SparkJobSubmitterSpec`'s
   exact-match assertions "will need updating", while task 2.4 leaves the Spark path's scope explicitly
   undecided ("either extend it or record why the Spark path is out of scope"), and task 5.6 then instructs
   updating those assertions outright. Under the design as currently written those two assertions do **not**
   change — I read the test (`SparkJobSubmitterSpec:333-345`): its failure is a Spark *analysis* exception
   from a filter over `nonexistent_column`, not a step-level `IllegalArgumentException` from
   `step.evaluate`, and it is deliberately asserting HEL-311's no-leak guarantee. As written the executor
   would edit two passing tests that guard a security property. Decide the Spark path's scope **now** in
   design.md (in or out), and make Decision 3's enumeration and task 5.6 agree with that decision.

3. **Decision 5's "never a copy" invariant is not achievable as stated for `AggregateStep`, `GroupByStep`,
   `UnionStep`, and `JoinStep` — say how it will be satisfied.** For those four there is no set to read: the
   supported values live only as `case` arms, and the message already contains a *hardcoded duplicate* of
   them (`AggregateStep.scala:97-99`, `GroupByStep.scala:72`, `UnionStep.scala:78-80`, `JoinStep.scala:75-77`).
   Task 3.4's "the inline sets in AggregateStep / GroupByStep / UnionStep / JoinStep; the validator reads
   those, never a copy" therefore instructs reading something that does not exist, and the path of least
   resistance — introducing a new `Supported*` val beside an unchanged match — creates precisely the
   drift Decision 5 exists to prevent (a third copy, now in three places). Specify that for these four the
   extracted set becomes the **single source of truth**: the step's own runtime check and its error message
   must be driven by the extracted val, not merely accompanied by it. Preferably state this as a general
   rule for all eight (`StringOpsStep`/`FillNullStep`/`WindowStep`/`PivotStep` already interpolate
   `SupportedX.mkString(", ")` into their messages, so they satisfy it today and are the pattern to follow).

### Non-blocking notes

- AC5's "existing successful runs are unaffected" has no task or test of its own; it rests on the regression
  suite. Consider naming it in task 5.6 so it is measured rather than assumed.
- Decision 6's out-of-scope section explains *why* data/repo conditions are excluded but does not say why the
  silent-no-op kinds (`ComputeStep`, `SortStep`, `DedupeStep`) are excluded. They correctly belong to
  HEL-860's shape (no validation exists at all, rather than existing-but-late); one sentence saying so would
  close the audit bullet in the ticket's Scope section explicitly rather than by implication.
- Task 7.1's prose-against-code audit is well-aimed. Note that the claim most likely to go stale during
  execution is Decision 3's own sentence "The static prefix `Pipeline execution failed` is preserved verbatim
  at the start" — worth re-checking against the final `StepExecutionException` message construction.
