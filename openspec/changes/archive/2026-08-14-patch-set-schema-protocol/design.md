## Context

Two existing precedents shape this design, both read directly from source before deciding:

- `PipelineProposalProtocol` (`backend/src/main/scala/com/helio/api/protocols/PipelineProposalProtocol.scala`,
  HEL-379): `PipelineProposalSource` carries FOUR per-inline-kind `Option` config fields
  (`csvConfig`/`restConfig`/`sqlConfig`/`staticConfig`), all of which serialize through ONE shared
  wire key (`"config"`), selected on write by whichever is populated and on read by dispatching on
  the sibling `type` field. `PipelineProposal.steps: Vector[CreatePipelineStepRequest]` reuses an
  existing case class VERBATIM rather than inventing a new step DTO (that file's own design.md D2).
- `UpdatePanelRequest` (`PanelProtocol.scala:70-75,177-200`): `config`/`appearance` are raw
  `JsValue`, decoded downstream (by `PanelConfigCodec`/`PanelAppearance`) against a discriminator
  resolved elsewhere (the panel's *stored* kind) — the format itself does zero per-kind typing.

`patch-set.schema.json`'s `Edit.patch` field needs exactly the first pattern for `op: update`
(six existing, already-formatted `Update*Request` case classes, a small closed set, this ticket's
tested focus) and exactly the second pattern for `op: create` (patch shape varies over six
heterogeneous `Create*Request` shapes — `CreateSourceRequest` alone is itself a 4-way discriminated
union — full typing here is real, unscoped work belonging to the apply-path ticket, HEL-406, not
this one).

Every one of the six `Update*Request` formats already exists, already tested, already used by a
real endpoint (`PanelProtocol.updatePanelRequestFormat`, `DashboardProtocol.updateDashboardRequestFormat`,
`DataSourceProtocol.updateDataSourceRequestFormat`, `DataTypeProtocol.updateDataTypeRequestFormat`,
`PipelineProtocol.updatePipelineRequestFormat`, `PipelineStepProtocol.updatePipelineStepRequestFormat`)
— confirmed none of them enforces "at least one field present" at the format layer (that lives in
`PanelServiceHelpers.resolvePatch`, a service-layer concern this ticket does not touch), so
reusing them here adds no surprise validation.

`check-schema-drift.mjs` only diffs a schema FILE's own top-level `title` against a matching case
class — it never recurses into `$defs`. `PipelineProposalSource`/`ProposalPanel` are both `$defs`
inside their parent's one schema file for exactly this reason: their wire shape (collapsed through
a shared key) doesn't match their Scala shape (multiple `Option` fields) 1:1, and nesting them
inside `$defs` keeps that mismatch outside the checked surface, precedented, not a new gap.

## Goals / Non-Goals

**Goals:**
- `schemas/patch-set.schema.json` + backend `PatchSet`/`Edit`/`EditTarget` protocol, round-tripping
  and reusing existing per-resource shapes, per every ticket AC.
- `target.id` required for `update`/`delete`, optional for `create`, enforced at BOTH layers: the
  JSON schema (`if`/`then`, mirroring `create-panel-request.schema.json`'s existing discriminated
  pattern) and the backend reader (`deserializationError`, matching this ticket's own explicit
  Tests-section ask).

**Non-Goals:**
- No apply logic, no new HTTP route, no ACL/existence checks against real resource ids (HEL-406).
- No frontend or MCP change — this is a backend-schema-only contract, matching
  `pipeline-proposal-contract`'s own scope.
- No typed `create`-op patch validation beyond raw-JSON passthrough (see Context above) — an
  unscoped six-kind (including a nested four-way discriminated union) typing effort belonging to
  the apply-path ticket, not this one.
- No content-level validation of `patch` for `update`/`delete` (e.g. "patch must be non-empty") —
  the ticket's AC3/Tests ask only about `target.id` presence, not `patch` presence; adding an
  unrequested rule here would be scope drift beyond what's asked.

## Decisions

**D1 — `Edit`'s six `update`-patch fields reuse the six existing `Update*Request` case classes +
formats verbatim**, mirroring `PipelineProposalSource`'s multi-`Option`-behind-one-wire-key
pattern exactly: `panelPatch: Option[UpdatePanelRequest]`, `dashboardPatch: Option[UpdateDashboardRequest]`,
`dataSourcePatch: Option[UpdateDataSourceRequest]`, `dataTypePatch: Option[UpdateDataTypeRequest]`,
`pipelinePatch: Option[UpdatePipelineRequest]`, `pipelineStepPatch: Option[UpdatePipelineStepRequest]`,
all serialized through one shared `"patch"` wire key. At most one is populated, selected on read by
`target.kind` (validated first to be one of the six recognized values). This is real type reuse,
not a hand-rolled re-declaration — `UpdatePipelineRequest.name` staying REQUIRED (not `Option`) is
preserved as-is, so a pipeline update edit with no `name` in `patch` fails via that case class's own
existing `jsonFormat1` derivation, with no extra code needed here.

**D2 — `create`-op `patch` stays untyped (`Option[JsValue]`)**, per the Context/Non-Goals rationale
above: mirrors `UpdatePanelRequest.config`'s own precedent for "shape known, not eagerly typed at
this layer." Documented in the schema's `patch` property description, naming which `Create*Request`
a future apply path (HEL-406) will decode it against, per `target.kind`.

**D3 — `target.id` required for `update`/`delete`, expressed at both layers.** Schema:
`Edit`'s `allOf`/`if`/`then` (`if op ∈ {update, delete} then target.required += id`), mirroring
`create-panel-request.schema.json`'s own existing `if`/`then`-per-discriminator pattern (not a new
technique introduced by this ticket — already used elsewhere in `schemas/`). Backend: `Edit`'s
hand-written reader raises `deserializationError` when `op ∈ {update, delete}` and `target.id` is
absent or blank — this is the literal case the ticket's own Tests section names ("rejection of an
edit with no target id for an update op").

**D4 — `PatchSet`/`EditTarget` use plain `jsonFormat2`** (spray-json's macro-derived format), not
hand-written readers — `PatchSet(summary: Option[String], edits: Vector[Edit])` and
`EditTarget(kind: String, id: Option[String])` both have simple, non-discriminated shapes; a
missing required field (`edits`, `kind`) already produces spray-json's standard
`DeserializationException`, matching `DashboardProposal`'s own precedent (`jsonFormat2`, no custom
reader, despite also having required fields). Only `Edit` needs a hand-written `RootJsonFormat` —
the one type here with real per-field dispatch + cross-field validation.

**D5 — New capability `patch-set-contract`, not a delta on an existing one.** No existing spec
capability covers a resource-targeted multi-edit artifact; `pipeline-proposal-contract` is the
closest analogous "id-free/targeted, schema+protocol-only, no-apply-logic" capability and is
mirrored in structure (one requirement per schema concern, `Requirement`/`Scenario` shape) but is
itself unmodified — a patch set is a genuinely new artifact kind, not a change to how
`PipelineProposal` behaves.

**D6 — `Edit` is a `$defs` sub-schema inside `patch-set.schema.json`, not its own top-level schema
file.** Per the Context note on `check-schema-drift.mjs`: a top-level `edit.schema.json` with
`"title": "Edit"` would be diffed against `case class Edit` and FAIL (the wire shape collapses six
`Option` fields into one `"patch"` key) unless added to that script's `SKIP` set — an edit to a
canonical procedure script for a case this project already has an established, un-edited pattern
for (`PipelineProposalSource`/`ProposalPanel` as `$defs`, never independent top-level files).
Nesting `Edit` as `$defs` avoids touching `check-schema-drift.mjs` at all.

## Risks / Trade-offs

- **`create`-op `patch` being untyped here is a known, deliberate gap** (D2) → mitigated by naming
  it explicitly in both the schema description and this design doc, so the apply-path ticket
  (HEL-406) starts from a documented gap, not a silent one — the same shape of mitigation
  `PipelineProposal`'s own design.md uses for its own explicitly-deferred concerns.
- **Six reused `Update*Request` formats could drift if a sibling ticket changes one** (e.g. adds a
  new optional field to `UpdatePanelRequest`) → no NEW risk introduced by this ticket: any such
  drift already affects every existing caller of that format (the real `PATCH` endpoint); this
  ticket adds no additional exposure, since it reuses the same `implicit val ...Format` instance,
  never a copy.
