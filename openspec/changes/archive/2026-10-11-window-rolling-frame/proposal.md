## Why

The `window` step has no bounded frame: it supports only `row_number`, `rank`, `dense_rank`, `running_sum`, `lag`
and `lead` (`WindowStep.scala:95`). Rolling baselines, such as helio-news's 7-day pass-rate/duration baseline,
are computed in Python today. Users cannot build a moving average in a pipeline.

## What Changes

- Five new `window` functions: `rolling_avg`, `rolling_sum`, `rolling_min`, `rolling_max`, `rolling_count`.
  Each is computed over a trailing frame: the current row plus earlier rows in partition `orderBy` order.
- Two new optional config keys: `frameSize` (positive integer, at most 1000) and `frameUnit` (`rows` | `days`,
  default `rows`).
  - `rows`: the current row and the `frameSize - 1` rows before it.
  - `days`: every partition row whose single ascending `orderBy` key (as a UTC date) falls within
    `[d - (frameSize - 1), d]`. Gaps are not filled. Same-date rows share one frame.
- Leading partial frames emit a value over the rows available. This is documented behaviour.
- SQL null semantics: null and non-numeric values are skipped. If a frame has no numeric values, avg/sum/min/max
  are `null` and count is `0`.
- Validation follows HEL-1416. These are rejected at save:
  - a non-positive or over-cap `frameSize`;
  - an unknown `frameUnit`;
  - `days` without exactly one ascending `orderBy` key.
  Incomplete drafts stay saveable. Analyze and run enforce `field`, `frameSize` and a non-empty `orderBy`.
- Analyze infers `float` for avg/sum/min/max and `integer` for count, matching apply.
- The step editor supports the new functions, `frameSize` and `frameUnit`. The MCP tool docs and the
  refinement-prompt doc string list them too.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `pipeline-window-op`: adds the rolling functions, the frame config keys, their analyze inference, and the write-time
  rejection of an invalid `frameSize`/`frameUnit`/days ordering (that capability owns window write validation).
- `pipeline-step-config-rejection`: its window rejection and draft lists gain the rolling cases.

## Impact

- Backend: `WindowStep.scala`, `ReshapeSchemaInference.inferWindow`, `StepConfigValidation.validateWindow`,
  `AnalyzeSchemaWarnings.referencedFields`, and the `RefinementEditShape` doc string (one line).
- Frontend: `WindowConfig.tsx`, `stepNarrowing.ts`, `pipelineStep.ts` types, and the field handlers.
- helio-mcp: `write.ts` window description.
- No migration: the config is JSON, `window` is already allowed (V66), and the new keys are optional, so existing
  rows decode unchanged.

## Non-goals

- Centred frames. These go to a follow-up ticket per the owner's answer.
- Spark execution. `window` runs in-process only.
- A `minPeriods` option, or imputing missing days.
- Any change to the existing six functions' semantics, including `running_sum`'s non-numeric-as-0 rule.
