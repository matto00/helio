## Why

Conversational refinement ("make that a bar chart," "add a unit label," "drop the last panel")
needs to apply targeted patches to *existing* resources, not rebuild them. Today's propose/apply
artifacts (`DashboardProposal`, `PipelineProposal`) only *create*. HEL-328 added the MCP
edit-in-place PATCH tools (source/type/pipeline/step/panel) — the mutation primitives — but there
is still no reviewable, multi-edit artifact describing N targeted edits across one or more
resources so a refinement can be previewed and applied atomically. This ticket defines that
artifact's schema + protocol, the foundation the diff-preview (HEL-406), atomic-apply, and undo
tickets build on.

## What Changes

- New `schemas/patch-set.schema.json`: a `PatchSet` is `{ summary?, edits: [Edit] }`, where each
  `Edit` targets a resource by `{ kind, id? }` and carries `op` (`update`/`delete`/`create`) plus
  an optional `patch` body. `target.id` is schema-required whenever `op` is `update`/`delete`
  (via an `if`/`then` conditional, mirroring `create-panel-request.schema.json`'s existing
  discriminated-shape pattern) and absent-able only for `create`.
  `patch`'s real shape reuses the existing per-resource PATCH/create request shapes
  (`UpdatePanelRequest`, `UpdateDashboardRequest`, `UpdateDataSourceRequest`,
  `UpdateDataTypeRequest`, `UpdatePipelineRequest`, `UpdatePipelineStepRequest` for `update`; the
  matching `Create*Request` for `create`) rather than inventing new ones — documented precisely
  per `(kind, op)` in the schema's own description, not machine-`$ref`'d (none of these six
  request shapes has its own standalone schema file today to `$ref` against).
- New backend `PatchSet`/`Edit`/`EditTarget` case classes + a `PatchSetProtocol` trait
  (`backend/src/main/scala/com/helio/api/protocols/PatchSetProtocol.scala`), mixed into
  `JsonProtocols`. `Edit`'s `update`-op `patch` is decoded into one of six typed, `Option`-wrapped
  fields (one per `target.kind`) reusing the SIX EXISTING `Update*Request` case classes and their
  existing `RootJsonFormat`s verbatim — mirroring `PipelineProposalSource`'s flat
  multi-`Option`-field-behind-one-shared-wire-key pattern (HEL-379). `create`-op `patch` stays a
  raw `JsValue` passthrough (mirrors `UpdatePanelRequest.config`'s own established convention) —
  typed decoding against the matching `Create*Request` is an apply-time concern (HEL-406).
- Tests: ScalaTest round-trip for a mixed patch set (panel update + panel delete + dashboard
  layout update), absent-optional tolerance, and rejection of an edit with no target id for an
  update op — via `deserializationError` in the hand-written `Edit` reader.
- No new HTTP route, no apply logic, no frontend/MCP changes.

## Capabilities

### New Capabilities
- `patch-set-contract`: the patch-set schema + protocol artifact — an ordered list of
  resource-targeted, typed edits, reusing existing per-resource PATCH/create shapes. Mirrors
  `pipeline-proposal-contract`'s existing shape (schema+protocol only, no apply logic).

## Impact

- `schemas/patch-set.schema.json` (new).
- `backend/src/main/scala/com/helio/api/protocols/PatchSetProtocol.scala` (new).
- `backend/src/main/scala/com/helio/api/JsonProtocols.scala` (add `with PatchSetProtocol`).
- `backend/src/test/scala/com/helio/api/protocols/PatchSetProtocolSpec.scala` (new).
- No changes to existing PATCH endpoints, request shapes, routes, or the frontend/MCP surface.
