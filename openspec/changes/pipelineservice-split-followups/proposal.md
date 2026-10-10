## Why

HEL-1463 split `PipelineService.scala` into nine `private[pipelines]` collaborators with an empty test diff, so the
follow-ups its evidence found were deliberately left unfixed: four branches no test asserts (each was mutated with no
spec going red), comments that cite line numbers and a single file that no longer exist as cited, two dead members,
and five collaborators over the ~250-line soft budget.

## What Changes

- Add four tests, each shown red against a mutation of the branch it guards before it is accepted:
  service-level blank-name `400` on `create`; `laneTree` unknown-pipeline `404`; analyze-proposal inline `static`
  source with no `config` (`400`); `updateStep` when the update returns no row (`404`).
- Correct stale comment citations (symbol + file, never a line number) in `PipelineCreateTransactionalSpec`,
  `PatchSetApplyResolvers.scala`, `PatchSetPreviewProjection.scala`, `PipelineStepRepository.scala`, and stale
  positional words / `[[...]]` links inside the nine collaborator files.
- Repoint `ExistenceNotLeakedRoutesSpec` pipeline-step and pipeline-analyze rows' `sites` at the collaborator that
  now runs the access check, with mutation evidence that each row still fails when that producer is broken.
- Delete dead `PipelineServiceSupport.stepAddress` and the entry point's unused class-level `log`.
- Item 4 (soft budget): recorded decision to keep the five files unsplit, with justification (design.md D5).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. Tests, comments and dead-code removal only; `.openspec.yaml` sets `skip_specs: true`.

## Non-goals

- Any behaviour or wire change. A real defect found by a new test becomes a follow-up ticket, not a fix here.
- `ExistenceNotLeakedRoutesSpec`'s `PatchSetApplyResolvers.scala` rows and the `PatchSetApplyResolvers.scala` split
  (HEL-1479, running concurrently).
- Splitting the five over-budget collaborators (see design.md D5).

## Impact

`backend/src/main/scala/com/helio/services/pipelines/` (two private deletions, comment edits),
`backend/src/main/scala/com/helio/services/patchsets/` and `infrastructure/persistence/pipelines/` (one comment each),
and `backend/src/test/scala/` (new tests, comment edits, `ExistenceNotLeakedRoutesSpec` site names). No API, schema,
migration or frontend change.
