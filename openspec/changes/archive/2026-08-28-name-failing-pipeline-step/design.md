# Design — HEL-859: name the failing step and its reason

## Context

Two surfaces are broken in the same way: diagnostic detail exists in the code and is discarded before it
reaches the caller.

- **Run time.** `InProcessPipelineEngine.executeWithStepCounts` folds over the steps, calling
  `step.evaluate`. When a step throws, the `Future` fails and the exception propagates to
  `PipelineRunService`, which at `:218` (`previewStep`) and `:374` (`run`) replaces it with the constant
  `"Pipeline execution failed"`. That constant fans out to three client-visible surfaces: the SSE
  `errorLog` event, `RunStatusResponse.error`, and the persisted `PipelineRunRecord.errorLog`.
- **Analyze time.** `PipelineAnalyzeService` infers a schema per step and may set `validationError`, but its
  per-kind inference functions look only at the fields they need for typing. `inferStringOps` reads
  `outputColumn` and nothing else, so an unsupported `operation` yields `validationError = None` for a step
  that cannot possibly run.

The genericisation at run time is deliberate: HEL-311 introduced it to stop raw exception tails reaching
clients. That constraint is honoured here — the fix is not to revert HEL-311 but to make a narrow, explicitly
curated class of message showable.

## Goals / Non-goals

**Goals.** Uniform step attribution for every step kind; analyze-time detection of config errors that today
only fail at run time; no internal detail (class names, stack frames, SQL, file paths) in client-facing text;
a validation surface HEL-860 can extend.

**Non-goals.** HEL-860's write-time rejection of mistyped config keys. Any change to which failures are fatal.
Per-row data-quality reporting.

## Decisions

### Decision 1 — Attribute the failure in the engine's fold, not in each step

`executeWithStepCounts` is the single place that holds both the step and the failure. Wrapping there covers
every step kind, present and future, with no per-step work, and satisfies the ticket's "not a `stringops`
special case" requirement structurally rather than by 24 separate edits.

Rejected: having each step throw a self-describing exception. That requires touching every step class, and a
future step author who forgets gets today's behaviour back silently.

Rejected: catching in `PipelineRunService`. The step identity is not in scope there — only the aggregate
`Future` is.

### Decision 2 — A dedicated `StepExecutionException` carrying `stepId`, `stepKind`, and a curated reason

The engine wraps a failed `step.evaluate` in `StepExecutionException(stepId, stepKind, reason, cause)`. The
`reason` is derived from the cause by an allowlist (Decision 3), never by `ex.getMessage` unconditionally.
The original cause is retained for server-side logging, which continues to log the full throwable exactly as
it does today.

### Decision 3 — Message exposure is an allowlist, not a blocklist

Only `IllegalArgumentException` — the type every step's own hand-written config validation throws — has its
message forwarded to the client. Every other throwable (`NullPointerException`, `SQLException`, IO failures,
anything from a library) contributes the fixed string `step execution failed`, with the step id and kind
still attached.

This is the load-bearing safety decision. A blocklist ("strip anything that looks like a stack trace") fails
open on the next unanticipated exception type; an allowlist fails closed. `IllegalArgumentException` messages
in this codebase are hand-written and audited (they name a config value and the supported set); nothing
constructs one from a stack trace or a class name.

Consequence for the error text: `Pipeline execution failed at step <stepId> (<kind>): <reason>`. The static
prefix `Pipeline execution failed` is preserved verbatim at the start, so existing clients and tests matching
on that prefix keep matching.

**This is a behaviour change to the message body, not only an addition.** The complete set of existing
assertions on this string, established by `grep -rn "Pipeline execution failed" backend/src`, is:

| Location | Form | Expected effect of this change |
| --- | --- | --- |
| `PipelineRunRoutesSpec` :533, :634, :756 | exact match | **Changes** where the failure originates in a step; update to match the new attributed message. |
| `SparkJobSubmitterSpec` :360, :367 | exact match | **Unchanged.** The Spark path is out of scope (Decision 3a) and this test's failure is a Spark analysis exception, not a step-level `IllegalArgumentException`. Do not edit these; they guard HEL-311's no-leak property. |
| `HookRoutesSpec` :324 | `should not include` | Direction unaffected, but must be re-run rather than reasoned about. |
| `PipelineRunServiceSpec` :380 | `should not include` | Same. |

Do not describe this change as "backward-compatible" or "preserving the existing message" — it preserves the
prefix only.

### Decision 3a — The Spark execution path is out of scope

`SparkJobSubmitter.scala:94` flattens failures with the same constant, but it is a *separate* execution path
that does not run `InProcessPipelineEngine`'s fold and therefore has no step-level attribution point of the
kind Decision 1 relies on. Its failures are Spark analysis/planning exceptions rather than the hand-written
`IllegalArgumentException`s this change forwards, so the allowlist would in any case contribute nothing but
the fixed non-descriptive reason. Attributing failures on the Spark path needs Spark-side per-step execution
metadata that does not exist today; that is its own ticket, not a rider on this one.

Concretely: `SparkJobSubmitter` is **not modified**, and `SparkJobSubmitterSpec`'s two exact-match assertions
(`:360`, `:367`) are **not modified**. If either turns out to need editing, that is a signal the change has
leaked outside its intended path — treat it as a defect, not as expected churn.

### Decision 4 — Analyze-time validation is a separate hook from schema inference

`PipelineAnalyzeService` gains `validateStepConfig(kind, config): Option[String]`, dispatched by kind and
called *before* the existing `infer*` function for that step. If it returns a message, that becomes the
step's `validationError` and the output schema falls back to identity — exactly the existing contract for a
step with a validation error, so no new response shape is introduced and the `validationError` field's
existing consumers (`pipeline-step-validation-display` in the UI, `analyze_pipeline` in MCP) work unchanged.

Keeping validation separate from inference matters: inference must stay tolerant (it deliberately guesses
schemas for configs it cannot fully resolve), while validation must be strict. Folding strictness into the
`infer*` functions would make every existing tolerant fallback a candidate for a false positive.

### Decision 5 — One supported-value set per step, which drives the check, the message, and the validator

The general rule, applied to all eight in-scope steps: each step object exposes exactly one
supported-value set, and that set is the **single source of truth** — the step's own runtime check and its
own error-message text are both driven by it, and the analyze-time validator reads the same val. A copied
list anywhere would drift the first time a step gains a value, and the analyze surface would then reject a
value the engine accepts, which is worse than today's silence.

Four steps already satisfy this and are the pattern to follow: `StringOpsStep.SupportedOperations` (:94),
`FillNullStep.SupportedStrategies` (:80), `WindowStep.SupportedFunctions` (:100, plus `FieldRequired` :101),
and `PivotStep.SupportedAggs` (:76) each interpolate `SupportedX.mkString(", ")` into their own error
message. For these, the only work is making the val visible to the analyze service.

Four steps do **not** satisfy it and must be brought to it: `AggregateStep` (:97-99), `GroupByStep` (:72),
`UnionStep` (:78-80) and `JoinStep` (:75-77) have no set at all — their supported values exist only as
literal `case` arms *plus a hardcoded duplicate inside the error-message string*. For these, extract a
`SupportedX` val and then rewrite both the runtime check and the error message to be driven by it. Adding a
new val beside an unchanged `match` and an unchanged hardcoded message is explicitly not acceptable: that
would leave three copies where there are two today, creating exactly the drift this decision exists to
prevent.

### Decision 6 — Scope of the analyze-time audit: enum-valued config only

In scope (validation that exists today but fires only at execution, and is decidable from config alone):
`stringops.operation`, `fillnull.strategy` (plus `constant` requiring `value`), `window.function` (plus its
`field`/`offset` requirements), `aggregate.func`, `groupby.agg`, `pivot.agg`, `union.mode`, `join.type`.

Deliberately out of scope:

- `datebucket`'s "no row parsed as a timestamp" — a *data* condition, not a config error. It cannot be
  decided without rows, and reporting it at analyze time would be a false positive on an empty sample.
- `union`/`join`/`lookup`'s "DataSource not found" — needs repository access the analyze layer does not
  have. `PipelineAnalyzeService` already documents this limitation for `union`.
- Field-existence checks against the inferred input schema. Several steps deliberately null-coerce missing
  fields at execute time; turning that into an analyze error would change behaviour, not just reporting.
- Steps that perform *no* validation at all and silently no-op on a bad value (`ComputeStep`, `SortStep`,
  `DedupeStep`, `CastStep`, `RenameStep` — all contain zero `throw` sites). These are not "validation that
  exists but only fires at execution"; nothing exists to promote. They are HEL-860's subject, and adding
  checks for them here would be implementing 860 under this ticket's name.

This in-scope list was derived by enumerating every `throw` site under `backend/src/main/scala/com/helio/domain/steps/`,
not by sampling: the set of step files containing a `throw` is exactly
`{StringOps, FillNull, Window, Pivot, Aggregate, GroupBy, Union, Join}` plus `DateBucket` / `Lookup`'s
`Future.failed` sites, which are the out-of-scope cases above.

### Decision 7 — Constraint on HEL-860 (stated explicitly, per the sibling-coordination requirement)

`validateStepConfig` is dispatched on the step **kind** and receives the **raw config string**, not a decoded
typed config. This is deliberate and is the decision that constrains HEL-860: 860 needs to detect keys that
the typed decoder silently drops (a mistyped `CastStep`/`RenameStep` key becomes an empty no-op after
decoding), so it must be able to see the raw JSON object including keys the decoder ignores. Had this hook
taken the decoded config, 860 would have had to add a second, parallel hook. 860 extends this one by adding
its unknown-key check to the same per-kind dispatch, returning through the same `Option[String]`.

The corollary 860 must respect: this hook returns at most one message per step, so 860's checks and this
change's checks must be composed (all failing checks joined into a single message) rather than either
silently winning. This change establishes the join, so 860 inherits it.

## Risks

- **Information disclosure.** Mitigated by Decision 3's allowlist. The residual risk is a future
  `IllegalArgumentException` whose message embeds untrusted or internal content; the spec delta states the
  constraint so it is reviewable, and a test asserts no package-qualified class name reaches the client.
- **Test churn.** Real, and enumerated in Decision 3. Every claim about which existing tests still pass must
  be established by running them, not by reading them.
- **Analyze-time false positives.** A validator stricter than the engine would reject a runnable pipeline.
  Decision 5 (read the engine's own sets) is the mitigation; Decision 6 bounds what is checked at all.
