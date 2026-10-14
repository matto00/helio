## Why

HEL-1429's lane left four small follow-ups: two pipeline-service comments that misstate control flow / call paths,
a services/pipelines README whose file list has drifted far behind the directory, decorative section banners in a
459-line spec that CONTRIBUTING reserves for ~1,000+ line files, and a one-off e2e flake that was never probed.

## What Changes

- Reword the `gatedSubmit` comment in `PipelineSchedulerService.scala` to name the submit branch's inner `transform`.
- Reword `PipelineRunBackfill.scala`'s explicitRootId comment: `OutputService` reaches it via
  `PipelineRunService.backfillOutputNode`'s pass-through, not directly. Leave the (accurate) `PipelineRunService`
  copy as is, after verifying it.
- Re-derive `services/pipelines/README.md`'s file list from the tree with a command; add the command to the README;
  drop any implied completeness.
- Remove FireTimeRunConfigGateSpec's four `// ----` banners, keeping any load-bearing fact (e.g. the red-first base
  commit `1bf11f55`) as an ordinary comment.
- Bounded repro attempt of the hel813 surface 7 flake at 430px; root-cause only if it reproduces.

## Capabilities

No spec-level behaviour changes (comments, README, test comments). `skip_specs: true` in `.openspec.yaml`.

### New Capabilities
(none)

### Modified Capabilities
(none)

## Non-goals

- No production code behaviour change; no refactor of `gatedSubmit` or the backfill path.
- No README edits outside `services/pipelines/`; nothing in HEL-1446's file set.
- No e2e change unless the flake reproduces.

## Impact

`PipelineSchedulerService.scala`, `PipelineRunBackfill.scala` (comments), `services/pipelines/README.md`,
`FireTimeRunConfigGateSpec.scala` (comments only). Possibly evidence-only for the e2e item.
