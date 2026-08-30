# Tasks

## 1. Red tests first (must fail before any production change)

- [x] 1.1 Build the fixtures. **TWO are required, not one** — shape (d) is not constructible alongside the others (design D2a): every JSON-bearing source flattens nested objects at ingest via `PipelineRowJson.jsRowToRow` -> `JsonFlattener.leaves` (`PipelineRowJson.scala:95`), so a nested value can never appear in a multi-row JSON fixture.

  **Materialization seam (applies to both fixtures).** `upsertFieldsFromRows` and `onUnblockedRunSuccess` are both `private`, so the only seam that can satisfy "assert on the persisted `fields` and on the capability report" is a **real run through `PipelineRunService.submit`**, exactly as `PipelineRunServiceSpec` already does (embedded Postgres + a keyed `stubConnector`, `PipelineRunServiceSpec.scala:56-70`). Two consequences, both of which silently invalidate the plan if missed:
  - A `static` source is effectively rectangular — `PipelineRowJson.parseStaticRows` zips a fixed `colNames` list against each row — so it cannot express shape (a)'s sparseness in any way worth relying on. **Use a JSON-returning source**: add a new keyed URL to the existing `stubConnector` returning the heterogeneous `JsArray`.
  - Because task 2.1a changes the signature of a **private** method, the same test code must compile against BOTH pre- and post-change production code for task 1.12's red/green record to mean anything. Going through `submit` is what makes that true; a direct call to the private method would satisfy neither 1.12 nor the ticket's acceptance criteria.

  **Fixture (i) — heterogeneous JSON source.** One `JsArray` of rows carrying all seven of these shapes. A uniform-row fixture cannot fail on these defects and does not count:
  - (a) **sparse column** — `rec` absent from row 0, present on a later row (primary defect).
  - (b) **fractional column** — a column whose row-0 value is non-integral (the `"double"` defect, D4). Pick a genuinely fractional value such as `12.5`: `jsValueToAny` collapses every JSON number to `Double`, and `inferJsonType` decides `integer` vs `float` on `n.remainder(1) == 0`, so a literal `1.0` infers as `integer`, not `float`.
  - (c) **integral-then-fractional column** — integral in row 0, non-integral later (widening, D6).
  - (e) **mixed numeric/non-numeric column** — a number on row 0, `"N/A"` on a later row (D6 eligibility loss).
  - (f) **date-like string column** — an ISO date string on every row (D5 transition C, `string` -> `timestamp`).
  - (g) **numeric-with-explicit-null column** — **integral** numbers (never fractional), with an explicit JSON `null` on a row that is **NOT row 0** (D8). Both constraints are load-bearing and must not be varied:
    - *Integral, not fractional*: a fractional column types `"double"` pre-change, which `wireType` drops entirely, so the "still offered for a Numeric slot" half would be RED before the change.
    - *Null off row 0*: pre-change inference reads row 0 alone, so a null in row 0 would type the column `"string"` pre-change and make the test RED before the change.
    This is *explicit null*, a DIFFERENT code branch from shape (a)'s *absence*; both are needed.
  - (h) **all-null column** — a column present as a key on every row but explicitly `null` on every one of them (D8's fallback branch). This is where an implementation is most likely to break: the accumulator is `None`, and `getOrElse(StringType)` versus an unsafe `.get` versus dropping the key entirely are indistinguishable to every other test — and dropping the key would silently violate D6's "key set is strictly additive" invariant.

  **Fixture (ii) — image source, for shape (d) only.** A separate single-row run from an `image` source, whose `content` value is a nested `BinaryRef` map. `InProcessPipelineEngine.loadImageRowFromBytes` (`:318-333`) is the **sole** producer of a nested `Map[String, Any]` row value in the backend, and it yields exactly one row of fixed shape — it cannot be sparse, cannot carry an all-null column, and cannot be merged with fixture (i). It backs test 1.8 and nothing else.
- [x] 1.2 Test: the output DataType's **persisted** `fields` include the sparse column (a). Assert on what was written to the repository, not on a helper's return value.
- [x] 1.3 Test: `PanelCapabilityService.getCapabilities` reports the sparse column (a). This is the criterion that matters — assert on the capability report, not only on `fields`.
- [x] 1.4 Test: the fractional column (b) is typed `float` and appears in the capability report. Confirm the pre-fix red is specifically because `"double"` fails `DataFieldType.fromString` and is dropped by `wireType` — not merely that some assertion failed.
- [x] 1.5 Test: column (c) is typed `float`, not `integer`.
- [x] 1.6 Test: order-independence — the same rows reversed produce identical field names and types.
- [x] 1.7 Test: every derived field is `nullable = true`, including a column present and non-null on every row. This is the HEL-868 guard: it must fail if someone later adopts the shared engine's nullability wholesale.
- [x] 1.8 Test (D2/CR1), against **fixture (ii)**: the nested column (d) is a **single** field named `content`, typed `string`. Assert that NO dotted field (`content.storageKey` etc.) appears, and that the field name matches the key actually persisted in the row by `overwriteRows` — schema and rows must agree. This test fails if flattening is ever adopted for this path.
- [x] 1.9 Test (D6/CR2): the mixed column (e) is typed `string` and is NOT offered for a `Numeric` slot. This pins the accepted eligibility loss as deliberate, so it cannot regress silently in either direction.
- [x] 1.10 Test (D7/CR4): each field's `displayName` equals its raw column name — `rec_yd` stays `rec_yd`, not `"Rec Yd"`.
- [x] 1.11 Test (D5 transition C): the date-like column (f) is typed `timestamp` and gains `Orderable` eligibility. **Resolved by the D5 audit: C is safe-to-improvement at every consumer, so pin `timestamp`.** No pipeline-output column has ever carried this type before, so this is new capability (timeline `time` slots), not a migration.
- [x] 1.11a Test (D8): the numeric-with-explicit-null column (g) is typed **`integer`** — NOT `string` — and IS still offered for a `Numeric` slot. **Expected GREEN both before and after the change**: it guards a regression this change could introduce, not a defect being fixed. Do not report it as a failed red, and do not weaken it to manufacture one — it is the only thing distinguishing the correct implementation from the regressive one.
  The green-before claim holds *only* because shape (g) uses integral values with the null off row 0. **If you observe a red here, the fixture is wrong, not the expectation** — fix the fixture to match task 1.1(g), do not relax the assertion.
- [x] 1.11b Test (D8 fallback): the all-null column (h) **appears in the persisted `fields` at all** — assert its presence explicitly before asserting anything about it — and is typed `string`. Also assert it appears in the capability report. Like 1.11a this is a **regression guard, expected GREEN before and after** (pre-change, row 0 carries the key with a null, so `inferFieldType(null)` already yields `"string"`). Its value is catching a post-change implementation that drops the key or crashes on an empty accumulator.
- [x] 1.12 **Record the red — and know which tests are supposed to be red.** Run every new test against unmodified production code and capture the output as evidence in the change directory. The two sets are fixed; do NOT try to make a green-before test red, and do NOT weaken one to manufacture a red:

  **Genuinely RED before the change (these prove the defects exist):** 1.2, 1.3, 1.4, 1.5, 1.6, 1.9, 1.11. For each, confirm the failure is caused by the specific defect it targets — not by a fixture, wiring, or compilation error. A red for the wrong reason is not evidence.

  **GREEN before AND after — regression guards, not defect proofs:** 1.7, 1.8, 1.10, 1.11a, 1.11b. Each guards a property this change could break, and each is the sole pin on a design decision. Their pre-change green is deliberate evidence, recorded as such:
  - 1.7 (D3) — `nullable = true` is already hardcoded at `PipelineRunService.scala:755`. Guards against adopting the shared engine's nullability.
  - 1.8 (D2) — `inferFieldType`'s catch-all already types a nested map `"string"`. Guards against adopting flattening.
  - 1.10 (D7) — `DataField(name, name, ...)` already writes the raw display name. Guards against adopting the engine's prettified one.
  - 1.11a (D8) — guards against a null poisoning the type join.
  - 1.11b (D8 fallback) — guards against an all-null key being dropped or crashing.

  If a test in the green set comes up red, the fixture or the test is wrong — fix it, do not relax the assertion. If a test in the red set comes up green, stop: either the defect is not what the design says, or the test cannot detect it. Escalate rather than proceeding.

- [x] 1.13 Reconcile the tests against design D5's completed three-transition audit before implementing; if reality contradicts an expectation encoded above, fix the design first, not the test.

## 2. Implementation

- [x] 2.1 Add a **shallow** entry point to `SchemaInferenceEngine` that unions TOP-LEVEL keys across a `Vector[JsObject]`. For each key, fold its values into a widened type as follows, mirroring `inferFromObjects`' accumulator (`:99-118`):
  - **An explicit `JsNull` MUST be branched on FIRST and contribute nothing to the type** (design D8). Do NOT pass it to `inferJsonType` — that returns `StringType` and would widen the whole column to `string`. This is the single most important line in this task; implementing it the naive way is a regression worse than the bug being fixed.
  - Any other value goes through `inferJsonType`, joined into the accumulator with `widenJson`.
  - A key whose values were all `JsNull` (or which has no non-null value) falls back to `StringType`.
  - It must NOT call `JsonFlattener.leaves` (design D2).
  - Sort the merged key set globally for order-independence, matching `inferFromObjects`.
  - **Every key in the union MUST appear in the output**, including an all-null one (D6's additive invariant). Use a total fallback (`getOrElse(StringType)`); never an unsafe `.get`, never a filter that could drop a key whose accumulator is empty.
  - Return shape is the implementer's choice, but if it reuses `InferredField`, note at the call site that its `nullable` is discarded by D3 — keep that exception visible where the projection happens, not only in `upsertFieldsFromRows`.
- [x] 2.1a Change `upsertFieldsFromRows` to take `Vector[JsObject]` and derive fields via that shallow entry point, mapping to `DataField` with `DataFieldType.asString` for the type and the RAW key for both `name` and `displayName` (design D7).
- [x] 2.2 Pin `nullable = true` on every derived field, with a comment stating that this is deliberate, that the shared engine's absence-never-contributes rule (design D2) would be a regression here, and that HEL-868 should revisit it.
- [x] 2.3 Update the call site in `onUnblockedRunSuccess` to pass `jsRows` — the same value handed to `overwriteRows`, so schema and rows are derived from one source.
- [x] 2.4 Delete `inferFieldType`. Confirm by grep it has no remaining caller; do not leave it dead. Note `extractBinaryRefs` still consumes `resultRows` and must keep working — only the schema derivation moves to `jsRows`.
- [x] 2.4a Re-read the comments referencing `upsertFieldsFromRows` by name (`DataTypeRepository.scala:77,152`; `PipelineRepository.scala:204`) and update any that the signature change makes inaccurate.
- [x] 2.5 Confirm no other caller of `upsertFieldsFromRows` exists that still needs the `Seq[Map[String, Any]]` shape.

## 3. Verification

- [x] 3.1 Run the new tests green. Show the same tests red-then-green in the report.
- [x] 3.2 `sbt test` for the full backend suite. Note that the jest gate is vacuous inside a delivery worktree (HEL-880), so a green root `npm test` is not evidence for this backend change — `sbt test` is.
- [x] 3.3 Confirm no existing test encoded the row-0 behaviour and had to be weakened to pass. If any test changed, state which and why.
- [x] 3.4 Verify design D6 as CORRECTED — not the original claim, which was false. Two separate checks: (i) the KEY SET is additive (no column present in the capability report before is absent after); (ii) the eligibility loss for a mixed numeric/non-numeric column is present, deliberate, and pinned by test 1.9. Do not attempt to show that no eligibility ever changes — that is false and task 1.9 asserts the opposite.
- [x] 3.5 Spot-check design D5's consumer table against the code and confirm each row still holds. Do NOT fix HEL-895 or HEL-896 here — both are filed, both are pre-existing, and both are out of this ticket's scope.
- [x] 3.6 Confirm `extractBinaryRefs` and `overwriteRows` still receive the inputs they expect, and that the nested `content` column round-trips: schema field name, persisted row key, and capability report entry all agree (test 1.8).
