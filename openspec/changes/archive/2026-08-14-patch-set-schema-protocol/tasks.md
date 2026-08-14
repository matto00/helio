## 1. Backend

- [x] 1.1 Create `schemas/patch-set.schema.json` (JSON Schema 2020-12): top-level `PatchSet`
      (`summary?`, `edits` required); `$defs.Edit` (`target` required, `op` required enum
      `update|delete|create`, `patch` optional object) with an `allOf`/`if`/`then` requiring
      `target.id` when `op` is `update`/`delete` (mirrors `create-panel-request.schema.json`'s
      existing conditional pattern); `$defs.EditTarget` (`kind` required enum
      `panel|dashboard|dataSource|dataType|pipeline|pipelineStep`, `id` optional). `patch`'s
      description documents its real per-`(kind, op)` shape by name (the six existing
      `Update*Request` case classes for `update`; the matching `Create*Request` for `create`;
      unused for `delete`) rather than `$ref`-ing shapes that don't exist as standalone schema
      files today.
- [x] 1.2 Create `backend/src/main/scala/com/helio/api/protocols/PatchSetProtocol.scala`:
      `EditTarget(kind: String, id: Option[String])`, `Edit(target, op, panelPatch:
      Option[UpdatePanelRequest], dashboardPatch: Option[UpdateDashboardRequest], dataSourcePatch:
      Option[UpdateDataSourceRequest], dataTypePatch: Option[UpdateDataTypeRequest], pipelinePatch:
      Option[UpdatePipelineRequest], pipelineStepPatch: Option[UpdatePipelineStepRequest],
      createPatch: Option[JsValue])`, `PatchSet(summary: Option[String], edits: Vector[Edit])`.
      `PatchSetProtocol extends ... with PanelProtocol with DashboardProtocol with
      DataSourceProtocol with DataTypeProtocol with PipelineProtocol with PipelineStepProtocol`
      (reuses each kind's existing `Update*Request` format verbatim — no new per-kind format).
      `editTargetFormat`/`patchSetFormat` are plain `jsonFormat2` (design.md D4). `editFormat` is
      hand-written: validates `op` ∈ {update,delete,create} and `target.kind` ∈ the six recognized
      values (`deserializationError` otherwise); requires non-blank `target.id` when `op` ∈
      {update,delete} (`deserializationError` otherwise); for `op: update`, decodes the shared
      `"patch"` wire key into the ONE `Option` field matching `target.kind`, leaving the other five
      `None`; for `op: create`, stores `"patch"` raw into `createPatch`; for `op: delete`, all
      seven patch-carrier fields stay `None`. `write` re-collapses whichever field is populated
      back onto the shared `"patch"` key (mirrors `pipelineProposalSourceFormat`'s `write`).
- [x] 1.3 Add `with PatchSetProtocol` to `JsonProtocols`'s `extends` list
      (`backend/src/main/scala/com/helio/api/JsonProtocols.scala`), grouped near the other
      proposal-like protocol traits (`DashboardProposalProtocol`/`PipelineProposalProtocol`/
      `CombinedProposalProtocol`/`PipelineAnalyzeProposalProtocol`).

## 2. Tests

- [x] 2.1 Create `backend/src/test/scala/com/helio/api/protocols/PatchSetProtocolSpec.scala`
      (ScalaTest, mirrors `DashboardProposalProtocolSpec`/`PipelineProposalProtocolSpec`'s style):
      - Round-trip a mixed `PatchSet` (panel-update edit with a populated `panelPatch`, a
        panel-delete edit, a dashboard-update edit with a populated `dashboardPatch` carrying
        `layout`) — serialize then deserialize, assert equality.
      - Reading tolerates `summary` absent, and an `Edit`'s `patch` absent (e.g. a delete edit).
      - `Edit`'s reader raises a `deserializationError` when `op: "update"` and `target` omits
        `id` (or `id` is blank) — the ticket's own named test case.
      - `Edit`'s reader succeeds when `op: "create"` and `target` omits `id`, producing
        `target.id = None`.
      - An `Edit` with an unrecognized `op` or `target.kind` raises a `deserializationError`.
      - Writing omits `summary`/`patch` keys when absent rather than emitting `null` (mirrors the
        existing absent-optional-tolerance tests for `ProposalPanel`/`PipelineProposal`).
- [ ] 2.2 Run `sbt test` and confirm the new spec passes alongside the existing suite.

## 3. Docs

- [x] 3.1 No README/tool-table changes — this ticket adds no MCP tool, no HTTP route, and no
      frontend surface (backend schema + protocol only, per ticket scope).
