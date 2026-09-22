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

## Gate-Chain Implications Checklist

This change modifies `scripts/check-schema-drift.mjs`, which `.husky/pre-commit` invokes via
`npm run check:schemas` — a commit-gate-chain-touching diff per CON-132's classification, so this
checklist is answered even though the actual edit is a 2-line, purely additive `SKIP`-set entry.

**What does it execute?** A pure Node.js script (`node scripts/check-schema-drift.mjs`, no shell
wrapper) that reads every `*.schema.json` file under `schemas/`, every `.scala` file under
`backend/src/main/scala/com/helio/api/protocols/**` plus the `JsonProtocols.scala` aggregator, and
a handful of other named source files (`domain/model/model.scala`,
`DashboardProposalService.scala`, `helio-mcp/src/tools/proposal*.ts`,
`ProposalReview.tsx`) via `readFileSync`, parses `case class` declarations with a regex, and
`console.error`/`process.exit(1)`s on drift. It never shells out, never uses `child_process`,
never imports a git library.

**What environment does it inherit, and from where?** Whatever environment the invoking shell
(Husky's pre-commit hook, or a bare `node` invocation) already has — the script reads no env vars
itself (confirmed: no `process.env` reference anywhere in the file) and needs none; its only
inputs are the file paths it resolves relative to its own `import.meta.url`.

**Does it write anything outside its own sandbox?** No. The script contains zero filesystem write
calls (`writeFileSync`, `appendFileSync`, `mkdirSync`, etc. — none present) and zero git
invocations of any kind (no `execSync`/`spawn`/`child_process` import at all). It is read-only by
construction: every `errors.push`/`checked.push` mutates only in-memory arrays used for its own
console output.

**Does it behave differently from a linked worktree than from a main checkout?** No — every path
it reads is resolved via `join(dirname(fileURLToPath(import.meta.url)), ...)`, i.e. relative to
the script's own location on disk, never via any git-dir/work-tree distinction. A linked worktree
and a main checkout both present the same file layout at that relative path, so this script's
behavior is identical in either.

**What happens on its first run?** Nothing special — there is no state, cache, or lockfile this
script creates or depends on existing. The very first invocation (e.g. right after this ticket's
own `SKIP`-list edit lands) behaves identically to the 1000th: it reads the current file set fresh
each time and reports drift or exits 0. The change made here (`SKIP.add("DataSourceResponse")`)
is exercised by the isolation-test run below, which confirms the script still exits 0 against a
disposable fixture with no observable difference from before the edit.

## Planner Notes

- `skip_specs: true` self-approved (see `proposal.md`'s Capabilities section) — no capability
  spec's requirement-level behavior is changing; the openspec convention in this repo already
  keeps `schemas/**/*.schema.json` outside spec prose (no existing spec cross-references a schema
  path).
