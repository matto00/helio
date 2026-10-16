## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `specs/pipeline-client-evaluator/spec.md` (untracked in the worktree at HEAD `83cbfc0223ec64a1ea060cbe5110ca03e9b0d617`), against the tree at that HEAD and `docs/live-draft-preview.md` §3, §5, §9.

### What I verified (with evidence)

Claims that hold:
- **Registry, 27 kinds.** `PipelineStep.scala:256-284` registers exactly the 27 kinds the ticket lists. `Registry` is public (`val Registry: Map[String, Companion]`), so check 1 is implementable.
- **evaluate signature.** `PipelineStep.scala:80`: `def evaluate(rows: Seq[Map[String, Any]], ctx: PipelineExecutionContext)(implicit ec): Future[Seq[Map[String, Any]]]`. The design leaves out the implicit `ec`, which is harmless. `PipelineExecutionContext` (`:98`) has `resolveLane`, `loadSource`, `writeBackSink` and `aiClient` with defaults.
- **Value typing.** `PipelineRowJson.scala:54-64`: `jsValueToAny` turns every `JsNumber` into a `Double`. `anyToJsValue` (`:27-50`) is as described.
- **Compute numStr.** `ExpressionInterpreter.scala:268-269`: `if (v.isWhole) v.toLong.toString else v.toString`. This is correct.
- **SupportedFunctions.** These are the 15 names (`ExpressionEvaluator.scala:77-81`). Depth limits are 100/200 (`ExpressionParser.scala:76,80`). The grammar doc agrees (`docs/compute-expression-grammar.md:278-280`). The legacy fallback triggers only on the `$`-prefix error (`:394-400`, `ExpressionEvaluator.scala:123`), so the design's decline rule on that error is correct and conservative.
- **stringops.** `StringOpsStep.scala:105,148`: `s.trim` is `java.lang.String.trim`, and `v.toString.split(Pattern.quote(separator), -1)`. The design's trim and split claims are correct. The operation list (`:96`) matches the design.
- **Enumerations.** Join, union, aggregate, groupby, fillnull, pivot, dedupe, splittext, datebucket and cast all match Decision 1. I checked each `Supported*` list in `domain/steps/*.scala`.
- **executeTree.** `InProcessPipelineEngine.scala:360` accepts supplied `rootFrames` and is driven by `InProcessPipelineEngineTreeWalkSpec` through `new PipelineStepRepository(null)` / `new DataSourceRepository(null)`. It is usable as a walk oracle **for vectors where every step succeeds**. See CR2 for the cases where a step fails.
- **CI JDK 21.** `.github/workflows/ci.yml:234` sets `java-version: 21`. The local JDK is 21.0.12.
- **Precedent.** The `shared-test-fixtures/` seam precedent exists. A seam for the compute function list also exists already: `compute-expression-functions.json` plus `ComputeExpressionFunctionsSeamSpec`.

Claims that are wrong or incomplete. These drive the change requests below.
- **A. Bare `evaluate` is not the engine's run path.** `evalOneStep` (`InProcessPipelineEngine.scala:248-285`) first runs `companion.requiredConfigProblems(encodeConfig(config))` and fails the step on any problem. Only then does it call `evaluate`. 17 companions override it, 14 of them client or identity kinds (`grep -rn "override def requiredConfigProblems" domain/steps`).
  - Concrete divergence: `ComputeStep.apply` (`ComputeStep.scala:65-79`) returns **null for every row** on a parse failure. Its own comment says that path is "unreachable from run/preview/analyze once the companion gates below reject the step first". `ComputeStep.requiredConfigProblems` (`:115-120`) fails the step on any `parseProblem`.
  - The design's step-vector runner ("decode … evaluate", Decision 4 runner 1) therefore certifies behaviour the engine never produces. The required "Depth-limit parse errors" trap vector would bless all-null output, where the real engine fails the step.
- **B. executeTree fails the whole walk.** On the first step failure, `loop` (`:455-482`) propagates a failed `Future[TreeWalkResult]` carrying `StepExecutionException(stepId, …)`. `nodeOutcomes` is never returned, so no frame of any node is observable. Lane violations fail the whole walk before any step runs (`:384-412`).
  - The walk schema in Decision 4 is `expectByStep: {<id>: {rows} | {error: true}}`. It cannot express what the required walk vectors need: `needsServer` / `blocked` / `notPreviewed` statuses, frames for nodes that do not depend on the error, and an AI step. With the default `AiStepClient.Unavailable`, an AI step fails the whole Scala walk.
  - Decision 5 says a lane violation "is an `error` on that step. This matches executeTree's pre-check". That is not what the engine does: the engine fails the run.
- **C. The cast date/timestamp row is factually wrong.** `CastStep.scala:97-100`: a **String** that `TimestampParsing.parseInstant` rejects becomes `null`, not "keeps the original string". A **non-String** numeric epoch becomes `Instant.toString` (ISO-8601). Corpus input numbers are doubles, so that is the common case. The design does not mention it, and the value model has no `Instant.toString` / `ISO_INSTANT` rendering obligation. Compute's `date_trunc`/`add_days` also render through `DateTimeFormatter.ISO_INSTANT` (`ExpressionDateTimeFunctions.scala:90`).
- **D. `disabled` steps are missing.** `executeTree` treats a disabled step as transparent (`:440-441`): never evaluated, frame passed through. That holds for every kind, including server and AI kinds. Frontend steps carry `enabled` (`frontend/src/features/pipelines/types/pipelineStep.ts`). Neither Decision 5 nor the walk-vector schema (`{id, kind, parentStepId, rootId, config}`) has `enabled`. Ruling F's "AI step and everything downstream is `notPreviewed`" is undefined for a disabled AI step.
- **E. The regex "safe subset" is a denylist, and it admits constructs that differ between Java and JavaScript.** The design states that "every pattern inside the subset must compile identically in both engines", and the subset includes `\s` and `$` (Risks section). That is false:
  - Java `\s` without `UNICODE_CHARACTER_CLASS` is `[ \t\n\x0B\f\r]`. JavaScript `\s` also matches U+00A0, U+2003, U+FEFF and others.
  - Java `$` (no MULTILINE) also matches before a final line terminator. JavaScript `$` matches only at the end.
  - Java `.` excludes U+0085. JavaScript `.` does not.
  - Java `\v` is a vertical-whitespace class. JavaScript `\v` is VT only.
  - Without the `u` flag, JavaScript `.` and negated classes match half a surrogate pair. Java matches whole code points.
  - Escapes the denylist does not name (`\e`, `\a`, `\cX`, `\0nn`, `\x{…}`, `\N{…}`, `\k<…>`) and Java-invalid forms that non-`u` JavaScript accepts (`a{`) can compile differently or error on one side only. Scala raises `StepConfigError` for an invalid pattern (`StringOpsStep.scala:158-163`).
- **F. Check 3 cannot compile where the design puts it.** `ExpressionEvaluator.SupportedFunctions` is `private[engine]` (`ExpressionEvaluator.scala:77`). `PipelineStepParitySpec` is placed in `com.helio.domain.steps` (Decision 4, task 1.2). A `com.helio.domain.steps` test cannot read it. The proposal says the only backend addition is a test spec, so changing visibility is also out.
  - The existing `compute-expression-functions.json` seam already checks the same list, plus operators and literals, against Scala (`ComputeExpressionFunctionsSeamSpec`, package `engine`). A second `manifest.computeFunctions` copy duplicates it.
- **G. Numeric parsing outside `cast` is not pinned.** `PipelineRowJson.toDouble` uses Scala 2.13 `String.toDoubleOption` (Scala `2.13.15`, `build.sbt:4`). It is used by sort, aggregate, fillnull, window and filter `=`/`!=`. Filter's ordered operators use `v.toString.toDouble`, i.e. `java.lang.Double.parseDouble` (`FilterStep.scala:124-125`).
  - Java parse accepts forms JavaScript `Number` does not (`"1d"`, `"1f"`, hex-float `"0x1p3"`) and rejects forms JavaScript accepts (`"0x10"`).
  - The design's value model (Decision 3, obligations 1-5) has no obligation for these shared numeric-parse primitives. The only numeric-parse trap is the `cast integer`/`Number(s)` mutation, so a `Number(s)` coercion in sort or filter would pass every listed trap.
- **H. "schema" in the per-step cache is undefined.** The ticket, Decision 5 and task 4.1 all say the cache holds rows, schema, count and status, but nothing defines schema. It could be column names from rows, or inferred types that must match `StepSchemaInference` / `ColumnSchemaInference`. A competent implementer could read it either way, and there is no acceptance signal for it.

Scope:
- Decision 1 plus Decision 2 pin the kind and feature set, and the decline reasons. The driver's demand 1 is substantively met at the kind/function level, apart from regex (E) and disabled steps (D).
- Demand 2 (the corpus runs against the real engine) is intended, but A and B mean the planned oracle is not the engine's real behaviour for failing or partial walks.
- Ticket ACs: every AC maps to a task (1.x to 6.x). No scope drift found. No API, schema or migration change is planned, which is correct because there is none.

### Verdict: REFUTE

### Change Requests

1. **Step-vector oracle must follow the run path (A).** Decision 4 runner 1 and task 1.2 must apply `companion.requiredConfigProblems(companion.encodeConfig(decoded))` before `evaluate` and treat any problem as `{error: true}`, mirroring `InProcessPipelineEngine.evalOneStep` (`:270-273`). The cleanest way is to drive single steps through `executeTree` with a one-root, one-step tree, which also reuses the real lane and secondary plumbing.
   - Decision 2 and task 3.5 must state that the TS evaluator ports each client and identity kind's `requiredConfigProblems` as `error`.
   - Name the `compute` parse-problem behaviour explicitly: the step fails; it does not produce null rows. The "Depth-limit parse errors" trap must expect `{error: true}`.
2. **Specify how walk vectors are checked against the oracle when a walk has a failure (B).** Extend the walk-vector schema with a client-side expected status per step (`ok | error | needsServer | notPreviewed | blocked`), kept separate from the Scala-verified frames. For each failure-bearing vector, define what the Scala runner asserts:
   - **Error vector:** the walk fails with `StepExecutionException.stepId ==` the expected error step. Frames of nodes that do not depend on it are verified by a second `executeTree` run over the tree without the failing subtree, or by an equivalent stated mechanism. A frame is never just written into the file.
   - **Lane violation:** the walk fails with `LaneReferenceError`. Correct Decision 5's "matches executeTree's pre-check" wording: the client marks the step `error`, while Scala fails the whole run.
   - **Server kind mid-pipeline:** Scala computes every frame. The vector asserts the client status, not client rows, for that step and the steps below it.
   - **AI step mid-pipeline:** say how the oracle handles it, for example an engine built with a stub `AiStepClient`, or Scala frames asserted only upstream of the AI step.
3. **Correct the cast date/timestamp row and add an Instant rendering obligation (C).**
   - String input: kept only if `parseInstant` accepts it, otherwise `null`.
   - Non-String numeric input: rendered as `TimestampParsing.epochInstant(v).toString`, with the fallback order at `CastStep.scala:99`.
   - Add a Decision 3 obligation to reproduce Java `Instant.toString` / `DateTimeFormatter.ISO_INSTANT`: fractional seconds printed as 0, 3, 6 or 9 digits.
   - Add trap vectors: a whole-second epoch, a millisecond epoch, and an unparseable string to `null`.
4. **Add disabled steps to the walk (D).** Decision 5 and the walk-vector schema must carry `enabled` (and `position`, which `executeTree`'s ordering and trunk selection read).
   - A disabled step of **any** kind, including server and AI kinds, is transparent: its input frame passes through, and it causes no decline and no `notPreviewed` cascade.
   - Add walk vectors: a disabled mid-pipeline step, and a disabled AI step with steps below it.
5. **Replace the regex denylist with an allowlist (E).**
   - Pin a safe subset that admits only constructs proven to match: literal characters, escaped metacharacters, `\d \D \w \W`, simple character classes and ranges, capturing groups, alternation, and the greedy and lazy quantifiers `* + ? {n} {n,} {n,m}`.
   - Either decline or explicitly translate the divergent constructs: `\s`/`\S` to `[ \t\n\x0B\f\r]`, `.` excluding U+0085, Java `$`, `\v`.
   - State the JavaScript flags. Compile with `u`, or decline.
   - Require that a pattern Java rejects yields `error` on the client, not rows.
   - Required vectors: `\s` against U+00A0, `$` against a trailing `\n`, `.` against an astral character and against U+0085, and a Java-invalid pattern.
   - Remove the claim that "every pattern inside the subset must compile identically" unless the allowlist actually guarantees it.
6. **Make check 3 compile and stop duplicating (F).** Either place the function-list check in package `com.helio.domain.engine`, or, preferably, drop `manifest.computeFunctions` and hold the TS function table, and the `unknownFunction` decline set, to the existing `shared-test-fixtures/compute-expression-functions.json`. That fixture is already checked against Scala by `ComputeExpressionFunctionsSeamSpec`.
   - Hold the TS operators and literals to the same file too.
   - Update tasks 1.1, 1.2 and 2.2, and the check 3 and check 5 mutation wording, to match.
7. **Pin the shared numeric parsing primitives (G).** Add a Decision 3 obligation that the TS value model ports, as named shared functions:
   - Scala 2.13 `String.toDoubleOption` (behind `PipelineRowJson.toDouble`);
   - `java.lang.Double.parseDouble` (`.toDouble`);
   - `toInt` / `toLong` / `toBoolean`.

   Every step uses these instead of `Number()`. Add trap vectors run through at least `sort`, `filter` (`>` and `=`) and `aggregate sum` with `"1d"`, `"1f"`, `" 1 "`, `"0x1p3"`, `"0x10"`, `"NaN"`, `"Infinity"` and `"+1"`. The expected values come from the oracle.
8. **Define the per-step "schema" (H).** Either pin it as the ordered union of column names observed in the output frame, with no types and no parity claim, or define the types and hold them to the Scala inference. Add the acceptance signal (which test asserts it) to task 4.1.

### Non-blocking notes
- The Scala step-vector runner needs a `DataSourceRepository` stub whose `findByIdInternal` returns a `DataSource` for a source secondary (`JoinStep.scala:101`). Overriding `loadSource` alone is not enough. Constructing steps from (kind, raw config) needs a 27-arm match like the private `PipelineStepRepository.rowToDomain` (`:1320`); a missing arm should fail loudly.
- `upsertsource`'s Scala `evaluate` is not pure identity. `checkTarget` (`UpsertSourceStep.scala:45-55`) fails an `ExistingSource` target when the owner is `None` or the target is unknown or non-writable. The vectors must use a `NewSource` target or a stubbed repo plus owner. The design should state that the client's pass-through for an `ExistingSource` target deliberately skips that server-side check (the step can still fail at Save & run).
- Precedence between "a source secondary with no supplied frame is declined" and "an empty or unconfigured secondary gets whatever Scala does" should be stated: empty `dataSourceId` means mirror Scala's error.
- Comparator (Decision 3): say explicitly that the class check runs in both directions. An actual integral where the vector holds a plain double must also fail, because `Double.toString` makes the difference observable downstream.
- `NaN` and `±Infinity` cannot be carried as JSON numbers, and `JsNumber(Double.NaN)` cannot be constructed. The corpus needs an encoding (for example `{"$double": "NaN"}`) or must avoid such outputs. Pin one.

Gate defect check: no report under review disclosed unsound mtimes, and no mtime-ordering claim was relied on here.
