## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Re-read `proposal.md`, `design.md`, `specs/image-file-connector/spec.md`, `tasks.md`, and my own
  round-1 report (`skeptic-design-1.md`) fresh, treating round 1 as a claim to re-verify, not a
  fact.
- Confirmed no backend/frontend source has changed since round 1 (`git status --short` shows only
  the untracked `openspec/changes/image-connector/` dir; `git log` head is still HEL-215's merge) —
  I am judging the revised plan against the exact same ground truth round 1 used.

**1. Round-1 fix correctness (the blocking defect):**
- Re-read `backend/src/main/scala/com/helio/domain/PipelineRowJson.scala:26-37` verbatim. The
  current `anyToJsValue` match is `null | Boolean | Int | Long | Float | Double | BigDecimal |
  java.math.BigDecimal | String | catch-all(_.toString)`. None of these types overlap with `Map`,
  so inserting `case m: Map[String, Any] @unchecked => JsObject(m.map { case (k, v) => k ->
  anyToJsValue(v) })` immediately before the final catch-all introduces no ambiguity with any
  existing case — order relative to the scalar cases is irrelevant (disjoint types); order
  relative to the catch-all is correct and load-bearing (a `case _` earlier would shadow it).
- `x: Map[String, Any] @unchecked` is valid, idiomatic Scala for suppressing the unchecked-erasure
  warning on a generic type pattern (`Map`'s type parameters are erased at runtime, so the pattern
  actually matches any `Map`, which is fine here — this codebase never puts a `Map[K,V]` with
  non-`String` keys into a `Row`). I grepped for `@unchecked` elsewhere in the codebase (no prior
  usage) — it's a new-to-this-codebase idiom but standard, unremarkable Scala; not a concern.
- `design.md`'s Decisions section (new paragraph, "skeptic design-gate round 1, probe-confirmed")
  and `tasks.md` task **5.1a** both state the fix precisely, cite the exact file/line, explain the
  causal chain (corrupts `data_type_rows.data.content` while `binary_refs` extraction, reading
  pre-serialization `resultRows`, stays correct — the exact defect I found), and add a regression
  test requirement (task **7.3a**): unit-level (`anyToJsValue` nested-Map → real `JsObject`, plus
  scalar cases unchanged) and end-to-end (`PipelineRunService`/`DataTypeRowRepository`, asserting a
  real JSON object lands in `data_type_rows.data.content` and round-trips via
  `GET /api/types/:id/rows`). This satisfies the Debugging Iron Law (probe-confirmed root cause +
  a test that actually exercises the fixed path, not one that would pass either way).
- Task ordering note ("Must land before task 5.1/5.3 can be considered correct") is a dependency
  annotation, not an execution-order defect — 5.1a physically precedes 5.1's row-content usage
  being *correct*, but there's no requirement that checklist items execute in strict numeric order;
  an implementer doing 5.1 and 5.1a in the same pass (as intended) satisfies this fine.

**2. Full fresh pass over the rest of the design (not rubber-stamping):**
- `domain/DataSource.scala`: `TextSourceConfig(path: String, sourceUrl: Option[String])` confirmed
  at the file (grep) — `ImageSourceConfig`'s claimed 1:1 mirror is accurate.
- `services/ContentSourceSupport.scala`: confirmed `TextExtensions: Set[String] = Set("txt", "md")`
  (line 239) and `validateExtension`/`filenameFromUrl` exist exactly as claimed — the design's
  planned `ImageExtensions` addition follows the same shape with no changes to the guarded-fetch
  contract.
- `services/PipelineRunService.scala`: read `onRunSuccess` (lines 292-320) in full — confirmed
  `resultRows: Seq[Map[String, Any]]` (pre-JSON) is passed in alongside `jsRows: Vector[JsObject]`
  (already-serialized), validating the design's plan to extract `BinaryRef`s from `resultRows` (not
  `jsRows`) so the extraction is unaffected by the serialization gap either way. Confirmed the
  `anyToJsValue` call sites at lines 136, 158, and 264 (previewStep, status, executeRun) — exactly
  the three sites design.md claims share this helper.
- `domain/model.scala`: read `BinaryRef` case class (lines 348-358) — fields `storageKey: String,
  mimeType: String, filename: String, sizeBytes: Long` match the design's "4 required string/long
  keys" shape-scan description exactly.
- `infrastructure/BinaryRefRepository.scala`: confirmed `class BinaryRefRepository(ctx: DbContext)`
  and `def overwriteForDataType(dataTypeId: String, refs: Vector[BinaryRef])` — matches the design's
  `new BinaryRefRepository(dbContext)` / call-site claims exactly.
- **Investigated the round-1 Risk note's claim about `jsValueToAny` (the inverse direction) being
  safely out-of-scope** — this was the most important thing to re-verify, since it's exactly the
  kind of thing a design could hand-wave away. Read `ExpressionEvaluator.scala` in full (562
  lines). Found: `evalExpr`'s `FieldRef` case (lines 441-449) already converts *any* non-scalar
  `JsValue` field reference to `VStr(other.compactPrint)` **before** the result ever reaches
  `jsValueToAny` — i.e., if a `compute` step's expression references `$content` (an `ImageSource`
  row's nested `BinaryRef` map), the evaluator itself flattens it to a `VStr`, and
  `evaluate()`'s `valToJs` turns that into `JsString`, so `ComputeStep.apply`'s
  `PipelineRowJson.jsValueToAny(v)` call (`ComputeStep.scala:65`) receives a `JsString`, never a
  `JsObject`. This means `jsValueToAny`'s `case other => other.compactPrint` fallback is
  **already dead for this exact scenario** — genuinely not exercised, so leaving it unfixed
  introduces no second corruption bug for the `ComputeStep` path the design's Risk note names. The
  behavior is "surprising" (a stringified-JSON value lands in a new column) but that's pre-existing
  `ExpressionEvaluator` behavior for any non-scalar field reference, unrelated to this ticket, and
  non-corrupting (it degrades gracefully to a string, doesn't silently break serialization). The
  design's Risk framing is accurate, not a hand-wave.
- Checked `jsValueToAny`'s other call site (`PipelineRowJson.parseStaticRows`, static-source cell
  parsing) — static-source config cells are user-entered flat JSON values (columns/rows shape);
  not a path `ImageSource` rows ever flow through. No live nested-object risk there either.
- Checked `services/PipelineRunService.scala`'s `upsertFieldsFromRows`/`inferFieldType` (lines
  322-330) — confirmed it has no `Map` case and falls to `case _ => "string"` for a nested-Map
  `content` value, meaning the pipeline *output* DataType's auto-synced schema would say
  `content: string` even though the persisted row value (post round-1 fix) is a JSON object. This
  is exactly the gap `proposal.md`'s Non-Goals section calls out ("applies equally to `TextSource`
  today; not this ticket's regression to fix") — I traced it myself and the equivalence claim
  holds structurally (same code path, same missing case), though the manifestation is more visible
  for `BinaryRefType` (object) than `StringBodyType` (already a flat string, so the type-tag loss is
  more cosmetic there). This is a legitimate, correctly-scoped non-goal — schema-sync fidelity is a
  materially larger, pre-existing, source-kind-agnostic gap that doesn't belong in this ticket. Not
  blocking (see non-blocking note below).
- Re-confirmed nothing else drifted: `DataSourceRepository`'s 3 closed matches, `DataSourceService`
  method shapes, `ApiRoutes`'s `PipelineRunService` construction (still 9 positional args, no
  `BinaryRefRepository` constructed today), the `V47` migration precedent, and the frontend
  component names are all unchanged from round 1's verified state (confirmed via `git status`/
  `git log` showing zero source drift between rounds).

### Verdict: CONFIRM

Round 1's blocking defect is fixed correctly and completely: the `anyToJsValue` nested-`Map` case
is syntactically valid, correctly ordered, causally tied to a probe-confirmed root cause, and paired
with a regression test that actually exercises the fixed serialization path end-to-end. My
independent fresh pass over the rest of the design — including specifically hunting for a second
latent bug in the inverse direction (`jsValueToAny`) the design's own Risk note flagged as a
question mark — found the design's out-of-scope reasoning to be correct, not hand-waved: I traced
the exact code path (`ExpressionEvaluator.evalExpr`'s `FieldRef` case) that makes `jsValueToAny`'s
`JsObject` branch unreachable for the scenario in question. No other contradictions, ambiguities, or
missing contract updates found.

### Non-blocking notes

- `upsertFieldsFromRows`'s type-inference gap (re-syncs a pipeline output `DataType`'s schema from
  row values, losing `binary-ref`/`string-body` fidelity — see above) is correctly scoped as a
  pre-existing, non-goal issue, but its manifestation is worse for `BinaryRefType` (schema says
  `string`, data is an object) than for `StringBodyType` (schema says `string`, data already is a
  string). Worth a follow-up ticket once a second `BinaryRefType`-producing pipeline consumer
  exists, but not blocking here — fixing it is a schema-sync redesign well beyond this connector.
- Carried over from round 1 (still true, still non-blocking): `openspec/specs/data-source-persistence/spec.md`
  still documents `source_type` as `rest_api | csv | static | sql`, undocumented drift shared with
  HEL-215's `'text'` addition; this design doesn't fix it either, consistent with prior-art
  precedent.
