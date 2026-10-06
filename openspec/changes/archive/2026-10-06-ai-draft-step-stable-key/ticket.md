# HEL-1321: AI draft steps collapse on temp-id swap (same bug as HEL-1294, handleStepConfigChange path)

## Description

origin_kind: followup / origin_ticket: HEL-1294

HEL-1294 fixed a bug in the pipeline editor. Step cards are keyed by `step.id`, and expand state lives locally in
`StepCard`. When an optimistic temp-id card (`step-N`) was swapped for the server step after the create POST plus the
`syncStepsFromServer` GET, the card remounted collapsed. Any edit made during that window was dropped silently.

The fix tracks in-flight creates for `handleInsertStep` and `handleAddLaneStep`, and disables the expand toggle while a
create is in flight.

The HEL-1294 lane reports that **AI draft steps** take the same path when a draft is created on config completion
(`handleStepConfigChange`, about line 1078 in `usePipelineDetailPage`). The temp card is swapped for the real one and
remounts collapsed. Verify this against main.

## Acceptance Criteria

- Reproduce it with a deterministic probe. Delaying the post-create steps GET was the technique HEL-1294 used.
- Apply the same in-flight tracking to this path, or a general fix that covers all temp-id create paths. One option is
  a stable React key that survives the id swap; if you go that way, explain why it is safe.
- Add an RTL test that is red without the fix.
- Make no change to the existing HEL-1294 behaviour.

## Premise validation (orchestrator, against main 90f8a949c)

See `.concertino/runs/HEL-1321/evidence/premise-validation.md`. Verdict: minor-staleness. The draft path does not call
`syncStepsFromServer`: the swap is an in-place `setSteps` in the create POST's `.then`, so the probe must delay the
create POST, not a steps GET. HEL-1294's disable-the-toggle mitigation cannot apply: the draft card is already expanded
(the user is editing it) when the create fires. Code reading also suggests edits made while the draft POST is in flight
are kept locally but never PATCHed (temp-id PATCH is skipped), which the probe must confirm or refute.
