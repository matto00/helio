## Why

The pipeline run-status SSE channel (`pipeline-run-sse`) is ephemeral by design: a client only
receives events published while its stream is open. `pipelineRunFanout.ts` deliberately closes
and reopens that stream after every terminal event (HEL-1094 D3), and the registry issues a
brand-new subscription with no backlog/replay on each reconnect (`PipelineRunRegistry.subscribe`,
`PipelineRunStreamRoutes`). If a run reaches a terminal status while no subscriber is registered
— which structurally includes the reconnect gap itself — that terminal outcome is gone forever;
nothing else in the stack (client or server) ever re-derives it. `e2e/hel1094-sse-fan-out-panel-
refresh.spec.ts`'s second-submit assertion has already caught this twice on `main`
(35934013358@853fb0a2, 36052610260@f272a605) plus once on PR #694. This is the last blocker for
the v0.8.4 release (owner ruling, recorded on HEL-1174, alongside HEL-1169/78ebb3a6).

## What Changes

- Add a reconciliation path so a subscriber crossing a reconnect (or connecting after a run has
  already finished) can still learn the run's terminal outcome, instead of relying solely on the
  ephemeral push channel.
- Probe (systematic-debugging law) to confirm which race actually causes the miss before changing
  any code — see design.md's probe plan and evidence.
- No removal of the existing ephemeral push path; this adds a fallback, it does not replace SSE.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `pipeline-run-sse`: adds a requirement that a subscriber's (re)connection SHALL be reconciled
  against the pipeline's actual latest run outcome, so a terminal status published while no
  subscriber was registered is never permanently lost to that subscriber.

## Impact

- `frontend/src/features/panels/services/pipelineRunFanout.ts` (reconnect/backoff logic)
- `frontend/src/features/pipelines/hooks/usePipelineRunEvents.ts` (if the same gap applies there)
- `backend/src/main/scala/com/helio/api/routes/pipelines/PipelineRunRegistry.scala` /
  `PipelineRunStreamRoutes.scala` (subscribe-time reconciliation)
- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala` /
  `PipelineRunRepository.scala` (a "latest run for pipeline" read path, if one does not already
  exist in the needed shape)
- `e2e/hel1094-sse-fan-out-panel-refresh.spec.ts` (must pass, unmodified in its timing/assertions)
- No migration expected (V111 is the next free slot if one turns out to be necessary)
