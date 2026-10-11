## Why

`backend/src/main/scala/com/helio/services/patchsets/PatchSetApplyResolvers.scala` is 853 lines at origin/main
6d298d5f8 (unchanged since 1b765f59d), over 3x CONTRIBUTING.md's ~250-line soft budget. One object holds the
patch-set pre-validation for every target kind (panel, dashboard, dataSource, pipeline, pipelineStep, output) plus
the shared access helpers they all use. HEL-1463 deferred it to this ticket.

## What Changes

- Move each non-dashboard target kind's resolvers into its own `private[patchsets] object` file in the same package,
  bodies byte-identical: panel, dataSource, pipeline, pipelineStep, output (design.md D2).
- `PatchSetApplyResolvers.scala` keeps: the object's name, package, modifier and doc, `resolveAll`, the
  `resolveEdit` dispatch (text unchanged), the four dashboard resolvers, and, in a second top-level object in the
  same file, the shared access/decode helpers. All four `ServiceError.Forbidden(` producers and both
  `requireAccess(` calls stay in this file, so `ExistenceNotLeakedRoutesSpec` needs no edit (design.md D1).
- No behaviour change, no wire change, no test-source change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. Pure structural refactor; `.openspec.yaml` sets `skip_specs: true`.

## Non-goals

- Editing `ExistenceNotLeakedRoutesSpec` (or any test): not needed (D1), and HEL-1480 edits that spec concurrently.
- Renaming anything, deleting dead code, fixing stale doc links/comments in or outside the moved code, or fixing any
  defect found (each becomes a follow-up).

## Impact

`backend/src/main/scala/com/helio/services/patchsets/` only, plus that package's README file list. No API, schema,
migration, or frontend change.
