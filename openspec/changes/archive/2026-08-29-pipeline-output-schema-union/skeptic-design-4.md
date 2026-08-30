# Skeptic Report — design gate (round 4, skeptic-design-4.md)

## What I verified (with evidence)

### Round-3 CR1 (shape (g) pre-change colour) — RESOLVED, and the reasoning is TRUE against code

Task 1.1(g) now pins **integral values with the explicit null on a row that is NOT row 0**, and
states why each constraint is load-bearing. Both halves check out against
`PipelineRunService.scala:741-757`:

- *Null off row 0*: `upsertFieldsFromRows` reads `firstRow = rows.headOption` (:754) and calls
  `inferFieldType(firstRow.get(name).orNull)`. Row 0 therefore carries an integral value, and
  `inferFieldType` matches `case _: Int | _: Long => "integer"` (:743) or
  `case d: Double if d % 1.0 == 0.0 => "integer"` (:744). Pre-change type = `"integer"`.
- *Integral, not fractional*: had it been fractional, :745 `case _: Float | _: Double => "double"`,
  and `"double"` is dropped by `PanelCapabilityService.wireType`. Task 1.1(g)'s stated reason is
  exactly right.
- `"integer"` IS canonical (`DataFieldType.fromString`, `model.scala:596-617`) and
  `SlotEligibility.accepts` admits `IntegerType` for `Numeric`. So **1.11a is genuinely green
  pre-change**, both halves.
- Post-change it is also `integer`: engine rows carry all numerics as `Double`
  (`PipelineRowJson.jsValueToAny:56`, `JsNumber(n) => n.toDouble`), `anyToJsValue` re-emits
  `JsNumber(d)`, and `inferJsonType`'s `n.scale <= 0 || n.remainder(1) == 0` branch
  (`SchemaInferenceEngine.scala:149-152`) yields `IntegerType` for `42.0`. The narrowed assertion
  to `integer` is satisfiable, not accidentally red. 1.11a's "a red means the FIXTURE is wrong"
  framing is correct.

### Round-3 CR2 (all-null column) — RESOLVED, and its pre-change colour is TRUE

- Shape (h) added; test 1.11b asserts presence-in-`fields` first, then `string`, then the
  capability report. That is the right assertion order for the "key silently dropped" failure mode.
- Pre-change green verified: the key is present on row 0, so `firstRow.keys` includes it; the value
  is `null`, so `firstRow.get(name).orNull` is `null`; Scala type patterns never match `null`, so
  `inferFieldType` falls to `case _ => "string"` (:746). `"string"` is canonical → present in the
  capability report. Green before, green after. Correct as written.
- Task 2.1's new totality bullet ("every key in the union MUST appear... total fallback, never an
  unsafe `.get`, never a filter") is the right specification, and it matches the shared engine's own
  ending (`inferFromObjects` :120-123, `dataTypeOpt.getOrElse(DataFieldType.StringType)`).

### Nothing from rounds 1-2 regressed

Re-read D2/D3/D4/D5/D6/D7/D8 and tasks 1.2-1.11, 2.1-2.5, 3.1-3.6 against the current files. D2's
no-flattening rationale, D3's nullability pin, D4's delete-not-repair, D6's corrected
additive/eligibility split, D7's raw displayName and D8's JsNull branch are all present and
unweakened, each still pinned by its task. The "six shapes" → "eight shapes" correction is made
(task 1.1) and 1.12's exception now names both 1.11a and 1.11b. Round-3's non-blocking
return-shape note is folded into task 2.1's last bullet.

### New finding (blocking) — derived by enumerating how each fixture shape can actually reach `resultRows`

I traced every one of the eight shapes back to a constructible source, since nothing in the plan
states how the fixture is produced. Seven are reachable through a JSON-bearing source; **shape (d)
is not reachable in the same fixture as any of the others.**

- The connector/JSON ingest path is `PipelineRowJson.jsRowToRow` (`PipelineRowJson.scala:95`):
  `case obj: JsObject => JsonFlattener.leaves(obj).map { case (k, fv) => k -> jsValueToAny(fv) }`.
  `JsonFlattener.walk` recurses into every nested `JsObject` (`JsonFlattener.scala:75-84`).
  **Any nested object in a REST / SQL / static source row is flattened to dotted keys at ingest**
  and never reaches `resultRows` as a `Map[String, Any]`.
- `JsNull` and scalars are leaves, so shapes (a), (b), (c), (e), (f), (g), (h) all survive ingest
  intact (`jsValueToAny(JsNull) = null`, `PipelineRowJson.scala:54`) — confirming the null shapes
  are constructible end to end.
- The only producer of a nested `Map[String, Any]` row value in the whole backend is
  `InProcessPipelineEngine.loadImageRowFromBytes` (`:318-333`), which builds the `content` BinaryRef
  map. I grepped `storageKey` across `backend/src/main/scala`: no other write site. `ComputeStep`
  goes through `jsValueToAny` (objects become `compactPrint` strings); `LookupStep` copies values
  from the other side's already-flattened rows.
- That loader returns `Seq(Map(...))` — **exactly one row with a fixed six-key shape**, from an
  `image` data source requiring a real stored file. It cannot be sparse, cannot carry an all-null
  column, and cannot be merged with a REST fixture's rows by any step in this plan's scope.

Consequence: task 1.1's "ONE explicitly enumerated fixture... must contain all eight shapes" is
**unsatisfiable as specified**. And tasks 1.2/1.3/1.8 (and the ticket's own AC) forbid the escape
hatch of asserting on a helper's return value — they require persisted `fields` plus the capability
report. The likely executor responses are both bad: silently drop test 1.8 (the round-1 CR1 guard
against flattening), or weaken 1.2/1.3/1.8 to engine-level assertions the AC explicitly rejects.

## Verdict: REFUTE

Both round-3 items are genuinely resolved and nothing regressed. The one blocking item is a
constructibility defect in the test plan that has been latent since round 1 (shape (d)) and that
none of rounds 1-3 checked, because no artifact ever states how the fixture is materialized.

## Change Requests

1. **Split task 1.1's fixture: shape (d) cannot share a fixture with shapes (a)-(c), (e)-(h).**
   A nested `Map[String, Any]` row value is producible only by
   `InProcessPipelineEngine.loadImageRowFromBytes` (`domain/engine/InProcessPipelineEngine.scala:318-333`)
   — one fixed single row from an `image` source. Every JSON-bearing source flattens nested objects
   at ingest via `PipelineRowJson.jsRowToRow` → `JsonFlattener.leaves`
   (`PipelineRowJson.scala:95`, `JsonFlattener.scala:75-84`), so `content` can never appear as a
   nested value in a sparse multi-row fixture. Restate 1.1 as **two** fixtures — (i) the
   heterogeneous JSON-source fixture carrying shapes (a), (b), (c), (e), (f), (g), (h), and (ii) a
   separate image-source fixture for shape (d) backing test 1.8 — and record in design.md D2 that
   the image loader is the *sole* producer of a nested row value, since that is what makes D2's
   no-flattening decision matter at all and what makes the two-fixture split necessary rather than
   stylistic.

2. **State how the fixture is materialized, in tasks 1.1/1.2.** `upsertFieldsFromRows` and
   `onUnblockedRunSuccess` are both `private`, so the only seam that satisfies "assert on the
   persisted `fields` and the capability report" is a real run through
   `PipelineRunService.submit`, as `PipelineRunServiceSpec` already does (embedded Postgres +
   a keyed `stubConnector`, `PipelineRunServiceSpec.scala:56-66`). Name that seam and note the
   two constraints it imposes, both of which silently invalidate the current plan if missed:
   (i) a `static` source is rectangular (`PipelineRowJson.parseStaticRows` zips a fixed
   `colNames` list against every row) and therefore **cannot** express shape (a)'s sparseness —
   the fixture must be a JSON-returning source, e.g. a new keyed URL on the existing
   `stubConnector`; (ii) because the signature change in task 2.1a is on a private method,
   the same test code must compile against both pre- and post-change production code for
   task 1.12's red/green record to be meaningful — going through `submit` is what makes that
   true, and a direct-call test would satisfy neither 1.12 nor the AC.

## Non-blocking notes

- Verified in passing while checking 1.11a's post-change value: `jsValueToAny` collapses all
  numerics to `Double`, so the `integer` vs `float` distinction post-change rests entirely on
  `inferJsonType`'s `n.remainder(BigDecimal(1)) == 0` test, not on the original JSON's literal
  form. Shapes (b)/(c)/(g) are unaffected, but a fixture author who writes `1.0` expecting `float`
  will get `integer`. Worth one sentence in task 1.1(b) so the executor picks a genuinely
  fractional value.
- D5's `WorkspaceContextService` line references are still a few lines off (noted in rounds 2 and
  3). Substance holds; not worth another round.
