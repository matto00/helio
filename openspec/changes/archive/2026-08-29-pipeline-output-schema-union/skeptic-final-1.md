## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Commit under review: `0f05ec79`. Backend-only Scala change. Derived cold from the diff,
the files, and gates I ran myself; the evaluator's PASS was treated as a claim.

### What I verified (with evidence)

**Gate, re-run by me (not inherited)**
- `cd backend && sbt -batch test` in the worktree → `Total number of tests run: 3785 / Tests:
  succeeded 3785, failed 0 / All tests passed`, `EXIT=0`. Read from my own log, not quoted.

**D8 — JsNull branched FIRST, contributes nothing (the regression-worse-than-the-bug risk)**
- Read `SchemaInferenceEngine.scala:134-164`. Inside `inferShallowFromJsObjects` the value match
  is `case JsNull => m.updated(key, prior)` as the FIRST branch; `inferJsonType` is unreachable
  for a null, so `widenJson(IntegerType, StringType)` can never be hit by a null cell.
- Not just read — measured. Mutation `case JsNull if false =>` (in the *shallow* function; I
  targeted it by string-index from `def inferShallowFromJsObjects`, so I did not repeat the
  known false-green of mutating `inferFromObjects`' pre-existing `case JsNull` at :103) →
  test 1.11a `keeps a numeric column with an explicit null on a later row typed integer and
  Numeric-eligible` **FAILED**, 48/49 pass. Exactly one test, precisely attributed.

**D2 — no flattening; nested `content` stays one `string` field matching the row key**
- `JsonFlattener.leaves` is not called on this path; the fold is over `obj.fields` (top level only).
- `inferJsonType`'s catch-all returns `StringType` for a `JsObject` leaf, matching the deleted
  `inferFieldType`'s catch-all — behaviour preserved for `content`.
- Confirmed the nested producer is real: `InProcessPipelineEngine.loadImageRowFromBytes:318-327`
  builds `content -> Map(storageKey/mimeType/filename/sizeBytes)`.
- Measured: mutation swapping the call to `SchemaInferenceEngine.inferSchemaFromRows(...)`
  (the flattening entry point) → test 1.8 **FAILED**, 48/49. The guard is live.

**D6 totality — every key reaches the output**
- Projection is `accByKey.toSeq.sortBy(_._1).map { ... dataTypeOpt.getOrElse(StringType) }`.
  No `.get`, no `filter`/`collect`/`flatMap`; a key seen only as `JsNull` is registered as
  `None` and still emitted as `string`.
- Measured: mutation to `.collect { case (key, dt) if dt.isDefined => ... }` → test 1.11b
  (all-null column) **FAILED**, 48/49.

**D3 / D7 — nullable and displayName pinned at the projection**
- `PipelineRunService.scala:752-770`: `displayName = f.name` and `nullable = true` literals,
  each with a comment naming the decision (D7; D3 naming HEL-868 as the ticket that should
  delete the pin).
- Measured both: `nullable = f.nullable` → 1.7 **FAILED**; `displayName = f.displayName`
  → 1.10 **FAILED** (engine's `displayName("rec_yd")` is `"Rec Yd"` — confirmed by reading
  `displayName` at :74-81). 48/49 each.

**D4 — `inferFieldType` deleted, only canonical values emitted**
- `grep -rn inferFieldType backend/` returns two prose-comment hits and zero call sites.
- The projection goes through `DataFieldType.asString`, which is total over the sealed set and
  emits only the 7 canonical values (`model.scala:596-604`), the exact set
  `DataFieldType.fromString` accepts — so `PanelCapabilityService.wireType` can no longer drop
  a pipeline-output column for an unrecognised type string.

**D1 — schema and rows derived from the same value**
- `onUnblockedRunSuccess:621-628` passes `jsRows` to both `upsertFieldsFromRows` and
  `overwriteRows`. `jsRows` is built once at :482 from `resultRows`. No parallel derivation left.

**Red/green evidence audit (independent)**
- `evidence/red-before-change.log` (unmodified production code): 42 succeeded / 7 failed. The
  red set is exactly 1.2, 1.3, 1.4, 1.5, 1.6, 1.9, 1.11 as tasks.md 1.12 predicts, and every
  failure message names the value the defect predicts — `did not contain element "rec"`,
  `Some("double") was not equal to Some("float")`, `Some("integer") ... Some("float")`,
  `Some("integer") ... Some("string")`, `Some("string") ... Some("timestamp")`, and a
  forward-vs-reversed schema mismatch. None failed for a fixture/wiring/compilation reason.
- The five green-set guards (1.7, 1.8, 1.10, 1.11a, 1.11b) passed pre-change AND post-change,
  and I proved **each one failable** by my own mutation probes above (baseline in the probe copy:
  49/49 green; each mutation: exactly 1 failure, the intended one). No guard is vacuous.
- Assertion strength: every new test asserts on the persisted `DataType.fields` (via
  `dataTypeRepo.findByIdInternal`) and/or on `PanelCapabilityService.getCapabilities` output —
  never on a helper's return value. 1.9 and 1.11a additionally assert slot eligibility
  (`capabilities("metric").eligibleColumns("value")`), which is the criterion the ticket names.

**`PipelineRunRoutesSpec` `"double"` → `"float"`: a correction, not a weakening**
- The assertion remains an exact equality on one specific value (`fieldMap("rate") shouldBe
  "float"`); nothing was relaxed to `contain`/`not be empty`/deleted. The old expectation
  encoded the defect itself — `"double"` is not one of the 7 canonical values and was silently
  dropped by `wireType`. The test name and a comment were updated to say why.

**Out-of-scope work untouched (verified by `git diff main...HEAD --name-only`)**
- Only 5 backend files (3 main, 2 test) plus the change dir. `UnionStep` (HEL-894),
  `PipelineAnalyzeService` (HEL-895), `WorkspaceContextService` (HEL-896) and
  `scripts/concertino/**` are all absent from the diff. The one collateral edit is a doc
  comment in `AlertEvaluationService.scala:34-36` that referenced the deleted method — required,
  behaviour-unchanged.

**Acceptance criteria traced**
1. Union of keys across all rows → `inferShallowFromJsObjects` fold; tests 1.2/1.3 (red before).
2. Any-row column bindable → 1.3 asserts on `PanelCapabilityService` output.
3. Widening, order-independent → 1.5 (integral-then-fractional → `float`) and 1.6 (a *second*
   reversed-order keyed URL producing a real second run, not a re-sort of one result).
4. Canonical values only → D4 above; 1.4.
5. `nullable = true` preserved with a comment naming HEL-868 → 1.7, mutation-proven.
6. Red-first on a heterogeneous fixture asserting persisted fields AND capabilities → red log.
7. Compat assessment → design D5's three-transition consumer table, including the accepted
   `integer → string` loss (D6) and the one-shot patch-set-undo 409.
8. Derived-schema-path enumeration recorded in ticket.md, marking the two inheriting paths.

**UI review — N/A, stated explicitly.** The diff touches only `backend/src/main/scala/**` and
`backend/src/test/scala/**`. There is no frontend file, no route/schema/spec-under-`openspec/specs`
change, and therefore no UI surface to exercise. No dev server was started and no screenshot was
taken — deliberately, not skipped silently.

### Verdict: CONFIRM

The design-gate pattern the brief warned about (each round's fix introducing the next round's
regression) does not recur in the implementation: the three exceptions D8, D3 and D7 are each
pinned at the code site with a comment naming the decision, and each is pinned by a test I
independently proved can fail.

### Non-blocking notes
- `PipelineRunServiceSpec.scala` is now ~1124 lines (soft budget 250, informational). Pre-existing
  growth; a split by concern would help a future toucher.
- `seedDsImage` uses inline `java.io.File` / `javax.imageio.ImageIO` FQNs, mirroring the existing
  `PipelineRunRoutesSpec.seedDsImage`. Consistent with precedent; worth top-of-file imports if
  that helper is edited again.
- Carry design D5's two user-visible notes into the PR body: stored schemas only self-correct on
  the pipeline's next run, and a pending patch-set undo of a `dataType` edit may 409 once after it.
