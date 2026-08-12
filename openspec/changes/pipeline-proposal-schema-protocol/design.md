## Context

`schemas/dashboard-proposal.schema.json` + `DashboardProposal`/`ProposalPanel` in
`backend/src/main/scala/com/helio/api/protocols/DashboardProposalProtocol.scala` already establish
the pattern this ticket brings to the data layer: an id-free wire shape, applied later by a
dedicated service. `ProposalPanel`'s `RootJsonFormat` is hand-written (not `jsonFormatN`) so the
writer can *omit* keys for absent `Option` fields instead of emitting `"field": null`, and the
reader tolerates any absent optional key. `PipelineProposalProtocol` mirrors that exact shape.

The step shape already exists verbatim: `CreatePipelineStepRequest(type: String, config: JsObject)`
in `PipelineStepProtocol.scala` is precisely `add_pipeline_step`'s `{type, config}` contract, with an
existing `RootJsonFormat` (`createPipelineStepRequestFormat`, `jsonFormat2`). `PipelineProposal.steps`
reuses it directly — no new step DTO.

The source side has no single existing "create" DTO to reuse wholesale: `SqlCreateSourceRequest`
wraps `SqlSourceConfigPayload`, `CreateSourceRequest` wraps `RestApiConfigPayload`, CSV creation is a
multipart file upload with no JSON request type (`CsvSourceConfigPayload(path)` only exists as a
*response* shape), and `StaticDataSourceRequest` carries `columns`/`rows` flat. The per-kind `config`
payload types are what's reusable, not the outer request wrappers.

## Goals / Non-Goals

**Goals:**
- Define `schemas/pipeline-proposal.schema.json` and a matching tolerant `PipelineProposal` Scala
  protocol: `pipelineName`, `source` (existing `sourceId` OR inline spec), `outputDataTypeName`,
  ordered `steps: [{type, config}]`.
- Reuse `CreatePipelineStepRequest` for steps and the existing per-kind config payloads
  (`CsvSourceConfigPayload`, `RestApiConfigPayload`, `SqlSourceConfigPayload`,
  `StaticColumnPayload`/rows) for the inline-source branch.
- Round-trip + absent-optional-tolerance test coverage, parity with `DashboardProposalProtocolSpec`.

**Non-Goals:**
- Applying the proposal (minting a source/pipeline/steps) — HEL-342 follow-on.
- Validating that exactly one of `sourceId` / inline fields is set, or that a step's `config` shape
  matches its `type` — both are apply/analyze-time concerns (ticket's own Out of Scope), not
  protocol-level concerns. The protocol only encodes/decodes; a proposal with `sourceId` **and** an
  inline `type` both set is representable but not semantically validated here.
- Any new route/service/repository. This ticket ships a schema file + case classes + a JSON format.

## Decisions

**D1 — `source` is one flat object with an optional `sourceId` and optional inline fields, not a
sealed-trait discriminated union.** `DataSourceResponse` uses a sealed-trait ADT keyed by `type`
because each subtype's *response* shape is genuinely different width (different field counts) and
the ADT needs to round-trip real persisted rows. A *proposal*'s source is closer to `ProposalPanel`:
one case class carrying every type's fields as `Option`s, only the relevant subset populated,
exactly the precedent HEL-293 set for panel-type-dependent fields (`content`/`url`/`orientation`/
`chartType` all coexist as options on one `ProposalPanel`). Mirroring that keeps `PipelineProposal`
consistent with the one proposal case class this codebase already has, instead of introducing a
second reuse pattern for a single ticket.

```scala
final case class PipelineProposalSource(
    sourceId: Option[String],                        // existing-source branch
    `type`: Option[String],                           // inline branch: csv|rest_api|sql|static
    name: Option[String],                              // inline branch: new source's name
    csvConfig: Option[CsvSourceConfigPayload],
    restConfig: Option[RestApiConfigPayload],
    sqlConfig: Option[SqlSourceConfigPayload],
    staticConfig: Option[StaticDataPayload]
)
```

**Wire key is `config`, singular — not four differently-named keys.** These four fields exist for
Scala-side type safety only (exactly one is `Some` at a time, selected by `type`). On the wire they
serialize through **one** JSON property named `"config"`, not through each field's own name — this
is what `tasks.md`/`spec.md` describe, and it matches the codebase's actual established convention
for "config shape varies by `type`": `CreatePipelineStepRequest.config: JsObject`,
`DataSourceResponse`'s per-subtype `config` field (`DataSourceProtocol.scala`, doc comment "Each
subtype emits its own typed `config` payload"), and `create-panel-request.schema.json`'s `if/then`-
on-`type` single `config` property. `ProposalPanel`'s several-differently-named-optional-fields
pattern does not apply here — those fields are genuinely distinct concepts
(`content`/`url`/`orientation`/`chartType`), not four typed variants of the same concept ("this
source kind's config"), so it is the wrong precedent to mirror for this field. Concretely: the
hand-written formatter's writer inspects `type` to pick which of the four `Option` fields is
populated and serializes *that one* to the `"config"` key (via its own existing
`RootJsonFormat[CsvSourceConfigPayload]` / etc., already in scope from `DataSourceProtocol`); the
reader inspects `type` to decide which of the four fields to populate by decoding the `"config"`
key against that type's format, leaving the other three `None`.

**D2 — Steps reuse `CreatePipelineStepRequest` verbatim, no new step DTO.** Its shape
(`type: String, config: JsObject`) already matches `add_pipeline_step`'s contract 1:1 and already has
a `RootJsonFormat`. `PipelineProposalProtocol` mixes in `PipelineStepProtocol` to inherit it rather
than re-declaring an equivalent format.

**D3 — `PipelineProposalSource.type`/step `type` are unconstrained strings in both the JSON Schema
and the Scala reader, not a hard-coded enum.** `PipelineStepKind.All` is already registry-derived
(`PipelineStep.Registry.keySet`) specifically so new ops don't require updating a manual allow-list
(see the comment on `PipelineStepKind.All`); `add_pipeline_step`'s own MCP input schema takes
`type: z.string()` for the same reason. Hard-coding the ticket's illustrative 10-op list
(rename/filter/.../aggregate) into the JSON Schema would immediately go stale against the other 12
already-shipped ops (datebucket/pivot/window/unpivot/dedupe/fillnull/stringops/union/lookup/
splittext/extractheadings/chunkbytokencount — see `PipelineStepKind`). The schema documents the
current op set in a `description` for readability; the backend registry stays authoritative.
Same reasoning for the inline source `type`: `csv|rest_api|sql|static` are enumerated (per the
ticket's explicit scope) since that 4-kind subset is a deliberate scope narrowing, not the full
`DataSourceKind.All` connector registry.

**D4 — CSV's inline branch is schema-shaped but not apply-time-meaningful yet.** `CsvSourceConfigPayload(path)` is the only reusable typed shape, but CSV creation is a multipart upload — a JSON
proposal cannot carry file bytes. This ticket still accepts `csvConfig` for schema/protocol
completeness (the ticket scope names CSV explicitly); how an apply path resolves a proposed CSV
source (e.g. a pre-staged upload id) is left to the HEL-342 apply-path ticket. Noted in Open
Questions, not blocking here since this ticket ships no apply path.

**D5 — Hand-written `RootJsonFormat`, not `jsonFormatN`.** Matches `DashboardProposalProtocol`'s
`proposalPanelFormat`: `.foreach` on write to omit absent-`Option` keys instead of emitting
`"field": null`, `.get(...).map(_.convertTo[X])` on read to tolerate missing keys, with
`deserializationError` on the two truly-required fields (`pipelineName`, `outputDataTypeName`). The
one deviation from a mechanical field-name-is-key mirror is `PipelineProposalSource`'s four
per-kind config fields, per D1 above: those four serialize through a single shared `"config"` key
(selected by `type`), not through four separate keys — everything else (`sourceId`, `type`, `name`,
and every `PipelineProposal`-level field) follows the ordinary one-field-one-key rule unchanged.

## Risks / Trade-offs

- [Un-enforced mutual exclusivity on `source`] A proposal with both `sourceId` and inline fields set
  is representable → apply-time (HEL-342) must pick a resolution order (e.g. `sourceId` wins) and
  document it; not this ticket's concern per its own Out of Scope.
- [Schema `type` fields left open, not enum-constrained] → loses JSON-Schema-level typo detection for
  step/source kind; matches the existing `add_pipeline_step` precedent (validated server-side against
  the registry) rather than a stricter-but-drift-prone enum.

## Migration Plan

Purely additive — new schema file, new protocol file, one new mixin on `JsonProtocols.scala`
(`with PipelineProposalProtocol`). No migration, no existing endpoint touched, nothing to roll back
beyond reverting the new files.

## Open Questions

- How an applied CSV inline source resolves actual file bytes (staged upload reference vs. some other
  mechanism) — deferred to the HEL-342 apply-path ticket; does not block this ticket's schema/protocol
  definition (D4).

## Planner Notes

Self-approved: capability name `pipeline-proposal-contract` (no existing `openspec/specs/` entry
collides); inline-source kind set narrowed to `csv|rest_api|sql|static` per the ticket's own Scope
text rather than the full `DataSourceKind.All` registry (text/pdf/image excluded — no ticket mention,
and no MCP `create_*_data_source` inline-config precedent needed for this contract yet).
