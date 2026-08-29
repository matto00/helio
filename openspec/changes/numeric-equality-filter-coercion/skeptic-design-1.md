## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

1. **Root-cause audit against actual code.** Read `backend/src/main/scala/com/helio/domain/steps/FilterStep.scala:90-114` in full. The `=`/`!=` arm does exactly what the ticket/proposal claim: `fieldVal.toString == value.getOrElse("")`. The ordering-operator arm does parse both sides with `toDouble`/`toString.toDouble`. Ticket's root-cause claim is accurate, not hand-waved.

2. **D4 operator table checked by enumeration against the real `match`.** The `match` in `evalCondition` has exactly the arms design.md D4 lists: `is null`, `is not null`, `contains`, `"=" | "!="`, `">" | ">=" | "<" | "<="`, `case _`. No missing or invented arm. D4's per-arm decisions (unchanged for `is null`/`is not null`/`contains`/ordering/fallthrough, changed for `=`/`!=`) are exhaustive and correctly justified — `contains`'s numeric-row-value textual-match consequence is explicitly named and pinned by a scenario, not left implicit.

3. **Runtime-type claim (design.md Context + D1) checked against every ingestion path, not just JSON.** Read `backend/src/main/scala/com/helio/domain/engine/PipelineRowJson.scala` in full:
   - `jsValueToAny`: `JsNumber(n) => n.toDouble`, `JsString(s) => s` — confirms numbers become `Double`, strings stay `String`.
   - `jsRowToRow` (connector ingestion path, REST/SQL): routes every field through `jsValueToAny` via `JsonFlattener.leaves`.
   - `parseStaticRows` (static-source ingestion path): also routes every column value through `jsValueToAny`.
   Both real ingestion paths converge on the same per-field `jsValueToAny` conversion the ticket's root-cause analysis cites — there is no ingestion path that produces a `Double` from a JSON string or vice versa. This directly substantiates the named regression hazard: `player_id`/`rookie_year` genuinely remain `String` at runtime on every path, so D1's type-discriminated rule (numeric coercion gated on `fieldVal`'s runtime type, not on "both sides parse") is grounded in real behavior, not assumed. The symmetric "parse both sides" alternative was correctly rejected with a concrete counter-example (`player_id = "7"` would wrongly match `"007"`), which I confirmed reflects true behavior of `PipelineRowJson.toDouble`'s `case s: String => s.toDoubleOption` (that function is genuinely symmetric and is deliberately *not* reused here, per D5).

4. **D5 helper-placement claim checked.** `PipelineRowJson.toDouble` is consumed outside `FilterStep` by `AggregateStep`, `FillNullStep`, `PivotStep`, `SortStep`, `WindowStep`, `GroupByStep`, and `AlertEvaluationService` (`grep` confirmed). Narrowing that shared function to drop its `String` case would regress six other steps and the alert evaluator — D5's decision to keep the stricter helper local to `FilterStep` is correct and non-arbitrary.

5. **"Demand the red" is achievable given the actual test harness.** `backend/src/test/.../FilterStepSpec.scala` (current, single test) already calls `FilterStep.apply(rows, cfg)` on a materialised `Vector[Map[String, Any]]` and asserts on the returned row set — exactly the "measurement on materialised rows, not a helper's return value" pattern tasks.md 3.1–3.4 require. No existing test exercises `=`/`!=` at all, so task 3.1 (add a test asserting `years_exp = "0"` returns the row, run it unmodified, paste the failure) will genuinely produce a red against today's code — verified by inspection of the current `=`/`!=` arm (line 95-98), which stringifies `0.0` and would fail to match `"0"`.

6. **Spec delta (`specs/pipeline-filter-op/spec.md`) is consistent with design.md and tasks.md.** Scenarios cover: numeric match across textual forms (`"0"`, `"0.0"`), non-match, string-column exact equality, numeric-looking-string non-coercion (`"007"` vs `"7"`), non-numeric condition value against numeric row value, `!=` mirror cases, null semantics for both `=` and `!=`, and `contains` non-coercion. This set matches AC bullets 1-4 and 6 in ticket.md one-for-one; no AC is left uncovered by a task or scenario.

7. **No placeholders/TBDs.** Grepped design.md/tasks.md/proposal.md for `TODO`/`TBD` — none found. Every design decision (D1-D5) states its alternative-considered and rejection reason; nothing deferred that blocks implementation.

8. **Scope containment.** Impact section and tasks.md confine the change to `FilterStep.evalCondition` plus a survey task and tests. No wire/schema change, consistent with proposal's stated non-goals. Task 2.1 (survey saved pipelines) is a read-only reporting task, appropriately scoped as "report, don't auto-migrate."

### Verdict: CONFIRM

### Non-blocking notes
- Task 3.1 says "stash the production change" to get the red — since this is design gate (pre-implementation), this is naturally satisfied (the red is measured before 1.2 is applied); worth the executor keeping the red's console output verbatim in the report as tasks.md already requires.
- Consider (non-blocking, not required) also asserting the `Float`/`BigDecimal` cases of `numericFieldValue` somewhere, since row values from connector paths are typed `Double`/`String` only today per `jsValueToAny` — the extra runtime-type branches in the helper (`Int`/`Long`/`Float`/`BigDecimal`/`java.math.BigDecimal`) are defensive/future-proofing beyond what any current ingestion path produces. Not a blocker; explicitly justified by design.md as defensive breadth, and untested branches here carry no live risk since no path currently constructs those types.
