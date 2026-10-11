## Why

HEL-1479 split `PatchSetApplyResolvers.scala` into five target-kind resolver objects (plus a shared
`PatchSetResolverSupport` that stayed in that file) with an empty test diff and no comment edits, so the follow-ups
its evidence found were deliberately left: stale comment citations, mis-labelled `ExistenceNotLeakedRoutesSpec`
output rows, and three branches no spec observes. One of those, the editor-grant branch of
`authorizeEditorOrOwnerOnPipeline`, is access control: weakening it left every targeted spec green.

## What Changes

- Priority (item 7): add tests pinning the pipeline-grant branches of the patch-set pipelineStep gate (an editor
  grantee may edit a pipeline's steps through patch-set preview/apply; a viewer grantee gets 403) for update, delete
  and create; audit the other editor-grant paths (dashboard grant on panel/dashboard patch-set edits) for the same
  gap and close any found the same way. Each test shown red against a one-line mutation, then green.
- Items 5-6: tests asserting the `target.id is required` 400 message and both `decodeCreatePatch` 400 messages
  (missing patch; patch does not match the expected shape), red-first by mutation.
- Item 4: repoint the four output rows' `sites` to `PatchSetOutputResolvers.scala`, with mutation evidence that each
  row still fails when a foreign id gets through.
- Items 1-3: correct stale comment citations (symbol + file, no line numbers), including `PipelineProtocol.scala`'s
  citation of a method that never existed, and stale positional words / `[[...]]` links / `PipelineService`
  citations inside the six resolver files.
- Items 8-9: recorded decisions (design.md D6).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. Tests, test metadata and comments only; `.openspec.yaml` sets `skip_specs: true`.

## Non-goals

- Any behaviour or wire change. An authorization defect found by a new test is escalated to the owner; any other
  defect becomes its own ticket. Neither is fixed here.
- Splitting `PatchSetPipelineStepResolvers.scala` (item 8) or editing HEL-1479's archived evidence (item 9).

## Impact

Comment edits in `backend/src/main/scala/com/helio/services/patchsets/` and
`backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineProtocol.scala`; new tests and comment/row edits in
`backend/src/test/scala/`. No API, schema, migration or frontend change.
