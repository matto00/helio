# HEL-1370: Pipeline runs with no terminal SSE event: 429-rejected submits and failed applyWriteBacks

## Description

Found during HEL-1366 (PR matto00/helio#831, b14e622ee). HEL-1366 made every terminal path in
`PipelineRunService` publish exactly one terminal event after its writes finish. Two paths that existed before that
change still never publish a terminal event at all:

1. A submit rejected with `429` by the HEL-505 rate limit or concurrency cap publishes `queued` and then nothing else.
2. When the `applyWriteBacks` Future fails, no terminal event is published.

In both cases, connected SSE clients (dashboard fan-out) are left waiting for an end event that never comes.

## Do

* Confirm both paths against the code.
* Make each path end in exactly one terminal event, or never publish `queued` for a rejected submit.
* Extend `PipelineRunServiceTerminalOrderingSpec`, or add a sibling spec, so each case fails before the fix.

## Acceptance Criteria

* Both paths confirmed against the code (see premise-validation evidence).
* A submit rejected with 429 (rate limit or concurrency cap) never leaves an SSE subscriber with a `queued` event that
  has no terminal event.
* A run whose `applyWriteBacks` Future fails publishes exactly one terminal event.
* Each case has a test in `PipelineRunServiceTerminalOrderingSpec` (or a sibling) that fails before the fix.

## Driver constraints

* Minimal diff in `PipelineRunService.scala`; no refactor (HEL-1371 splits the file next).
