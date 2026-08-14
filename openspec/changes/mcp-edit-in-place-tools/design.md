## Context

`helio-mcp/src/tools/write.ts` registers ~15 thin create/delete tools (`create_pipeline`,
`add_pipeline_step`, `update_panel_appearance`, `update_metric`, `delete_*`), each a direct
pass-through to a `HelioApi` method (`helio-mcp/src/helioApi.ts`), which itself is a direct call
to an existing backend endpoint via `this.http.{get,post,patch,delete}`. "No business logic lives
here — the backend owns validation" (`write.ts`'s own top comment). This ticket adds the missing
`update_*` PATCH wrappers for data source / DataType / pipeline / pipeline step, following that
exact established pattern.

Ground truth for each backend PATCH, read directly from source (not assumed from the ticket's own
scope table, which is imprecise for two of the four — see Decisions):

- `PATCH /api/data-sources/:id` → `UpdateDataSourceRequest(name: Option[String])` — rename only.
- `PATCH /api/types/:id` → `UpdateDataTypeRequest(name, fields, computedFields: Option[...])` —
  `DataTypeService.applyUpdate` replaces `fields`/`computedFields` wholesale when provided
  (`.getOrElse(existing.X)` — no per-item merge).
- `PATCH /api/pipelines/:id` → `UpdatePipelineRequest(name: String)` — rename only, **required**
  (not `Option`).
- `PATCH /api/pipeline-steps/:id` → `UpdatePipelineStepRequest(type: Option[String], config:
  Option[JsObject], position: Option[Int])` — `PipelineService.updateStep` 400s if `type` is
  provided and differs from the step's existing kind ("Delete the step and create a new one
  instead"); a matching `type` is accepted but does nothing. `config`, when provided, is decoded
  against the EXISTING step's own kind via `PipelineStepConfigCodec` (backend-validated, same as
  `add_pipeline_step`).

## Goals / Non-Goals

**Goals:** four MCP tools that let an agent revise an existing resource without delete+recreate,
matching the write-tool conventions already established in this file.

**Non-Goals:** adding new backend PATCH fields (e.g. data-source config beyond name); changing a
pipeline step's type; `update_panel` beyond appearance (HEL-627, next in the epic's delivery
order); any of the ticket's own listed out-of-scope MCP↔API gaps.

## Decisions

**D1 — `update_data_source` and `update_pipeline` are rename-only tools, not partial "edit
config."** The ticket's own scope table describes both as "rename / edit … config in place," but
`UpdateDataSourceRequest`/`UpdatePipelineRequest` (read directly, see Context) expose no other
mutable field — there is no backend PATCH surface for data-source connection config or pipeline
metadata beyond name. Self-approved scope clarification, not a reduction: the tool wraps exactly
what the endpoint supports, same as every other tool in this file. `update_pipeline`'s `name` is
required (mirrors the backend's required, non-`Option` field); `update_data_source`'s `name` is
required at the MCP layer too — the backend's `Option` allows an all-omitted no-op PATCH, but
there is nothing else to patch, so requiring it avoids a pointless call.

**D2 — `update_pipeline_step` omits `type` from its input schema entirely.** Exposing it would
either always be redundant (matching type, no-op) or always fail (mismatched type, 400 telling
the caller to delete+recreate) — there is no successful, meaningful use of this field from the MCP
layer. The tool takes `stepId`, `config` (optional, `z.record(z.unknown())` — same loose/
backend-validated typing as `add_pipeline_step`), and `position` (optional `z.number().int()`) —
both independently omittable, matching the backend's own `Option` fields.

**D3 — `update_data_type`/`update_pipeline_step` follow the `update_metric`/`buildUpdateMetricBody`
precedent exactly: small, named, exported builder functions in a new sibling module, not inline
construction.** (Revised at design-gate round 1 — see Planner Notes.) `write.test.ts`'s own header
comment states why `buildUpdateMetricBody` lives in its own module (`metricSchemas.ts`) rather than
`write.ts` itself: `write.ts`'s full ~20-tool Zod surface is "pathologically expensive to
type-check" under this repo's tsconfig/ts-jest combination, so its partial-body-construction logic
is tested by importing the narrow module directly. There is no precedent anywhere in this codebase
for unit-testing logic embedded inline inside a `registerTool` closure. This ticket adds a new
sibling module, `helio-mcp/src/tools/updateSchemas.ts` (mirroring `metricSchemas.ts`), holding: the
`DataFieldPayload`/`ComputedFieldPayload` zod schemas (used by DataType's builder), and two
exported builder functions — `buildUpdateDataTypeBody` (name/fields/computedFields, `!== undefined`
per key) and `buildUpdatePipelineStepBody` (config/position, `!== undefined` per key, `type` never
constructed). Both independently unit-testable the same way `buildUpdateMetricBody` already is.

**D4 — one new capability spec (`mcp-edit-in-place-tools`), not folded into
`mcp-data-source-tools`.** No existing spec covers `write.ts`'s core CRUD tools (`create_pipeline`,
`add_pipeline_step`, `update_panel_appearance` have no capability spec at all — this whole area
predates/wasn't captured by openspec adoption). The four new tools are a cohesive, ticket-scoped
bundle ("edit-in-place PATCH tools"); `mcp-data-source-tools` is themed around *creating* sources
(csv/rest/sql), not editing, so folding `update_data_source` in there alone (and stranding the
other three) would split one cohesive change across mismatched capability boundaries.

**D5 — `update_pipeline_step`'s config-edit AC satisfies the "pipeline-op wiring / apply-infer
parity" convention trivially, because no new op/step-type is introduced.** That convention
(tracked informally per the pipeline-op-wiring memory note) governs adding a *new* transform-step
type (apply + infer parity, `allowedOps`, `StepCard`, etc.). This ticket adds no new step type and
makes no backend change at all — `update_pipeline_step`'s `config` is decoded via the EXISTING,
unmodified `PipelineStepConfigCodec.decode(existing.kind, ...)` path (`PipelineService.scala:559`)
— the exact same validation `add_pipeline_step` already goes through for a newly-added step. There
is nothing new for that convention to apply to.

## Risks / Trade-offs

- [Risk] An agent might expect `update_data_type`'s `fields`/`computedFields` to per-item merge
  (matching `update_panel_appearance`'s partial-merge precedent) → Mitigation: tool description
  states the wholesale-replace semantics explicitly, matching this file's existing convention of
  documenting exact merge behavior per tool (see `update_panel_appearance`'s own description).
- [Risk] `update_pipeline_step`'s `config` accepts `z.record(z.unknown())`, so a malformed config
  only fails backend-side → Mitigation: identical to `add_pipeline_step`'s existing, accepted
  trade-off; the backend's `PipelineStepConfigCodec` error is surfaced verbatim via `guarded`.

## Planner Notes

D1/D2/D4 are self-approved scope/structure clarifications grounded in the real backend contract,
not the ticket's own looser prose — flagged here per this ticket's own convention (see e.g. the
HEL-401 design.md precedent) rather than silently narrowed.

D3 was revised at design-gate round 1 (`skeptic-design-1.md` REFUTE): the original version rejected
a body-builder for `update_data_type`/`update_pipeline_step` as "disproportionate for 3 fields,"
which directly contradicted tasks.md 4.1/4.2's requirement to unit-test those builders "mirroring
`buildUpdateMetricBody`'s coverage style" — no such test is achievable without an extracted,
importable function, per `write.test.ts`'s own stated reason for `metricSchemas.ts`'s existence.
Retracted in favor of following that same precedent exactly (option (a) from the skeptic's report).
D5 is new at this round, closing the round's second (minor) finding — the AC's convention-parity
language was previously unaddressed anywhere in this plan.
