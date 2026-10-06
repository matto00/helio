## Why

`PatchSetUndoServiceSpec.scala` is 805 lines (19 tests) — double CONTRIBUTING's ~400-line split threshold — after
growing in HEL-1256 and HEL-1295. Its tests cover four distinct concerns sharing one ~200-line fixture.

## What Changes

- Extract the embedded-Postgres fixture (repos, services, seed helpers, `beforeAll`/`afterAll`) into one shared
  test trait, `PatchSetUndoServiceFixture`, in the same test package.
- Replace the single spec with four concern-focused specs that mix in the trait:
  - `PatchSetUndoPanelDashboardSpec` — update-edit restore, panel/placement/dashboard create/delete undo (5 tests)
  - `PatchSetUndoLaneSpec` — pipelineStep (lane) create/delete undo (5 tests)
  - `PatchSetUndoRefusalSpec` — whole-undo refusals, Phase-2 failure reporting, 404 access (5 tests)
  - `PatchSetUndoRepoWiringSpec` — undo-context parity and null-`outputRepo` rejections (4 tests)
- Delete `PatchSetUndoServiceSpec.scala`.
- Test bodies move verbatim: same test names, same assertions, same total count (19).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None — test-only refactor, no behaviour change (`skip_specs: true`).

## Impact

- Test code only, under `backend/src/test/scala/com/helio/services/patchsets/`, plus comment-only pointer updates in
  `api/routes/patchsets/PatchSetUndoRoutesSpec.scala` and `services/patchsets/PatchSetApplyServiceSpec.scala` /
  `PatchSetUndoInverseSpec.scala`. No production code.
- Three more embedded-Postgres suite startups per `sbt testFull` (one per spec); new suite names are packed into CI
  shards at the median weight by `TestShards.lpt`, so no CI config change.

## Non-goals

- Fixing any bug found while splitting (noted as a spinoff instead).
- Changing any assertion, test name, or fixture behaviour; touching `PatchSetApplyResolvers` (HEL-1337).
- Regenerating `backend/project/test-suite-weights.tsv`.
