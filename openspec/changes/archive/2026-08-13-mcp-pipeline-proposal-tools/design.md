## Context

`helio-mcp/src/tools/proposal.ts` (`propose_dashboard`/`apply_proposal`) and `write.ts`'s pipeline
tools (`create_pipeline`/`add_pipeline_step`/`run_pipeline`/`create_bound_panel`) are the two existing
precedents. The backend side (all merged, unchanged by this ticket) exposes:

- `PipelineProposal` (HEL-379, `backend/.../protocols/PipelineProposalProtocol.scala`): wire shape
  `{ pipelineName, source: { sourceId?, type?, name?, config? }, outputDataTypeName, steps: [{type,
  config}] }`. **`source`'s wire shape has exactly ONE `config` key**, selected by `type` — the Scala
  side's four separate `Option` fields (`csvConfig`/`restConfig`/`sqlConfig`/`staticConfig`) are an
  internal Scala-side representation the hand-written `RootJsonFormat` collapses to/from that single
  key; they have no wire presence and nothing on the TS side needs to mirror them.
- `POST /api/pipelines/analyze-proposal` (HEL-381) → `PipelineAnalyzeProposalResponse { sourceName,
  outputDataTypeName, sourceSchema: SchemaFieldResponse[], steps: AnalyzeStepResponse[] }`. `steps`
  reuses the exact same `analyzeStepResponseFormat` as `GET /:id/analyze`, whose wire shape `types.ts`'s
  existing `PipelineAnalyzeResponse.steps` already models as a flat `{id, position, type, config,
  inputSchema, outputSchema, validationError}` — reused verbatim, no new per-step type needed.
- `POST /api/pipelines/apply-proposal` (HEL-383) → `PipelineProposalApplyResponse { source?, pipeline,
  outputDataTypeId, run }`, guardrails (SQL non-SELECT, inline-source name/config presence, source-fetch
  failure) all surfaced as ordinary non-2xx responses with a curated message — already exactly what
  `guarded`/`HelioApiError` (`proposal.ts`/`write.ts`'s shared helper) forwards verbatim today.

## Goals / Non-Goals

**Goals:**
- Three tools mirroring the `propose_dashboard` → `apply_proposal` review flow for pipelines.
- `propose_pipeline`'s returned `proposal` object is argument-compatible with both
  `analyze_pipeline_proposal` and `apply_pipeline_proposal` (same shape in, matching
  `propose_dashboard`'s `proposal` → `apply_proposal`'s arguments precedent).
- Zero backend changes; zero existing-tool signature changes.

**Non-Goals:**
- Re-validating anything the backend already guards (SQL read-only, inline name/config presence) — the
  tools pass those errors through verbatim via the existing `guarded` helper, never re-implement them.
- A closed enum of step `type`s or inline source `type`s beyond the schema's own 4-kind set — mirrors
  `add_pipeline_step`'s existing `type: z.string().min(1)` (HEL-379 design.md D3's own reasoning: the
  backend registry is authoritative, a client-side enum only goes stale).

## Decisions

**D1 — `source`'s zod schema mirrors the WIRE shape exactly (one `config` key), not the Scala-internal
four-`Option`-field shape.** `{ sourceId?: string, type?: "csv"|"rest_api"|"sql"|"static", name?:
string, config?: record }`. Building a `csvConfig`/`restConfig`/`sqlConfig`/`staticConfig`-shaped input
and flattening it before the request would be extra indirection with no behavioral difference — the
backend's hand-written reader only ever looks at `type` + the single `config` key.

**D2 — `type` keeps `csv` in the enum despite HEL-383 rejecting it at apply time.** The schema
(`schemas/pipeline-proposal.schema.json`) still permits it, and `propose_pipeline`/
`analyze_pipeline_proposal` are legitimately useful for a `csv`-sourced proposal a reviewer inspects
before manually creating that source and re-proposing with `sourceId` — narrowing the enum here would
make the tool a worse mirror of the actual contract. Both `propose_pipeline`'s and
`apply_pipeline_proposal`'s tool descriptions state the apply-time rejection explicitly (mirrors how
`create_sql_data_source`'s description already documents its own SQL-read-only guardrail), so an agent
sees it before hitting a 4xx.

**D3 — `steps` reuses `write.ts`'s existing `boundPipelineStepSchema`, hoisted to module scope and
exported, not a new zod object.** That schema (`{ type: z.string().min(1), config:
z.record(z.unknown()).default({}) }`) already matches `CreatePipelineStepRequest`'s wire shape exactly
(it is the DTO `create_bound_panel`'s `pipeline.steps` field uses today; `add_pipeline_step` inlines a
textually-equivalent but separately-declared flat shape, not this same object) — a second,
textually-identical object would drift silently. **Round-1 skeptic correction:** the declaration
currently sits at `write.ts:535-538`, *inside* `registerWriteTools`'s function body, where `export`
cannot legally apply to a function-local `const`. The actual mechanical step is: hoist `const
boundPipelineStepSchema = z.object({...})` out of `registerWriteTools` to module top-level scope as
`export const boundPipelineStepSchema = ...` — safe and behavior-preserving, since the declaration
closes over nothing (`server`/`api`/no other local is referenced inside it) — then import it from the
new `pipelineProposal.ts`, mirroring `write.ts`'s own existing import of `panelSchema` from
`proposal.ts` (cross-tool-file schema reuse is an established pattern here, not a new one).

**D4 — `propose_pipeline`'s warnings, computed in a new pure `pipelineProposalValidation.ts` (split
out for the same reason `proposalValidation.ts`/`metricSchemas.ts` document — importing a file with
`server.registerTool(...)` calls plus a full zod object type is TS2589 under this repo's tsconfig, so a
unit test must import only the pure function):**
1. Structural, no I/O (mirrors HEL-383 design.md D2's own guardrail, computed client-side so the agent
   sees it before an apply-time 400): if `source.type` is set, `source.name` must be non-blank and the
   `config` object must be present.
2. `sourceId` existence, one read-only fetch (mirrors `propose_dashboard`'s `dataTypesById` check):
   if `source.sourceId` is set, resolve it against `api.listDataSources()` and warn if not found.
3. Both `sourceId` and `type` set, or neither — warns (mirrors HEL-383's own D1 mutual-exclusivity
   guardrail; again computed client-side before an apply-time 400).
`applyReady` is `warnings.length === 0`, matching `propose_dashboard`'s exact convention.

**D4b — Round-1 skeptic finding: the ticket's own call-routing test requirement ("each tool calls the
right endpoint and surfaces errors") needs its own TS2589-safe extraction, distinct from D4's
warnings-only split.** `write.test.ts`/`proposal.test.ts` only ever unit-test pure, zod-free functions
(`buildUpdateMetricBody`/`computeProposalWarnings`) — there is no existing precedent in this codebase
for testing a registered tool's handler directly, and doing so would require importing
`pipelineProposal.ts`, which both calls `server.registerTool(...)` three times and imports
`boundPipelineStepSchema` from `write.ts`'s zod surface — exactly the combination `metricSchemas.ts`'s
docstring documents as TS2589-triggering, reproduced against `write.ts` unmodified. Resolution: extract
each tool's actual logic (no zod, no `registerTool`) into a third new file, `helio-mcp/src/tools/
pipelineProposalHandlers.ts`, exporting `proposePipelineHandler(api, input)`,
`analyzePipelineProposalHandler(api, proposal)`, `applyPipelineProposalHandler(api, proposal)` — each a
plain async function taking `HelioApi` (a zod-free interface, confirmed by reading `helioApi.ts`: no
zod import anywhere in that file) and plain TS-typed arguments, calling `computePipelineProposalWarnings`
(for `proposePipelineHandler`) and the `helioApi.ts` client methods directly. `pipelineProposal.ts`
becomes a thin shell: zod `inputSchema` declarations + `registerTool(...)` calls whose handlers are
`guarded(() => xHandler(api, ...))` one-liners, with no business logic of its own — a stricter version
of the same shell/logic split D4 already established for the warnings function, just applied to all
three tools' full bodies, not only the warnings computation. A test importing only
`pipelineProposalHandlers.ts` (never `pipelineProposal.ts`) exercises the actual `api.*` call-routing
and `HelioApiError` propagation with no TS2589 exposure.

**D5 — `analyze_pipeline_proposal`'s response type reuses the existing flat per-step shape.** Since
`PipelineAnalyzeProposalResponse.steps` on the wire is produced by the exact same
`analyzeStepResponseFormat` as `GET /:id/analyze` (which `types.ts`'s `PipelineAnalyzeResponse.steps`
already models), the new `PipelineAnalyzeProposalResponse` TS interface's `steps` field uses that same
inline per-step shape — no new type, no divergence risk.

**D6 — `apply_pipeline_proposal` is a pure pass-through, no client-side re-validation.** Every guardrail
(SQL read-only, inline name/config presence, source-fetch failure, mutual-exclusivity) already returns
a curated 4xx/5xx message server-side (HEL-383); `guarded`'s existing `HelioApiError` formatting
(`"<Name> (status <code>) for <url>: <message>"`) surfaces it verbatim, exactly like every other write
tool in this file. `propose_pipeline`'s D4 warnings are advisory/pre-flight only, never load-bearing —
an agent may call `apply_pipeline_proposal` directly without ever calling `propose_pipeline` first.

## Risks / Trade-offs

- [`propose_pipeline`'s D4 checks can drift from the backend's own guardrails if either changes later]
  → Both are small, explicitly cross-referenced by comment to HEL-383 design.md D1/D2 in the code, the
  same mitigation `computeProposalWarnings` already relies on for its own backend-mirroring checks.
- [Keeping `csv` in the `type` enum (D2) lets an agent draft an apply that will always 400] → Mitigated
  by explicit tool-description text, not a schema restriction; consistent with this codebase's existing
  preference for descriptive documentation over enum narrowing (HEL-379 design.md D3).

## Migration Plan

Purely additive: three new tools, one small hoist-and-export in an existing file (`write.ts`'s
`boundPipelineStepSchema` moved to module scope, per D3's correction), three new small TS files
(`pipelineProposalValidation.ts`, `pipelineProposalHandlers.ts`, `pipelineProposal.ts`), `helioApi.ts`
method additions, `types.ts` interface additions, one `index.ts` registration call added. No backend
changes, no existing tool's behavior changed (the hoist is behavior-preserving — `create_bound_panel`
references the same binding, just declared one scope higher). Rollback = revert the new files/exports
and the hoist.

## Open Questions

None blocking.

## Planner Notes

Self-approved: capability name `mcp-pipeline-proposal-tools`; new file names `pipelineProposal.ts`/
`pipelineProposalValidation.ts` (camelCase, matching this directory's existing `proposalValidation.ts`/
`metricSchemas.ts` convention, not `pipeline-proposal.ts` as the ticket's own alternate suggestion used
kebab-case inconsistently with the rest of the directory); D2's choice to keep `csv` in the enum rather
than narrow it (ticket doesn't call for narrowing, and narrowing would make the tool a weaker mirror of
the actual schema).
