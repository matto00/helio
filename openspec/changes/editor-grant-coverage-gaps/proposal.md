## Why

HEL-1482's editor-grant audit mutated every viewer/editor grant branch in `backend/src/main/scala` and found eight
branches outside `services/patchsets/` that no spec observes: weakening each (letting a viewer through, rejecting an
editor, or mapping an anonymous read arm to Editor) left `testFull` green. The production code is believed correct
at every site; the risk is that a future edit weakens an access-control branch silently. Two comments also cite a
method (`resolveRootDataSources`) that does not exist.

## What Changes

- New tests pinning the eight surviving grant branches (PanelService batch update, DashboardContentsService
  `PUT contents`, DashboardService.exportSnapshot, AccessCheckerImpl public-viewer arm, AclDirective anonymous
  token-authorized arm, ResourcePermissionRepository unknown-role fallback, PipelineRunService.submit,
  OutputService.create), covering viewer/editor/owner where each applies, each shown red under a one-line mutation of
  the branch it guards, then green.
- Comment fixes: the two stale `resolveRootDataSources` citations repointed to
  `PipelineRootWrites.resolveOneRootSourceId` / `PipelineCreateWrites.lookupOwnedRoots`; optionally a comment at the
  ResourcePermissionRepository fallback documenting why it is fail-closed (design D4).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. Tests and comments only; `.openspec.yaml` sets `skip_specs: true`.

## Non-goals

- Any behaviour, wire, schema or migration change. A real authorization defect exposed by a new test is escalated to
  the owner with an exact repro (PR parked, not merged); it is not fixed here.
- Re-auditing grant sites HEL-1482 already recorded as killed.

## Impact

New test files / tests under `backend/src/test/scala/`; comment-only edits in
`backend/src/main/scala/com/helio/services/pipelines/PipelineCreateTransaction.scala`,
`PipelineRootWrites.scala` and possibly
`backend/src/main/scala/com/helio/infrastructure/persistence/auth/ResourcePermissionRepository.scala`. No API,
schema, migration or frontend change.
