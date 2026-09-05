# Guard previewAtNode's dependency-closure slicing

## Why

`previewAtNode`'s dependency-closure slicing is correct but unguarded: widening the slice to the pipeline's
full step list leaves the entire backend suite green, including the test named for exactly that behaviour.
The named test reads the target node's own recorded rows via the HEL-905 node-keyed outcome lookup, and that
lookup masks the break — executing extra, off-path nodes cannot change the target's own row count. HEL-949's
audit measured this hole; leaving it open means any future refactor of the slicing ships unverified.

## What Changes

- Add route-level guards in `PipelineRunRoutesSpec` that assert on `stepRowCounts`' KEY SET — the set of nodes
  a preview actually executed — on a pipeline containing at least one node OUTSIDE the target's dependency
  closure. `stepRowCounts` is not routed through the node-keyed lookup, so it observes the slice directly.
- Cover more than one axis of wrongness, with each mutation demonstrated RED by actually running it:
  widening the slice, targeting the wrong node, a degenerate self-only slice, and a branching/multi-root
  shape where "prefix" is ambiguous.
- Record the measured mutation matrix (mutation -> observed failure output) as a durable evidence artifact
  in the change directory.
- Decide and record, in `design.md`, whether the second slicing site (`previewOutputs`) is guarded here or
  scoped out with a filed follow-up.

## Capabilities

### New Capabilities

None — test-only change.

### Modified Capabilities

None — no requirement changes. The production behaviour under test is already specified and already correct;
this change only adds discrimination to the suite. `.openspec.yaml` sets `skip_specs: true`.

## Non-goals

- Any production-code change to `PipelineRunService` or `NodeDependencyClosure`. This is a coverage hole,
  not a defect; a production diff here would be out of scope and a red flag.
- Any database migration. The dev Postgres is shared with concurrent runs.
- Any Playwright/e2e work — another concurrent run holds the browser.
- A general mutation-testing harness. The deliverable is specific guards plus recorded evidence, not tooling.

## Impact

- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineRunRoutesSpec.scala` (primary), and
  possibly `backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceSpec.scala`.
- No production source, no schema, no API contract.
