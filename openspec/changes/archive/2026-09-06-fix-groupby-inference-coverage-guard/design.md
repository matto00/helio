## Context

`PipelineAnalyzeService.inferOutputSchema` (`op match`, ~line 447) covers 22 of the 23
kinds in `PipelineStep.Registry`. `groupby` is the sole gap. Runtime probe, taken before
any code was written, with two negative controls to verify the instrument:

| probe | result |
| --- | --- |
| `select` (control) | `validationError=None` |
| `join` (control, HEL-911) | `validationError=None` |
| `groupby` | `Some("Unknown op: 'groupby'")`, outputSchema = identity passthrough |
| `PipelineStep.Registry` | 23 kinds |

Both controls returned green, so the instrument can distinguish pass from fail; the
`groupby` result is a real observation, not an artifact of a probe that fails on
everything.

## Goals / Non-Goals

**Goals.** Correct `groupby` inference (names *and* types). A coverage guard that makes
this defect class non-recurring.

**Non-Goals.** `join` inference — already shipped in HEL-911 with a regression test at
`PipelineAnalyzeServiceSpec.scala:1043`.

**Correction (skeptic round 3).** This document previously claimed HEL-860's "unassertable"
comments were "already gone". That was wrong — it rested on a grep of a single file
(`PipelineAnalyzeServiceSpec`) generalized to the whole tree. A full-tree sweep finds exactly
one survivor: `PipelineAnalyzeRoutesSpec.scala:492-497`, which states `groupby`/`join` have no
dispatch case and their valid-config path is "unassertable". It is already half-false today
(HEL-911 gave `join` an arm) and becomes wholly false when this change lands. Removing it is
therefore IN scope — see tasks section 7.

**Also Non-Goals:** any change to the `AnalyzedStep` wire shape, and any migration.

## Decisions

### Decision 1: output column name is `<aggFunction>_<aggColumn>`, from a shared helper

`GroupByStep.apply` computes `val outputCol = aggFn + "_" + aggCol` where
`aggFn = cfg.aggFunction.toLowerCase`. The ticket's original wording ("aggregate alias
field") is wrong — `GroupByConfig(groupBy, aggColumn, aggFunction)` has no alias field.

Inference MUST NOT re-implement this string concatenation, or the two can drift exactly
the way the registry and dispatch drifted. Extract the naming into
`GroupByStep.outputColumnName(cfg: GroupByConfig): String`, called by **both**
`GroupByStep.apply` and `inferGroupBy`. Note this makes the *name* a shared-source value,
which is why the name is not what the AC2 test asserts against — see Decision 5.

**Lowercasing is load-bearing.** Runtime lowercases `aggFunction`; inference must too, or
a config carrying `"SUM"` projects `SUM_amount` while the engine emits `sum_amount`.
Skeptic round 1 pre-answered the open question here: `validateGroupBy` (line ~414) DOES
lowercase (`val fn = cfg.aggFunction.toLowerCase` before `SupportedFunctions.contains(fn)`).
There is no pre-existing inconsistency to report. The real lowercasing hazard is on the
TYPE path instead — see Decision 2.

### Decision 2: aggregate type follows the FUNCTION, not the input column

Reuse the existing `aggResultType(fn, field, inputSchema)` helper (line ~1006), which
already returns `"integer"` for `count` and `"float"` for `sum`.

**The lowercased value must be passed in (skeptic CR3).** `aggResultType` matches on the
raw `fn` string and ends `case _ => "string"`. `validateGroupBy` lowercases before checking
`SupportedFunctions`, so a config carrying `"SUM"` is *accepted* — and would then project
`sum_amount` typed **`string`** instead of `float`. That is precisely the "confidently wrong
about types" outcome this decision exists to prevent. Compute
`val fn = cfg.aggFunction.toLowerCase` ONCE and use that same value for both the column name
and the `aggResultType` call. These match the runtime
exactly: `count` computes `.toLong`, `sum` computes `nums.sum` over `Double`s.

This is the subtle part. `count_amount` is an `integer` even when `amount` is a `float`,
and `sum` over an `integer` column yields a `float`. A schema that is confidently wrong
about types is worse on the agent surface than one reporting `Unknown op`, because
nothing signals the doubt.

`GroupByStep.SupportedFunctions` is `{sum, count}` only, and `validateGroupBy` rejects
anything else *before* inference runs, so `aggResultType`'s `min`/`max`/`avg` arms are
unreachable from this path. Reusing the helper is still correct and keeps one place to
change if `SupportedFunctions` grows.

### Decision 3: group-key types resolve from the input schema by name; absent keys are best-effort

At run time `keyMap = groupCols.zip(keyValues).toMap`, where a key column missing from a
row yields `null`. Inference resolves each key's type from the input schema by name.

For a `groupBy` column absent from the input schema, the honest projection is a
best-effort `string` (the conservative canonical type this file already uses as its
fallback elsewhere). Document this in-source with the reason, mirroring how HEL-911
documented `join`'s best-effort passthrough — do not silently emit a confident type.

### Decision 4: the coverage guard calls `inferOutputSchema` DIRECTLY, via widened access

Expected set: `PipelineStep.Registry.keySet`. Actual coverage: **call `inferOutputSchema`
directly**, once per kind, with a fully valid config and a compatible input schema, and
assert the returned **`validationError` is `None`**. Never merely "not an `Unknown op`" —
see "Belt and braces" below for why that weaker form is forbidden.

**Access (skeptic CR1).** `inferOutputSchema` is currently `private def` inside
`object PipelineAnalyzeService` — Scala object-private, so the spec *cannot* call it even
from the same package. Widen it to `private[engine]` with an in-source comment stating the
widening exists for the coverage guard and for no other reason. This must be decided here,
not improvised by the executor at the compile error.

**Why direct invocation, and not via `analyze` (skeptic CR2 — decisive).** `analyze` /
`analyzeNodes` (lines ~136-139, ~271-278) do this:

```scala
validateStepConfig(step.op, step.config) match {
  case Some(msg) => (currentSchema, Some(msg))
  case None      => inferOutputSchema(...)
}
```

**Inference is not called at all when validation reports a problem.** So a guard routed
through `analyze` and keyed on "did we see `Unknown op`" would go *vacuously green* for
every kind whose probe config trips validation — inference is never reached, no `Unknown
op` can be produced, and the kind counts as covered without having been probed. This is
not hypothetical: **13** step files override `requiredConfigProblems` (Limit, Compute,
ChunkByTokenCount, DateBucket, Dedupe, Pivot, ExtractHeadings, SplitText, Filter,
StringOps, Join, Lookup, Window) and 8 kinds have per-kind validators in
`validateStepConfig`. A guard built the obvious way would assert coverage it never
established — the exact defect class this ticket exists to end, reproduced inside its own
guard.

Calling `inferOutputSchema` directly removes the interception path entirely: validation
cannot stand between the probe and the dispatch under test.

**Belt and braces.** Even calling directly, the guard MUST use a **fully valid** config per
kind and assert the returned `validationError` is `None` — not merely "not an `Unknown op`".
Anything else means the probe reached a config-error arm rather than the real inference
body, and a probe that did not exercise inference must fail loudly rather than count as
covered.

Note that several kinds validate config fields **against the input schema**, not just for
well-formedness (`pivot`, `assert`, `unpivot`, `compute` via `ExpressionEvaluator.validate`, and
`splittext`/`extractheadings`/`chunkbytokencount`, which need a `string-body`-typed field
present; note `window` does NOT — this list is illustrative, not exhaustive).
The guard therefore needs a per-kind *input schema* compatible with each probe config, not
merely a well-formed config. Achievability was checked, not assumed: `validationError ==
None` is attainable for all 23 kinds under direct invocation, because the three
secondary-input kinds degrade cleanly when `secondarySchema` is `None` (`inferUnion`,
`inferJoin`, `inferLookup` all return `None` in that case) and every other kind only reports
an error on a malformed config or a field absent from the input schema — both of which the
guard author controls.

A guard comparing `Registry.keySet` against a hand-maintained `SET_OF_DISPATCHED_KINDS`
constant would be vacuous in a second way — two lists agreeing with each other is the very
failure being guarded against. Never do that either.

**Exemptions by name only.** If some kind genuinely cannot be probed, exempt it in an
explicit `Map[String, String]` of kind -> stated reason, asserted to be a subset of the
registry. Never a predicate or prefix pattern, which could silently absorb a future kind.
(HEL-845 drew exactly this distinction tonight.) If no kind needs exempting, the map is
empty and that emptiness is itself asserted.

**Failure message names the kind**: "`groupby` has no inferOutputSchema branch", not
"coverage mismatch". A red test that sends the next person hunting has done half its job.

### Decision 5: AC2's test derives its expectation from the runtime, not from the config

Per the evidence standard: a test that builds its expected schema from the same constant
the implementation reads asserts nothing. Since Decision 1 deliberately makes the column
name a shared source, the strongest available independent derivation is the **runtime
itself**: call `GroupByStep.apply` on real fixture rows, take the resulting rows' actual
key set and value types, and assert the inferred schema matches. That cross-checks
inference against execution — two genuinely independent computations — rather than
against its own inputs.

Skeptic round 1 established this is already stronger than stated: `InProcessPipelineEngineSpec.scala`
(`engRow("sum_age") shouldBe 30.0` at ~:359 and `engRow("count_name") shouldBe 2L` at ~:367 —
cite by test name rather than line, which drifts) assert the
emitted column NAME as a literal against real executed rows. Extracting `outputColumnName`
therefore cannot silently change the wire name without turning those pre-existing tests red.

### Decision 6: red arm proven before the fix is accepted

The guard must be demonstrated able to fire. Procedure, recorded in the delivery report:
remove the new `case "groupby"` arm, run the guard, confirm it fails naming `groupby`
specifically, restore the arm, confirm green. A guard that has never named a missing op
has not been shown able to name one.

## Risks / Trade-offs

- **The guard's probe configs could be brittle** as kinds gain required fields. The
  mitigation is to FIX THE PROBE — adjust the per-kind config, and the `inputSchema` it is
  evaluated against, until `validationError` is `None` — or to add an explicit named
  exemption per Decision 4's exemption rule. **Never by relaxing the assertion.** A probe
  that lands in a config-error arm did not exercise inference and MUST fail the guard.
  Keying on "not an `Unknown op`" is the refuted vacuous form (skeptic CR2, round 1) and is
  forbidden, not a fallback.
- **`GroupByStep.outputColumnName` extraction touches the runtime step class.** Small and
  behaviour-preserving (pure extraction of an existing expression), but it means AC2's
  test must not become the only check on `apply` — the existing engine specs still cover
  execution.

## Migration Plan

None. Pure inference logic; no persisted shape, no wire shape, no migration. Main is at
V102 and this change adds no migration file.

## Open Questions

None outstanding. The one premise question (scope, given HEL-911) was escalated and
answered `proceed-with-restated-scope`.
