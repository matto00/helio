## Context

See proposal.md (Why). `usePipelineShapeInstantiation.handleInstantiateShape` (HEL-1481 split) creates each shape step
via `createPipelineStep` and appends `pipelineStepToStep(persisted)` to local `steps`, ignoring
`persisted.reparentedStepIds`. The ordinary create path (`usePipelineStepCreation.applyCreated`) applies a create's
delta with `applyCreatedStep` (HEL-1345 D5), keeping a hook-local `pendingParentRef` (reparent claims for steps not yet
present locally) and `userRemovedTempIdsRef`. Bottom "+ add step" already splices after trunk-last with `{rootId}`
(`insertWireArgs`), and the backend reparents the trunk-last's lanes; the editor reflects it via `applyCreatedStep`.
The owner chose to give the shape apply the same semantics (escalation answer "b", 2026-10-12).

The live spec `pipeline-shape-instantiation-ui` still says a shape against a step with a child is seeded as a new tail
(tail-attach). That has been false since HEL-912 (the hook always splices); the delta corrects it.

## Goals / Non-Goals

**Goals:** editor structure equals server structure immediately after a shape apply (full or partial); drafts and open
card state survive; one shared delta-application path, not a second hand-rolled one.

**Non-Goals:** any backend change; changing what the shape creates on the server; options (a)/(c)/(d).

## Decisions

1. **Apply each create's delta with `applyCreatedStep`, per create, inside the loop.** Each POST's response is a
   complete description of that create's server-side change (HEL-1345 D5), so applying it right after the POST keeps
   local state correct at every point, including when a later create fails (partial apply). The second create in the
   repro also reports L (L moved from `sort` to `limit`); applying both in order lands L under `limit`.
   *Alternative rejected:* `syncStepsFromServer()` after the batch. It is a wholesale replace that drops local-only
   drafts and open-card config (it only carries `renderKey`s), and it adds a GET round-trip.
2. **Share the existing pending-parent bookkeeping rather than create a second one.** The shape hook should use the
   same `applyCreated` callback (or the same `pendingParentRef`/`userRemovedTempIdsRef`) that `usePipelineStepCreation`
   owns, threaded through `usePipelineStepStructure`, so a reparent claim recorded by one path is honored by the other.
   The executor picks the narrowest wiring that achieves this; a shape step has no temp id, so a synthetic,
   never-present temp id (not in `userRemoved`) takes `applyCreatedStep`'s append branch. Synthetic temp ids are unique per create and never added to
   `userRemovedTempIdsRef`. No hook-local second pending-parent map (design gate confirmed no cycle prevents sharing).
3. **No backend change.** The splice and `reparentedStepIds` are correct and already covered by
   `pipeline-step-reparent-reporting`; the defect is purely that the client drops the report.
4. **Comments.** Replace the KNOWN HAZARD blocks in `usePipelineShapeInstantiation.ts` and `PipelineRiverView.tsx`
   plus the bottom-anchor "always a leaf" comment (`PipelineRiverView.tsx` ~170-175) and the "no resync is done
   here" audit comment, with a short statement of the behavior (splice; lanes move below the shape; the editor applies
   `reparentedStepIds`). No ticket-number archaeology beyond one reference.

## Risks / Trade-offs

- [A lane's input silently changes to the shape's output] -> owner-accepted; identical to bottom "+ add step" today.
- [Concurrent lane HEL-1476 edits step-create code] -> rebase/merge origin/main before final gates; re-run tests.
- [Test that only asserts the request, not the rendered tree] -> red-first test must assert local structure
  (parent ids / rendered lane placement) after apply, and must fail on main.

## Planner Notes

- Self-approved: frontend-only scope; modifying (not adding) the shape-instantiation requirement because its tail-attach
  text is stale and directly contradicts the owner's choice.
- No migration (V126 not needed).
