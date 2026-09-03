## Why

Adding a union step via the frontend "+ Add transformation step" picker 404s: `unionCheckF`
(`PipelineService.addStep`/`updateStep`) unconditionally runs `findByIdOwned` on
`UnionConfig.otherDataSourceId`, and the picker's own `defaultConfigFor("union")` seeds an empty
id. The union op is unusable via the normal UI flow. HEL-386 already fixed the identical defect
for `lookup`; union needs the same guard.

## What Changes

- Guard `unionCheckF` in both `addStep` and `updateStep` so `findByIdOwned` only runs when
  `otherDataSourceId` is non-empty, mirroring `lookupCheckF`'s existing shape exactly.
- An empty `otherDataSourceId` is treated as an incomplete draft (allowed to persist), not a
  security violation; a non-empty cross-user id still 404s (HEL-384's ACL boundary unchanged).
- Add regression coverage: POST/PATCH with empty `otherDataSourceId` persists; existing
  cross-user-404 tests continue to pass unchanged.
- No frontend change: the picker already sends the empty default correctly (mirrors lookup,
  which needed no frontend change either) — confirmed during premise validation.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `pipeline-union-op`: the "second-source reference must be caller-owned" requirement is amended
  to exempt an empty `otherDataSourceId` from the ownership check, mirroring
  `pipeline-lookup-op`'s existing analogous requirement.

## Impact

- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` (`unionCheckF` in
  `addStep` and `updateStep`).
- `backend/src/test/scala/.../PipelineServiceSpec.scala` (or wherever HEL-384's union ACL tests
  live) — new empty-id regression cases.
- No frontend code changes anticipated (picker already sends the correct empty default); live
  browser verification will confirm.

## Non-goals

- `joinCheckF`'s identical unguarded-empty-id gap (HEL-278, predates the HEL-336 op-expansion
  epic) — out of this ticket's file-ownership scope; reported as a follow-up finding.
- No other HEL-336 op has a second-datasource ACL check to guard (only join/union/lookup
  reference a second `DataSource` by id) — confirmed during premise validation.
