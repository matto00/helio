## Context

See proposal.md (Why). Ground truth at a703ac564:

- `JsonSchemaValidation.compile` calls `JsonSchemaFactory.getInstance(V202012).getSchema(readTree(file))` — no URI
  mapping, so a `$ref` to `https://helio.local/...` is fetched over the network (`UnknownHostException`, HEL-1281).
- Both analyze schemas already declare `$id: https://helio.local/schemas/pipelines/<file>`; other schemas
  (`panels/panel.schema.json`) already use absolute `https://helio.local/schemas/...` cross-file refs.
- networknt 1.0.87's `JsonSchemaFactory.Builder` exposes `addUriTranslator(URITranslator)` /
  `addUriMappings(Map)`, and `URITranslator.prefix(from, to)` exists in the jar.
- Scala side: `PipelineAnalyzeProposalProtocol` reuses `AnalyzeStepResponse`/`analyzeStepResponseFormat`,
  `RootSourceSchemaResponse`, `SchemaFieldResponse` and the warning format verbatim from `PipelineAnalyzeProtocol`, so
  the two wire shapes are identical by construction — a cross-file `$ref` is semantically exact.
- Specs that compile these schemas and validate REAL route responses: `PipelineAnalyzeRoutesSpec` (705, 723),
  `PipelineAnalyzeProposalRoutesSpec` (683, task 3.11), `PipelineAnalyzeSchemaWarningsSpec` (222, 243),
  `PipelineAnalyzeCanRunRoutesSpec` (104). `PipelineAnalyzeRoutesSpec:214` compiles the concise schema (no shared defs).
- No frontend or helio-mcp code reads these two files (TS types are hand-written). `check-schema-drift.mjs` compares
  only each schema's top-level `properties` against the case class named by `title` and never follows `$ref`; the
  proposal schema's top-level properties do not change.

## Goals / Non-Goals

**Goals:** offline cross-file `$ref` resolution in the harness; zero duplicated analyze defs; a failable guard.
**Non-Goals:** editing `check-schema-drift.mjs` (concurrent HEL-1412); touching wire/protocol code; other schemas.

## Decisions

**D1 — Mapping in the harness, built once.** Build one factory with
`JsonSchemaFactory.builder(JsonSchemaFactory.getInstance(V202012)).addUriTranslator(URITranslator.prefix(
"https://helio.local/schemas/", <file URI of the located schemas/ dir with trailing slash>))` (or the equivalent
`addUriMappings`; executor verifies the exact 1.0.87 signature against the jar, not memory). The `schemas/` dir is
located by the existing upward walk. Compile with `getSchema(URI)` or `getSchema(JsonNode)` — whichever makes the
file's `$id` the base for resolution; executor proves which with a red/green probe. Every existing caller keeps
its signature. Alternative rejected: classpath copy of `schemas/` (adds a build step for a test-only need).

**D2 — Absolute refs.** The proposal schema references
`https://helio.local/schemas/pipelines/pipeline-analyze-response.schema.json#/$defs/<Name>`, matching
`panel.schema.json`'s existing style and independent of base-URI resolution quirks.

**D3 — Removal, not aliasing.** The proposal schema's `$defs` keep only `OutputAnalyze` (proposal-only). Its
`properties.sourceSchemas/steps/warnings.items` point cross-file directly; `AnalyzeProposalStep` is deleted. The
top-level `description` sentence justifying the local copy (HEL-1281) is rewritten to state the defs are shared by
cross-file `$ref`. No copy remains, so drift is impossible by construction; D5 guards against a copy returning.

**D4 — Resolve the existing drift toward the stricter side.** Add `"minLength": 1` to the canonical
`AnalyzeStep.properties.type`. The executor must first SHOW the drift (a proposal-shaped body with `"type": ""` is
rejected by the current proposal schema and accepted by the current response schema), and must cite the Scala source
proving `type` is always a non-empty op-kind string on the wire. `config.additionalProperties: true` vs absent is
semantically identical in 2020-12 and needs no change. The response schema's `AnalyzeWarning.stepId` description
already covers the proposal case.

**D5 — Guard spec** `backend/src/test/scala/com/helio/testsupport/AnalyzeSchemaSharedDefsSpec.scala` (test-only):
(a) the proposal schema's `$defs` key set is disjoint from the response schema's `$defs` key set (generic — catches
any future copy, not just the four names), and it declares no `AnalyzeProposalStep`; (b) both schemas compile
offline through the harness; (c) the cross-file refs are ENFORCED: a proposal response with an unknown warning
`code`, a step missing `outputSchema`, a step with `"type": ""`, and a `SchemaField` with an unknown `type` are each
rejected, while a well-formed body validates. (c) is what makes (b) non-vacuous — an unresolved ref that degraded to
`{}` would pass (b) but fail (c). (d) the `items.$ref` strings under `sourceSchemas`, `steps` and `warnings` equal the
exact absolute cross-file URIs (catches a RENAMED copy, which (a) cannot — the old copy was `AnalyzeProposalStep`).
The unknown-`SchemaField.type` negative runs under BOTH `sourceSchemas[].sourceSchema[]` and `steps[].inputSchema[]`,
proving the response file's internal `#/$defs/SchemaField` refs resolve against that file. The mapped factory is
built once (`private val`) in the harness.

## Risks / Trade-offs

- [networknt silently treats an unresolved ref as permissive] → D5(c) negative cases; mutation evidence required.
- [Mapping breaks other specs' schema compiles] → full `sbt testFull` run, not just analyze specs.
- [Tightening `AnalyzeStep.type`] → the wire never emits an empty kind (D4 citation); all four analyze specs re-run.

## Planner Notes

- Self-approved: D4 tightening direction (schema contract matches existing wire; no consumer change).
- Self-approved: `skip_specs: true` — no observable behavior change.
- Driver claims corrected at Setup: HEL-1414 never touched these schema files; `check:schemas` is
  `check-schema-drift.mjs` and does not follow `$ref`s; no frontend/MCP consumer reads these files.
