## Context

See `proposal.md` for motivation. Three response shapes are already implemented and tested; only
their `schemas/**/*.schema.json` documentation is missing. `scripts/check-schema-drift.mjs`
matches each `.schema.json` file's `"title"` against a flat map of every `case class` parsed from
`backend/src/main/scala/com/helio/api/JsonProtocols.scala` and every file under
`backend/.../api/protocols/**`, field-for-field — polymorphic/union response types that have no
single matching case class are explicitly `SKIP`-listed (e.g. `"Panel"`, `"Dashboard"`).

## Goals / Non-Goals

**Goals:**
- Add the three missing schema files with accurate titles/shapes so `check:schemas` starts
  covering them.
- Keep the change zero-behavior: no route, case class, or persisted-data change.

**Non-Goals:**
- Rebuilding Output `config.format`'s original decimals/prefix/suffix/compact vocabulary — the
  shipped `MetricFormat` enum already satisfies this ticket's literal AC (see `ticket.md`).
- Extending decision-15 default-layout placement to non-Output panel kinds (form/text/markdown/
  image/divider) — out of decision-15's own scope per the epic design doc (`docs/superpowers/
  specs/2026-08-30-pipelines-outputs-remodel-design.md:164`); a different placement mechanism.
- Adding schema files for `PanelCapabilityColumnResponse`/`PanelCapabilityResponse`/
  `ShapeStepExpansionResponse` as their own top-level schema files — not requested by the ticket
  and not otherwise gapped; their shapes are inlined into the two schema files that need them
  instead (see Decision 3).

## Decisions

**Decision 1 — `data-source.schema.json` documents the `DataSourceResponse` union via `oneOf` +
SKIP, mirroring the `Panel` precedent.** `DataSourceResponse` is a sealed trait with 7 case-class
subtypes (`CsvSourceResponse`/`RestSourceResponse`/`SqlSourceResponse`/`StaticSourceResponse`/
`TextSourceResponse`/`PdfSourceResponse`/`ImageSourceResponse`), each with its own fields plus the
shared `inferredSchema: Vector[InferredFieldResponse]`. No single case class matches a "title" of
"DataSourceResponse", so — exactly like `"Panel"` (`SKIP`'s comment: "response composed across
PanelResponse and union variants") — add `"DataSourceResponse"` to `check-schema-drift.mjs`'s
`SKIP` set and hand-author the schema as `oneOf` over the 7 subtypes, each `required`-listing its
own fields including `inferredSchema`. Alternative considered: schema only the shared/common
fields (id, type, name, inferredSchema) as a loose base object with `additionalProperties: true` —
rejected because it would silently pass a response missing any subtype-specific required field,
weakening the drift check exactly where a real regression (e.g. dropping `inferredSchema` from one
subtype) would slip through.

**Decision 2 — `node-capabilities-response.schema.json`, not `output-capabilities-response.schema.json`.**
The ticket's own addendum named a file that doesn't match any real type; `GET /api/pipelines/:id/
capabilities?stepId=` returns `NodeCapabilitiesResponse` (`stepId: Option[String], columns:
Vector[PanelCapabilityColumnResponse], capabilities: Map[String, PanelCapabilityResponse]`). Title
the schema `NodeCapabilitiesResponse` (matches the real case class 1:1 — no `SKIP` needed) and
place it under `schemas/pipelines/` (the route lives in `PipelineRoutes.scala`, not an Output
route) rather than the ticket's guessed `schemas/outputs/`.

**Decision 3 — inline `PanelCapabilityColumnResponse`/`PanelCapabilityResponse`/
`ShapeStepExpansionResponse` shapes rather than adding them as their own referenced schema files.**
None of the three are separately gapped by the ticket, and `check-schema-drift.mjs` only validates
files that exist — inlining their `properties` directly into the two schemas that embed them
(`node-capabilities-response.schema.json`'s `columns`/`capabilities`,
`expand-pipeline-shape-response.schema.json`'s `steps`) documents the actual wire shape without
growing the change's footprint beyond what was asked. `PanelCapabilityResponse.eligibleColumns`
and `NodeCapabilitiesResponse.Capabilities`/`PanelCapabilityResponse` are type aliases
(`Map[String, ...]`) — modeled as `"type": "object", "additionalProperties": { ... }` per this
repo's existing convention for map-valued fields (see `output.schema.json`'s `config: { "type":
"object" }` for the analogous "opaque/keyed object" pattern).

**Decision 4 — `expand-pipeline-shape-response.schema.json` titled `ExpandPipelineShapeResponse`,
`outputs` modeled as an absent-optional key.** Matches the real case class 1:1. `outputs: Option[
JsArray]` (never populated today, per that class's own doc comment — forward-compatible only)
becomes a top-level `properties.outputs` with NO entry in `required`, per this protocol's
spray-json no-`NullOptions` convention (an absent Scala `None` serializes as a missing key, never
`null` — already called out in the ticket's own addendum 2 wording).

## Risks / Trade-offs

- [Risk] `check-schema-drift.mjs`'s case-class parser is not paren-balanced (its own header
  comment, HEL-873) — a nested nested generic in a nearby case class could still misparse
  unrelated to this change. → Mitigation: none of the three target case classes
  (`NodeCapabilitiesResponse`, `ExpandPipelineShapeResponse`) have a default-value-with-call-paren
  field; `DataSourceResponse` is `SKIP`-listed so never parsed at all. No new exposure.
- [Trade-off] Hand-authoring `oneOf` for a 7-variant union is more schema-file maintenance burden
  than a single flat object, but matches the existing `Panel` precedent rather than inventing a
  new convention.

## Planner Notes

- `skip_specs: true` self-approved (see `proposal.md`'s Capabilities section) — no capability
  spec's requirement-level behavior is changing; the openspec convention in this repo already
  keeps `schemas/**/*.schema.json` outside spec prose (no existing spec cross-references a schema
  path).
