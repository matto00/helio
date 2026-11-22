# HEL-1810: Session check for the remaining pipeline post-await sites (draft create flush, shape instantiation, run stream, draft undo) + same-session rollback test

## Description

origin_kind: followup
origin_ticket: HEL-1798 (PR matto00/helio#1207, merged as 0fac82ce3). The owner chose a standalone ticket.

HEL-1798 added HEL-1634's session check to eight pipeline page hooks, so work that finishes after a sign-out no longer dispatches or sends the previous user's ids. Its list of every place that continues after an `await`, `post-await-sites.md` in `openspec/changes/archive/2026-11-20-gate-pipeline-hooks-session-epoch/`, found four more places outside that ruling:

* `usePipelineDraftCreate`: the flush of an edit still in progress when a draft is created;
* `usePipelineShapeInstantiation`: the step loop when a pipeline is created from a shape;
* `usePipelineRunStream`: the handler that runs when a live run's status stream ends;
* `usePipelineDraftUndo` (around line 57).

There is also a test gap that existed before HEL-1798: no test covers the step rollback in the same session. The evaluator replaced its condition with `if (false)` and every pipelines test still passed.

## Do

* Apply the same pattern HEL-1798 used to the four places: record the session epoch when the work starts, and skip work after the `await` if it has changed. Check direct service calls too, not only `dispatch`.
* Add a test of the rollback in the same session that fails when the rollback is disabled.

## Acceptance criteria

- [ ] For each place, a test fails first: nothing is dispatched or sent after sign-out.
- [ ] The rollback test turns red when its condition is mutated.
- [ ] HEL-1634's guard and the `hel1634-logout-user-switch` e2e still pass.
