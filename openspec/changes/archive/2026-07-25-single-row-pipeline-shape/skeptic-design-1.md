## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- **Read all planning artifacts**: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/pipeline-shape-registry/spec.md` (delta) in full.

- **HEL-391 contract compliance (point 1)**: Read the merged
  `backend/src/main/scala/com/helio/domain/shapes/{PipelineShape,PassthroughShape,ShapeStepExpansion,
  ShapeParamDescriptor,OutputContract}.scala` directly.
  - `ShapeStepExpansion(kind: String, config: JsObject)` — confirmed positional mirror of
    `CreatePipelineStepRequest`, domain-layer, no `api.protocols` import in any `domain/shapes/*.scala`
    file (grepped).
  - `PipelineShape.outputContract` is declared once on the trait (`def outputContract: OutputContract`,
    not a function of `params`) — design.md Decision 4's "declared once, not per-call" premise is
    accurate.
  - `paramsSchema: Vector[ShapeParamDescriptor]` — confirmed descriptive-only (name/label/dataType/
    required/description), no validation logic attached; matches design's claim.
  - Design does not redesign any of this — it only adds a new `PipelineShape` object and one
    `Registry` line, exactly the extension point HEL-391 built for.

- **RowCountContract sealing claim (Decision 6)**: Read `OutputContract.scala` directly —
  line 17 is `sealed trait RowCountContract`, while the doc comment (lines 5-9) says "A small,
  non-`sealed` closed set...". The design's claim ("already sealed in the merged code; only the doc
  comment is stale") is **verified true** — confirmed by reading the file, not assumed. (Minor
  citation nit: design.md says "lines 6-7" for the stale phrase; it's actually within lines 5-9,
  with "non-`sealed`" specifically on line 6 — doesn't affect the substance of the claim.)

- **Aggregation/FilterCondition reuse (point 3)**: Read
  `backend/src/main/scala/com/helio/domain/steps/AggregateStep.scala` and `FilterStep.scala` directly.
  - `Aggregation(alias: String, fn: String, field: String)` with `jsonFormat3` (name-based, not
    positional, on the wire) — matches the ticket's `{fn, field, alias}` measure shape regardless of
    declared field order.
  - `FilterCondition(field: String, operator: String, value: Option[String])` — matches the ticket's
    `{field, operator, value}` condition shape exactly.
  - Confirmed "empty `groupBy` collapses all rows into a single group" (`AggregateStep`'s scaladoc and
    its `rows.groupBy(...)` implementation) — validates the aggregate-mode approach.
  - `LimitStep`/`LimitConfig(count=1)` → `rows.take(1)` when `count > 0` — validates filter-mode's
    `filter` + `limit 1` approach and the `limit 1` must-follow-`filter` ordering the spec tests for.

- **Validation-decision soundness (point 4)**: Read the actual runtime behavior being guarded against.
  - `AggregateStep.apply`'s `fn` match throws `IllegalArgumentException` on an unrecognized function
    (uncaught) — confirms design's claim.
  - `FilterStep.evalCondition`'s `case _ => false` for an unrecognized `operator` silently excludes all
    rows (zero-row, not error) — confirms design's claim. `FilterConfig`'s combinator handling
    (`case "OR" => ...; case _ => AND`) also silently defaults on bad input — confirms the design's
    combinator-validation rationale (stricter than the step's own runtime tolerance, which is the
    correct call for a shape whose contract promises one row).

- **`fields = Vector.empty` justification (point 5)**: Traced against the HEL-391 constraint verified
  above (`outputContract` is a `def`, not parameterized by `params`) — leaving `fields` empty is the
  only structurally possible choice without redesigning the trait (out of this ticket's scope per the
  ticket's own framing). AC1's literal checklist text ("output contract (exactly one row)") is
  satisfied; the Scope-section prose ("...with the declared measure columns") is not fully satisfied,
  but design.md's Decision 4 and Non-Goals explicitly document this as a known, accepted gap rather
  than a silent one — a defensible reading given the binding HEL-391 constraint and that panel/field
  binding is explicitly out of scope for this ticket (sibling tickets).

- **No migration / no wire-shape change (point 6)**: `ls backend/src/main/resources/db/migration/`
  confirms latest is `V72__add_lookup_op.sql` (matches ticket's stated baseline) — no new migration
  file in the change dir, consistent with a code-level registry (mirrors `ConnectorRegistry`, no DB).
  Read `schemas/pipeline-shape-catalog.schema.json` directly — `rowCount.kind` enum already includes
  `"exactly-one"`, and `outputContract.fields` is a generic array with no `minItems`/emptiness
  constraint — confirmed no schema change is needed for either a non-`Unbounded` rowCount or a
  populated/empty `fields` array. Read `PipelineShapeService.scala` — `catalog()` iterates
  `PipelineShape.Registry.values`, so a `Registry` line is sufficient for `SingleRowShape` to appear
  in `GET /api/pipeline-shapes`; no route/service code change needed, matching design's Impact section.

- **Tasks completeness/ordering (point 7)**: Cross-checked each of design.md's 6 Decisions against
  `tasks.md` — all six map to a concrete task (1.1/1.2 → Decision 1; 1.2/1.3/1.4 → Decision 2; 1.2 →
  Decision 3; 1.5 → Decision 4; 2.3 → Decision 5; 1.7 → Decision 6). Code tasks precede test tasks;
  `2.5` (full `sbt test` + no-migration confirmation) is last. Read the precedent files the tasks
  point at (`PassthroughShapeSpec.scala`, `InProcessPipelineEngineSpec.scala`'s `makeStep`/`run`
  helpers, `ConnectorRegistrySpec.scala`) — all exist and match the patterns the tasks describe as
  mirrors, so the task breakdown is executable, not hand-wavy.

### Verdict: CONFIRM

### Non-blocking notes

1. Design.md Decision 6 cites "lines 6-7" for the stale doc comment; the actual comment spans lines
   5-9 (with "non-`sealed`" on line 6). Trivial — doesn't change the substance of the verified claim,
   but worth a quick correction for the eventual doc-comment fix (task 1.7) to target the right span.

2. The Risks section names only the filter-mode zero-match case ("conditions match zero source rows")
   as a way `ExactlyOne` can be violated in practice. The same failure mode also applies to
   aggregate-mode over a zero-row source (`AggregateStep`'s `rows.groupBy(...)` on an empty input
   yields zero groups → zero output rows, not one) — this isn't called out explicitly, though it's
   already covered by the blanket mitigation ("no existing mechanism enforces post-execution row-count
   contracts... out of scope"). Consider adding one sentence naming this case too, for completeness.

3. Decision 2 says params are "decoded by hand" while also "reusing `Aggregation`/`FilterCondition`'s
   existing `RootJsonFormat`s... for decode" — worth an explicit implementation note that
   `.convertTo[Aggregation]`/`.convertTo[FilterCondition]` calls on individual array items should be
   `Try`-wrapped (mirroring `AggregateConfig.decode`'s own `items.flatMap(it =>
   Try(it.convertTo[Aggregation]).toOption)` pattern in the same codebase) rather than called bare, so
   a malformed-JSON-type measure/condition (e.g. `fn` as a `JsNumber`) returns `Left` instead of
   throwing an uncaught `DeserializationException` — `PipelineShape.expand`'s trait doc explicitly
   promises "rather than throwing." None of the ticket's listed test scenarios (unsupported `fn`,
   duplicate aliases, unsupported `operator`, invalid `combinator`, missing/empty arrays) exercise this
   specific malformed-type case, so it's easy to miss in review. Low severity since `expand` isn't
   wired to any HTTP path in this ticket's scope (panel/editor wiring is a sibling ticket), but worth
   getting right now given the precedent is one file away.
