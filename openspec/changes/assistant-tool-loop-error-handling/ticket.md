# HEL-667: Error handling + telemetry for the assistant tool loop

## Description

HEL-401 already built error/guardrail UX + telemetry for the single-shot dashboard-authoring flow
(goal → proposal → apply outcomes). HEL-659's tool loop introduces new failure modes that need the
same first-class treatment, not silent failures. See
`docs/superpowers/specs/2026-08-14-top-level-assistant-design.md`.

Depends on `AssistantService`.

## Scope

* `find` returns zero results → Claude should ask a clarifying question, not guess
  (system-prompt-level guidance + a UI state for "assistant is asking a follow-up").
* Hop cap hit (3 tool calls, no final answer) → surface a clear "couldn't find enough in 3 lookups,
  can you narrow this down?" message — graceful give-up, not a silent failure or a forced
  low-quality guess.
* Tool execution error (e.g. `get_resource` on a deleted/inaccessible id) → fed back to Claude as a
  tool result so it can recover within the remaining hop budget, instead of crashing the turn.
* Telemetry: extend HEL-401's goal→proposal→apply outcome tracking to also record tool calls per
  turn and whether the hop cap was hit.

## Acceptance Criteria

- [ ] Each of the three failure modes above has a deterministic test (fake tool executor returning
      the relevant failure/empty-result shape) and a defined UI state, not an unhandled exception.
- [ ] Telemetry records tool-call count and hop-cap-hit rate per conversation turn, queryable the
      same way HEL-401's existing outcome telemetry is.

## Context / Notes

- Parent epic: HEL-659. Eighth and final child ticket; delivery order 660→661→662→663→664→665
  (two PRs, reopened post-merge)→666 (two PRs, fold-in addendum)→667 (this ticket).
