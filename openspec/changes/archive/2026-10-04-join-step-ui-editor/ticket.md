# HEL-958: Join op is uncreatable from the pipeline UI: add JoinConfig.tsx editor and a join entry in OP_TYPES

## Description

`join` is intentionally excluded from the pipeline step picker because no `JoinConfig.tsx` editor exists
(HEL-264's original rationale: showing an op the user cannot configure led to confusion). The op works
end-to-end on the backend at create/update/execute/analyze time. It simply has no editor, so the UI hides
it. Agents (helio-mcp `add_pipeline_step`, pipeline proposals, patch-sets) can already author joins.

Dependency HEL-950 (the `.nonEmpty` guard on the join second-source ACL pre-flight) is merged, so seeding
a join step with an empty `secondaryInput.dataSourceId` no longer 404s.

### Ticket scope (as filed)

1. Add `JoinConfig.tsx`, modelled on `UnionConfig.tsx` and `LookupConfig.tsx` (both second-source-picker
   editors): a picker for the right-hand input, a key field for `joinKey`, and a join-type selector for
   `joinType`.
2. Add a `join` entry to `OP_TYPES` and retire the redundant `JOIN_OP_TYPE` special case in
   `stepNarrowing.ts`.
3. Update the `OP_TYPES` exclusion comment, which will no longer apply.

### Premise corrections (orchestrator, validated against main at ea57dac8)

The filed ticket is out of date in four ways. These corrections replace the ticket text where they
conflict:

- **The palette is backend-catalog-driven (HEL-1136).** `StepPalette` lists `GET /api/pipeline-step-catalog`
  entries filtered on `authorable`, and `JoinStep.companion` declares `authorable = false`. An `OP_TYPES`
  entry alone does not make join appear. The backend declaration must flip, so this is **not UI-only**.
- **The config shape is `secondaryInput`, not `rightDataSourceId`.** Since HEL-911 the join config is
  `{secondaryInput: {kind:"source", dataSourceId} | {kind:"lane", stepId}, joinKey, joinType}`. A legacy
  flat `rightDataSourceId` is a hard decode error. The editor therefore uses the shared
  `SecondaryInputPicker` (source or lane), as union and lookup do.
- **The icon is lucide `Link2`, not `faLink`.** The codebase moved off FontAwesome. `JOIN_OP_TYPE`
  already uses `Link2`.
- **Line numbers have moved.** In `stepNarrowing.ts` the exclusion comment is at ~100-112, `OP_TYPES` at
  ~114-146, `JOIN_OP_TYPE` at ~248, and the `pipelineStepToStep` special case at ~484-489.

The backend supports only `inner` and `left` (`JoinStep.SupportedJoinTypes`).

## Acceptance Criteria

1. A user can add a **Join tables** step from the pipeline step palette. The catalog reports `join` as
   authorable, and adding it does not 404 (relies on HEL-950).
2. The join step card renders a `JoinConfig` editor with three controls:
   - a right-hand input picker (data source or another lane), reusing `SecondaryInputPicker`
   - a join-key selector
   - a join-type selector offering exactly the backend-supported types (`inner`, `left`)
3. Edits persist with exactly the wire key set `{secondaryInput, joinKey, joinType}`, which is the same
   shape helio-mcp/agent authoring writes. A stored lane reference, an unknown `joinType`, or a `joinKey`
   absent from the current input schema is shown honestly and never silently overwritten or dropped.
4. `JOIN_OP_TYPE` and its `pipelineStepToStep` special case are retired. Join resolves through `OP_TYPES`
   like every other op, and the stale exclusion comment is updated.
5. A client/server seam test proves that the UI-authored join config and the backend's decode/encode
   round-trip identically. It uses a shared fixture read by both suites and must be red under a key-rename
   mutation. helio-mcp's `add_pipeline_step` description documents the same join shape.
6. Live verification against the running app in light and dark themes: build a join through the UI
   between two real sources, run the pipeline, and assert real output rows, including HEL-1236
   `right_<name>` collision prefixing.
7. Out of scope: `groupby` has the same "registered but unauthorable" pattern; it is tracked by HEL-1142
   (v0.9). HEL-1251 (case-sensitive collision rename) is also out of scope.
