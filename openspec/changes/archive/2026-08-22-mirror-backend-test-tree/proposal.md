## Why

HEL-633 repackaged `backend/src/main` into domain subpackages (nested, e.g. `api/routes/pipelines/`,
`services/dashboards/`) but deliberately left the test tree untouched, only fixing its imports. The test
tree is now flat where main is nested — 34 files at `test/.../api/` root, 29 already correctly under
`test/.../api/routes/` (but still flat, not domain-split), step/shape specs sitting beside unrelated
domain specs despite `domain/steps`/`domain/shapes` existing, and two same-purpose support packages
(`testsupport/`, `testutil/`). Finding a spec for a given source file means guessing.

## What Changes

- Move every spec under `backend/src/test/scala/com/helio` into the package that mirrors its
  main-tree subject's package (verified against the live tree, not the ticket's stale enumeration —
  main is nested two levels under `api/routes/`, `api/protocols/`, and `services/`, not flat).
- Move `AggregateStepSpec` and friends into `domain/steps`; move the four shape-engine specs into
  `domain/shapes`.
- Merge `testutil/` (`JsonLogCapture.scala`, `PdfFixtures.scala` — the ticket names only one of the two
  live files) into `testsupport/` (`JsonSchemaValidation.scala`); delete `testutil/`.
- Place shared spec base classes (`ApplyProposalSpecBase`, `CombinedApplyProposalSpecBase`,
  `PipelineApplyProposalSpecBase` — again, more than the ticket's single named example) at the root of
  the package whose specs extend them.
- Update every affected `package`/`import` line. No assertion, test-name, or behavior change.

## Non-goals

- No new tests, no changed assertions, no renamed spec classes.
- No changes to `backend/src/main`.
- No scope bleed into HEL-802/803/804/811 (already filed against this epic).

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
(none — behavior-preserving refactor, no requirement changes; archive with `--skip-specs`, same
precedent as HEL-633 and five other structural refactors on this repo)

## Impact

- All ~218 files under `backend/src/test/scala/com/helio` are candidates; exact file-count-preserving
  mapping is enumerated in design.md/tasks.md against the live tree.
- `sbt test` must stay green with an identical test count before/after.
