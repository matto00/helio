# HEL-1640: Chart timestamp parser (parseChartInstant) accepts only ASCII digits; align it with the client evaluator's parsing

## Description

origin_kind: followup
origin_ticket: HEL-1581

Found by the HEL-1581 lane (the client step evaluator plus a Scala-oracle parity corpus, merged as 95b3c9fd9). The chart rendering path's own timestamp parser, `parseChartInstant` in the frontend chart code, accepts **ASCII digits only**. HEL-1581's evaluator handles that input class to match the Scala engine, and the gap is recorded in that change's `tasks.md` and parity manifest. So the same timestamp string can parse in a pipeline step (Scala, and now the client evaluator) but fail to plot, or plot differently, in a chart.

**Fix:** make `parseChartInstant` agree with the engine on which timestamp strings parse, ideally by sharing the evaluator's parser rather than keeping a third implementation. Add a parity test over the timestamp vectors from HEL-1581's corpus (`PipelineStepParitySpec` and the evaluator's Jest corpus).

## Acceptance Criteria

- The chart parser and the evaluator agree on every timestamp vector in the HEL-1581 corpus, with a test that fails on the current parser first.

## Driver notes (claims verified at Setup — see premise-validation evidence)

- No backend chart parser exists; the backend side is the engine's `TimestampParsing.parseInstant` (unchanged). Frontend-only change, no migration.
- Red-first test committed before implementation; mutations recorded.
