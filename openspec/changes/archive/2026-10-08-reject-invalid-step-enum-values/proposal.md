## Why

A `fillnull`, `window` or `pivot` step can be saved with a strategy/function/agg the engine does not support (or a
lag/lead `offset` <= 0). The write succeeds, and the mistake only surfaces later in analyze or as a failed run. HEL-1310
closed the same gap for `aggregate`; HEL-1402 made every write surface call `validateRawConfig`, so one override per
kind now closes it everywhere.

## What Changes

- `FillNullStep`, `WindowStep` and `PivotStep` companions override `validateRawConfig` (composed with `super`, the
  HEL-1310 pattern) to reject, with the same message run/analyze already use:
  - a non-empty fillnull `strategy` outside `SupportedStrategies`;
  - a non-empty window `function` outside `SupportedFunctions`;
  - a `lag`/`lead` window with an explicit `offset` <= 0;
  - a non-empty pivot `agg` outside `SupportedAggs`.
- Each rule is ONE shared function per kind, called by `validateRawConfig`, the analyze validator and `apply`.
- Incomplete drafts stay saveable: empty/absent enum values, `constant` with no `value`, `running_sum`/`lag`/`lead`
  with no `field`.
- Frontend: the three step editors surface a rejected PATCH's server message (today swallowed for every kind except
  `upsertsource`); their dropdowns/offset input already only emit supported values (pinned by tests).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `pipeline-step-config-rejection`: adds a requirement that clearly invalid fillnull/window/pivot enum values and a
  non-positive lag/lead offset are rejected on every write surface, while incomplete drafts stay accepted.

## Non-goals

- Extracting the shared `companionFor(...).validateRawConfig` helper (HEL-1417).
- Read-time validation of already-stored configs (they keep reading, analyzing and failing at run as today).
- Any change to fillnull fill semantics (HEL-1408, in flight).
- Other kinds' enums (groupby, union, join, stringops, dedupe).
- Rejecting `offset` on non-lag/lead functions (run ignores it there).

## Impact

- Backend: `FillNullStep.scala`, `WindowStep.scala`, `PivotStep.scala`, `PipelineAnalyzeService.scala` validators,
  plus specs. REST returns 422 on step create/update (existing status for a `validateRawConfig` problem); proposal,
  patch-set and single-call create reject with their existing shapes.
- Frontend: `useStepCardState` error capture for the three kinds and their editor components/tests.
- No migration, no API shape change.
