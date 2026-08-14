- `schemas/patch-set.schema.json` — new JSON Schema 2020-12 defining `PatchSet` (`summary?`, `edits`)
  and its `$defs.Edit`/`$defs.EditTarget` sub-schemas, with an `if`/`then` conditional requiring
  `target.id` when `op` is `update`/`delete` (mirrors `create-panel-request.schema.json`'s existing
  discriminated pattern). `patch`'s real per-`(kind, op)` shape is documented by name rather than
  `$ref`'d, since none of the six reused request shapes has a standalone schema file.
- `backend/src/main/scala/com/helio/api/protocols/PatchSetProtocol.scala` — new protocol trait with
  `EditTarget`/`Edit`/`PatchSet` case classes and formats. `Edit`'s six `update`-op patch fields
  (`panelPatch`/`dashboardPatch`/`dataSourcePatch`/`dataTypePatch`/`pipelinePatch`/
  `pipelineStepPatch`) reuse the six existing `Update*Request` case classes/formats verbatim,
  mirroring `PipelineProposalSource`'s multi-`Option`-field-behind-one-shared-wire-key pattern.
  `editFormat` is hand-written to validate `op`/`target.kind`, enforce non-blank `target.id` for
  `update`/`delete`, and dispatch the shared `"patch"` wire key by `target.kind`. `editTargetFormat`/
  `patchSetFormat` are plain `jsonFormat2`.
- `backend/src/main/scala/com/helio/api/JsonProtocols.scala` — added `with PatchSetProtocol` to the
  aggregator's `extends` list (grouped near the other proposal-like protocol traits) plus a doc
  comment describing its cross-domain dependency chain.
- `backend/src/test/scala/com/helio/api/protocols/PatchSetProtocolSpec.scala` — new ScalaTest spec:
  mixed round-trip (panel update + panel delete + dashboard layout update), absent-optional
  tolerance (summary, patch), `target.id` enforcement for update/delete vs. create, rejection of
  unrecognized `op`/`target.kind`, and absent-optional write omission (no `null` emitted).
