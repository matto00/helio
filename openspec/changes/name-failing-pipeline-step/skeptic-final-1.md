## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold review of `05a38156`. Every conclusion below is derived from the diff, the files, or
commands I ran myself. The evaluator's report was read as a set of claims to attack.

No `frontend/**` files are in the diff (`git diff main...HEAD --stat` — 14 code files, all
`backend/src`), so the UI/design-judgment section does not apply and no servers were started.

### What I verified (with evidence)

**Gates re-run by me, in the worktree.**
- `sbt -batch 'testOnly PipelineRunRoutesSpec InProcessPipelineEngineSpec PipelineAnalyzeServiceSpec
  SparkJobSubmitterSpec PipelineRunServiceSpec'` → `Total number of tests run: 349 / succeeded 349,
  failed 0`.
- `sbt -batch 'testOnly com.helio.api.routes.hooks.HookRoutesSpec'` → `7 / succeeded 7, failed 0`.
  (The evaluator's Decision-3 table listed `HookRoutesSpec:324` and `PipelineRunServiceSpec:380` as
  "must be re-run rather than reasoned about"; I re-ran both. Their `should not include "Pipeline
  execution failed"` assertions still hold.)

**Item 1 — deleted `case other =>` arms. Coextensive today; acceptable as shipped.**
Read all four sites in the diff and in the files. Val vs. arms:
| Step | `SupportedX` | `case` arms |
| --- | --- | --- |
| `AggregateStep` | sum, avg, min, max, count | sum, avg, min, max, count |
| `GroupByStep` | sum, count | sum, count |
| `JoinStep` | inner, left | inner, left |
| `UnionStep` | byPosition, byName | byPosition, byName |
Exactly coextensive in all four. Case-normalisation also matches the guard in each case (Aggregate/
GroupBy/Join `.toLowerCase` on both sides; Union on neither — matching main's pre-existing behaviour),
so no analyze/runtime asymmetry is introduced.

I judge the residual hazard **not a blocking defect**: if a future value is added to a `SupportedX`
without an arm, the `MatchError` is not an `IllegalArgumentException`, so `StepExecutionException.from`
collapses the reason to `"step execution failed"` — but the message is still
`Pipeline execution failed at step <id> (<kind>): step execution failed`, which still carries the step
id and kind and is therefore *strictly better than main's status quo*, not a regression to it. It is a
latent maintenance hazard, not a shipped one. Non-blocking note 1.

**Item 2 — Decision 5, per step: satisfied, one copy, not three.**
Confirmed in the diff that in all four extraction steps the hardcoded list inside the error string was
**deleted** along with the arm and replaced by `SupportedX.mkString(", ")` in a pre-`match` guard.
`AggregateStep:96`, `GroupByStep:66`, `UnionStep:73`, `JoinStep:62`. The four already-conforming steps
(`StringOpsStep`, `FillNullStep`, `WindowStep`, `PivotStep`) were only de-`private`d; their message text
is unchanged and still interpolates the same val. `PipelineAnalyzeService`'s eight validators each read
the step object's own val — no third copy anywhere.

I additionally checked for **analyze-time false positives** (Decision 5's stated risk) by diffing each
validator against the step's runtime predicate. All eight are identical, including the two subtle ones:
`validateWindow`'s `cfg.offset.exists(_ <= 0)` is equivalent to `WindowStep`'s
`cfg.offset.getOrElse(1); if (o <= 0)` (absent ⇒ neither fires), and `validateFillNull`'s
`cfg.value.isEmpty` matches `FillNullStep`'s `cfg.value.getOrElse(throw …)`. No validator can reject a
value the engine accepts.

**Item 3 — I tried to defeat the allowlist and could not.**
The forwarding surface is exactly `StepExecutionException.from`'s `case iae: IllegalArgumentException =>
iae.getMessage`, reached only from `executeWithStepCounts`'s fold. So the attack question is: what
`IllegalArgumentException` can escape a `step.evaluate`?
- **Steps themselves.** Enumerated every `throw new IllegalArgumentException` under `domain/steps/`
  (23 sites). All are hand-written config messages naming a config value and the supported set. None
  interpolates a class name, path, stack frame, or SQL.
- **`ctx.loadSource` re-entering `InProcessPipelineEngine.loadRows`** — the real attack surface, since
  `JoinStep`/`UnionStep`/`LookupStep` call it *inside* the fold, so its IAEs now reach the client where
  on `main` they were flattened. I read every IAE construction site in `loadRows`: the `csv`/`text`/
  `pdf`/`image`/`rest` "missing required config key 'path'" messages carry only the data source's own
  **name and id** (never the path value); the `rest_api` / `sql` cases wrap `connector.fetch`'s
  `Left(err)`. I read both drivers: `SqlConnectorDriver`'s only `Left` is the fixed DDL/DML-rejection
  string, and `RestApiConnectorDriver`'s are the pre-existing deliberately-curated set
  (`"Connector not found"`, `"Request failed"`, `rootSelector …`, `HTTP <n>: <upstream body>`). **No
  connection string, JDBC error, credential, file path, or class name is reachable.** JDBC/IO failures
  are `SQLException`/`IOException`, not `IllegalArgumentException`, so they hit the fixed-string arm.
- **All four surfaces named in the ticket carry the same string** and are covered by passing tests:
  SSE `errorLog` (`PipelineRunRoutesSpec` "…via SSE naming the failing step"), persisted
  `PipelineRunRecord.errorLog` ("…step-attributed errorLog"), the `422` response ("…returns 422 naming
  the failing step"), and `previewStep` (`PipelineRunService.scala:214-221`, same `case see:
  StepExecutionException` match as the run path). `pipeline_runs.error_log` is `TEXT` (V24), so the
  longer message cannot truncate or fail the insert.
- The mutation the evaluator claims kills the leak test is real: I read the test
  (`InProcessPipelineEngineSpec:2345-2372`). It uses a purpose-built fake `PipelineStep` failing with a
  genuine `RuntimeException`, and asserts absence of both the leaky payload and the **simple** class
  name from `reason` *and* `getMessage` — stronger than the spec's package-qualified requirement.

**Item 4 — Spark genuinely out of scope AND genuinely unreachable.**
`git diff main...HEAD --stat -- '*SparkJobSubmitter*'` is empty; both files exist untouched at
`com/helio/spark/`. `SparkJobSubmitterSpec:360,367` still assert the bare `"Pipeline execution failed"`
and **passed in my own run**, confirming the Spark path is unaffected. On reachability: `grep -rn
"sparkJobSubmitter" backend/src/main/scala/com/helio/api/` returns only the `ApiRoutes:84` **parameter
declaration** — it is constructed in `Main.scala:109`, passed in, and never used in any route body. The
inconsistency is therefore dead wiring, not a live gap.

**Item 5 — Decision 7's hook is genuinely extensible by HEL-860.**
Shipped signature is `validateStepConfig(kind: String, config: String): Option[String]` — dispatched on
kind, taking the **raw** config string, exactly as Decision 7 requires so 860 can see keys the typed
decoder drops. Per-kind validators return `Vector[String]`, joined by
`if (problems.isEmpty) None else Some(problems.mkString("; "))` — the multi-failure join is present, so
860 adds arms rather than a parallel hook. The `catch { case _: Exception => Vector.empty }` around the
dispatch deliberately defers malformed-config reporting to the unchanged `inferOutputSchema` path; that
is documented in-place and is a boundary 860 will need to be aware of, not one it fights.

**Item 6 — prose against code. No false unchanged/preserved claim found.**
- Decision 3 "static prefix preserved verbatim at the start" — TRUE
  (`Exception(s"Pipeline execution failed at step …")`).
- Decision 3's explicit `Do not describe this change as "backward-compatible"` and its four-row table of
  existing assertions — I re-derived the table with `grep -rn "Pipeline execution failed" backend/src`.
  It matches exactly: `PipelineRunRoutesSpec` (3 sites, all updated in the diff), `SparkJobSubmitterSpec`
  (2, untouched), `HookRoutesSpec:324` and `PipelineRunServiceSpec:380` (both `should not include`,
  untouched, both re-run green by me).
- Decision 6's claim that the set of step files containing a `throw` is *exactly*
  `{StringOps, FillNull, Window, Pivot, Aggregate, GroupBy, Union, Join}` plus `DateBucket`/`Lookup`'s
  `Future.failed` sites: I re-ran the enumeration. `grep -rln "throw new"` returns exactly those eight;
  `grep -rln "Future.failed"` returns `DateBucket`, `Lookup`, `Join`, `Union`. The claim is accurate
  (Join/Union appear in both, consistent with the design text).
- Decision 4 "no new response shape … existing consumers work unchanged" — TRUE; `validationError` is
  already `string|null` and zero frontend/schema files are touched.
- Commit message: "instead of the opaque … constant", "each driven by the same `SupportedX` val" — both
  true; it makes no unchanged/compatible claim that the diff contradicts.
- The one imprecision I found: `proposal.md`'s "Anything else keeps today's opaque message". The code
  gives `Pipeline execution failed at step <id> (<kind>): step execution failed` — richer than today's
  message, not identical to it. `design.md` Decision 3 and the spec delta both state this correctly
  ("with the step id and kind still attached"). Non-blocking note 3.

**Item 7 — all six ACs traced to the tree, not to the reports.**
1. *Names step id, type, reason; a test asserts all three.* — `PipelineRunRoutesSpec` "POST
   /pipelines/:id/run failure via unsupported stringops operation names the step id, kind, and reason"
   asserts `badStep.id.value`, `"stringops"`, `"regexExtract"`, `"extractRegex"` in one message. Green in
   my run. **MET.**
2. *Analyze reports non-`none` `validationError` for unsupported `stringops` operation.* —
   `PipelineAnalyzeService.analyze` now runs `validateStepConfig` before `inferOutputSchema`; test
   "stringops — analyze-time validation: unsupported operation is reported before any run". **MET.**
3. *`regexExtract` surfaces `extractRegex` among supported ops at analyze time.* —
   `validateStringOps` interpolates `StringOpsStep.SupportedOperations.mkString(", ")`, which contains
   `extractRegex`; asserted by that test. **MET.**
4. *No stack traces or internal class names client-side.* — allowlist audited above; leak test asserts
   it and the evaluator's mutation probe killed the mutant. **MET.**
5. *Successful runs unaffected; error-shape change reflected in schemas/openspec.* — the success path in
   the fold is untouched apart from the `try`/`recoverWith` wrapper; 349+7 tests green including all the
   success-path suites. No wire shape changed (`ErrorResponse.message` is free text; `validationError`
   already `string|null`), so no `schemas/` edit is warranted; the openspec half is delivered by the two
   spec deltas (`pipeline-run-execution` MODIFIED, `pipeline-step-config-validation` ADDED), which I read
   and which match the code. **MET.**
6. *Curated error reaches the MCP surface as readable text.* — traced statically end to end:
   `ErrorResponse{message}` → `helio-mcp/src/httpClient.ts:236-242` `` `${fallback}: ${body.message}` ``.
   The evaluator additionally pasted the literal tool text from a live run against a real PAT. **MET.**
   (I verified the passthrough code path myself rather than re-running a live server.)

**Housekeeping.** `git status --porcelain` in the main checkout is clean — no stray probe artifacts,
screenshots, or MCP scratch files were left behind by the verification work.

### Verdict: CONFIRM

### Non-blocking notes

1. **Deleted default arms (item 1).** The four `match`es in `AggregateStep`/`GroupByStep`/`UnionStep`/
   `JoinStep` are now total only by construction. Cheapest durable guard is a one-line unit test per step
   asserting every value in `SupportedX` is accepted by `apply` (which would fail with a `MatchError` the
   moment a value is added without an arm). Worth folding into HEL-860 rather than reopening this one.
2. **Analyze-validator coverage is partial.** `PipelineAnalyzeServiceSpec` gains tests for `stringops`,
   `fillnull` and `window` only. `aggregate`, `groupby`, `pivot`, `union` and `join` validators ship
   untested at the analyze surface, as does the multi-failure `mkString("; ")` join that Decision 7 says
   HEL-860 inherits. The code is mechanically symmetric with the (tested) runtime checks and I verified
   the equivalence by reading, so this is coverage debt rather than a defect — but the join in particular
   is a stated contract for the sibling ticket and should carry a test before 860 builds on it.
3. **`proposal.md` imprecision** (item 6, last bullet): "Anything else keeps today's opaque message" is
   not literally true — the non-allowlisted path still adds step id and kind. `design.md` and the spec
   delta are correct; only the proposal's summary sentence is loose.
4. **`catch { case ex: Throwable => Future.failed(ex) }`** in `InProcessPipelineEngine:100` catches fatal
   throwables too (`OutOfMemoryError`, `ControlThrowable`). `scala.util.control.NonFatal` is the
   conventional predicate here. No observable impact on this change's behaviour.
5. **Second-order exposure worth knowing about, not fixing here:** because `ctx.loadSource` now runs
   inside the attributed fold, `loadRows`' `IllegalArgumentException` messages became client-visible for
   join/union/lookup steps. I audited them all and they are clean today, but the *set of strings that are
   now client-facing* is larger than the step-config messages the design discusses. The two closest to a
   boundary are `PDF … could not be parsed: <PDFBox e.getMessage>` and `HTTP <n>: <upstream response
   body>`. Both were already written as curated user-facing text, so this is a note for whoever next
   touches those messages, not a change request.
