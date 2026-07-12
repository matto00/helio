## Context

Pipeline steps are a per-file, registry-based ADT (`PipelineStep.scala`, CS2c-3a). Each of the 10
existing kinds is a self-contained file under `backend/src/main/scala/com/helio/domain/steps/`
owning its typed config, `evaluate`, and JSON codec, registered once in `PipelineStep.Registry`.
Content fields (`StringBodyType`, wire string `"string-body"`) were added in HEL-217 and are
produced today by the text/PDF/image connectors' fixed `content` field
(`ContentSourceSupport.metadataFields`). No existing op changes row *count* except `groupby` /
`aggregate` (many→fewer); this op is the first many→more (flatMap) transform.

HEL-219 is deliberately scoped as the **pattern-setter** for HEL-220/HEL-221: the seam below is
what those two tickets should reuse without re-deriving it.

## Goals / Non-Goals

**Goals:**
- Implement `splittext`: paragraph-break or heading-boundary split of a `string-body` field into
  N output rows, each carrying a sequence index.
- Apply/infer parity: `InProcessPipelineEngine` execution and `PipelineAnalyzeService` inference
  produce the same output-schema shape for the same config.
- Gate the op to `string-body` fields only, surfaced as an analyze-time `validationError` (not a
  hard 400) — consistent with how `compute` already surfaces expression errors.
- Establish the "text op" pattern doc (this section) for HEL-220/HEL-221 to mirror directly.

**Non-Goals:**
- Extract-headings and chunk-by-token-count behaviors (HEL-220/HEL-221).
- Changing `DataFieldType`/content connectors — this op only consumes `string-body`, it doesn't
  produce new field-type variants.
- Token-aware chunking or NLP-grade paragraph detection — paragraph mode is a simple
  blank-line split; heading mode is a simple `^#{1,N}\s` line match.

## Decisions

**1. Kind string `"splittext"`, one word, matches the existing `groupby` naming precedent** (not
`split-text` or `split_text` — no existing kind uses a separator). Registered in
`PipelineStepKind` / `PipelineStep.Registry` alongside the other 10.

**2. Config shape:**
```
SplitTextConfig(field: String, mode: String /* "paragraph" | "heading" */,
                headingLevel: Int = 1, indexField: String = "segmentIndex")
```
`headingLevel` is read but ignored when `mode == "paragraph"`. Decode follows the tolerant
`StepCodecUtil.asObject` + per-field default pattern every other step's `*Config.decode` uses
(missing keys → typed defaults, never a decode failure) — see `CastConfig.decode` / `GroupByConfig
.decode` for the precedent.

**3. Row semantics — flatMap, not map.** `evaluate`/`apply` iterates each input row; for a null or
missing `field` value, the row is **dropped** (zero output rows) rather than erroring, since a
null content field has no segments to emit (parity with `cast`'s "invalid → null" tolerance
philosophy: never throw for a data-shape edge case, just no-op on it). For a non-null value, split
it into segments (see decision 4), and emit one row per segment: all other input fields pass
through unchanged, `field` is replaced by the segment's text, and `indexField` is set to the
segment's 0-based position. If `indexField` collides with `field` or any other passthrough field
name, the index write happens last (same "last write wins" order as decision 5's schema-level
collision rule) — the numeric index always wins the slot, never the segment text. This is the
reusable "text op" row shape: **(passthrough fields) +
(replaced content field) + (index field)** — HEL-220/HEL-221 should emit the same 3-part shape
(headings: `field` replaced by extracted heading text; chunks: `field` replaced by chunk text),
changing only the split function itself.

**4. Split functions** (pure `Seq[String] => Seq[String]`, unit-testable in isolation):
- `paragraph`: normalize `\r\n`→`\n`, split on `\n\s*\n+` (one-or-more blank lines), trim each
  segment, drop empty segments.
- `heading`: split the content into sections at each line matching `^#{headingLevel}\s+`
  (exactly `headingLevel` `#` characters, Markdown ATX heading syntax); each section's text is
  everything from that heading line up to (not including) the next heading line at the same
  level; content before the first matching heading (if any) is dropped (no "preamble" row) to
  keep the op's output unambiguous — a differently-scoped op could change this later, but scope
  creep here is explicitly out.

**5. Schema inference — mirrors `inferCompute`'s validate-then-shape pattern.** `inferSplitText`
looks up `field` in `inputSchema`: if absent, `validationError = Some("Unknown field '<field>'")`
and the schema passes through unchanged (identity fallback, matching every other op's error
branch). If present but not `string-body` (compare `SchemaField.type` string, not a live
`DataFieldType` lookup — the analyze layer works entirely in wire-string types, see `SchemaField`),
`validationError = Some("Field '<field>' is not a content field (string-body); splittext requires
a string-body field")`, schema also passes through unchanged. On success, the output schema is the
input schema with `indexField` appended as `"integer"` (or replacing an existing field of the same
name — same "last write wins" semantics `compute` already has for a column name collision).

**6. Frontend gating happens in the step-config field picker, not the OP_TYPES list.** Unlike
`join` (fully hidden from `OP_TYPES` pending HEL-278), `splittext` stays visible in the picker
always — the ticket's "input applicability" requirement is about narrowing the *field choice*
inside the step body, not hiding the op itself (a user should be able to add the step and then see
which fields qualify). `SplitTextConfig` receives `analyzeSchema: SchemaField[]` (like `FilterConfig`
/ `AggregateConfig` already do) and filters to `f.type === "string-body"` for its field dropdown —
if none qualify, render the dropdown empty with a short inline hint, no special-cased banner.

**7. Migration — extend, don't replace, the `pipeline_steps_op_check` constraint** per the
established `DROP CONSTRAINT IF EXISTS` / `ADD CONSTRAINT` pattern (`V31__add_aggregate_op.sql` is
the template). New file `V50__add_splittext_op.sql`, listing all 11 kinds.

**8. All 8 enumeration sites must be updated** (`PipelineStep.scala`'s own doc comment underclaims
this as "four" — cycle 3's actual match sites, confirmed by reading each file, are: `Registry`,
`PipelineStepResponse.fromDomain` + the response read/write union (`PipelineStepProtocol.scala`,
2 matches), `PipelineStepConfigCodec.extractConfig` + `.encodeConfig` (2 matches),
`PipelineStepRepository.rowToDomain`, and the `PipelineStepSpec` exhaustiveness test).

**Correction (cycle 2, post-evaluation):** the above list missed a genuine 8th (7th distinct)
site: `PipelineProtocol.scala`'s separate `AnalyzeStepResponse` sealed-trait ADT (its own
per-subtype case class + `jsonFormat6` instance + both write/read match arms in
`analyzeStepResponseFormat`) plus `PipelineService.toAnalyzeStepResponse`'s dispatch match — this
is the wire path for `GET /api/pipelines/:id/analyze`, entirely separate from the CRUD
`PipelineStepResponse`/`PipelineStepProtocol.scala` ADT enumerated above. Cycle 1 shipped without
this site wired, causing analyze to 500 for any pipeline with a `splittext` step (caught in
evaluation-1.md, fixed in cycle 2). HEL-220/HEL-221 **must** also update this site — it is not
covered by, or implied by, any of the other 7.

**Correction (design-gate round 1):** none of these fail at *compile* time. `PipelineStep` is
explicitly documented as **not** `sealed` (see its own doc comment), so the `fromDomain` /
`extractConfig` / `rowToDomain` matches over `PipelineStep` get no exhaustiveness check at all; the
`rowToDomain`/`encodeConfig` matches are additionally over `Any`, never exhaustiveness-checked
regardless of sealedness; and even the truly sealed unions (`PipelineStepResponse`'s read/write
format and `AnalyzeStepResponse`'s read/write format) would at most warn, not fail —
`backend/build.sbt` sets no `scalacOptions` (no `-Xfatal-warnings`/`-Werror`). **Every one of the 8
sites therefore fails silently at compile time and only surfaces as a runtime
`MatchError`/`IllegalStateException` if a test happens to exercise that exact site with a
`SplitTextStep`/`SplitTextConfig` value.** The only non-test-gated site is the Flyway CHECK
constraint, which fails at migration-apply time regardless. This makes the test-coverage tasks in
tasks.md §3 load-bearing, not optional — see decision 9. `PipelineAnalyzeRoutesSpec.scala`'s
route-level `/analyze` test (added cycle 2) is the specific regression test that would have caught
this gap; HEL-220/HEL-221 should extend it alongside the four hand-curated lists and the
`PipelineStepRoutesSpec` CRUD-route test.

**9. Test coverage is the only safety net (no compiler exhaustiveness to rely on) — four existing
hand-curated per-kind lists must each gain a `splittext`/`SplitTextConfig` entry, on top of new
`splittext`-specific tests:**
- `PipelineStepSpec.scala`'s `allSubtypes` + `PipelineStepKind.All` assertions (exercises Registry
  + the `kind` accessor).
- `PipelineStepConfigCodecSpec.scala`'s `cases: Seq[(String, Any)]` round-trip list (exercises
  `extractConfig`/`encodeConfig`).
- `PipelineStepProtocolSpec.scala`'s `subtypes: Seq[PipelineStepResponse]` list (exercises
  `fromDomain` + the write/read union).
- `InProcessPipelineEngineSpec.scala`'s `makeStep(op, config)` helper match (exercises
  `rowToDomain`-equivalent construction feeding the full engine-execution round trip via
  `PipelineStepConfigCodec.decode`).

Additionally, `PipelineStepRoutesSpec.scala` gets a new dedicated route-level test — mirroring the
existing `"POST with type 'aggregate' is accepted (regression: AllowedOps drift)"` test — since a
route-level round trip is the single test most likely to catch any missed arm across the whole
request→repository→response path in one shot, and the change's own spec delta
(`pipeline-steps-persistence`) explicitly requires this scenario.

**(cycle 2 addendum)** `PipelineAnalyzeRoutesSpec.scala` also needs its own dedicated route-level
`splittext` scenario (added cycle 2) — it exercises the separate `AnalyzeStepResponse` wire path
(decision 8's 8th site) end-to-end via `GET /api/pipelines/:id/analyze`, which
`PipelineStepRoutesSpec.scala`'s CRUD-only test does not reach. This is now a required site for
HEL-220/HEL-221 to replicate, on top of the four hand-curated lists and the CRUD route test.

**10. Test-file precedent for HEL-220/HEL-221: no per-step spec files exist today** (`CastStep`/
`GroupByStep` have no `CastStepSpec.scala`/`GroupByStepSpec.scala` — their behavior lives inside
`InProcessPipelineEngineSpec.scala`'s shared `makeStep` + row-fixture tests). This change
establishes a **new, standalone `SplitTextStepSpec.scala`** for the split-function unit tests
(paragraph/heading splitting is intricate enough to warrant isolated, non-engine-wired tests) —
*in addition to* extending `InProcessPipelineEngineSpec.scala`'s `makeStep` helper so `splittext`
also gets full-engine-round-trip coverage alongside the other 10 kinds. HEL-220/HEL-221 should
follow this same two-tier shape: a standalone `<Kind>StepSpec.scala` for the op's own logic, plus
one `makeStep` arm + a couple of engine-level scenarios for round-trip coverage.

## Risks / Trade-offs

- [Heading-mode ambiguity for content with no heading of the target level] → Falls back to zero
  output rows for that input row (same null-handling path as decision 3) rather than one big
  "whole doc" segment — documented in the spec so HEL-220 doesn't need to re-derive this.
- [`indexField` name collision with an existing column] → Explicitly "last write wins" (decision
  5), consistent with `compute`'s existing collision behavior; not a new risk class.
- [Frontend shows the op even when the pipeline has zero string-body fields] → Acceptable: the
  field dropdown is simply empty, and analyze-time `validationError` still guards the DB config.

## Planner Notes

- Self-approved: kind string `"splittext"` (no existing separator convention to defer to) and the
  paragraph/heading split precision level (decision 4) — both narrow, reversible implementation
  choices within the ticket's explicit scope, not architectural or breaking changes.
- Self-approved: dropping unmatched/preamble content rather than erroring (decisions 3/4) — matches
  the codebase's existing philosophy (`cast`'s null-on-failure) of tolerant, non-throwing row
  transforms.
