# HEL-1422: Step editor polish after HEL-1416: fillnull error spacing, dropdown keeps rejected value, validator comment, lag/lead error order, op-spec write-time scenarios

## Description

origin_kind: followup
origin_ticket: HEL-1416

From HEL-1416 (ce6991111, save-time enum rejection for fillnull/window/pivot). Verify each.

1. In the fillnull editor, the 422 InlineError sits flush under the strategy select, while window and pivot leave a gap. Make them consistent (DESIGN.md spacing token).
2. After a rejected save, the dropdown keeps showing the rejected choice instead of the saved value (pre-existing). Revert to the saved value, or keep the choice and mark it invalid; pick one per DESIGN.md form-error pattern.
3. The comment above `validatePivot` is worded differently from the fillnull/window validators.
4. At run time, a lag/lead step now reports a bad offset before a missing `field`. Decide the order that is most useful to the user.
5. Optional: add write-time scenarios to the fillnull/window/pivot op specs, as HEL-1310 did for aggregate.

## Acceptance Criteria

- AC1: The fillnull editor's rejected-save InlineError is separated from the control above it by the same tokenized gap as the window and pivot editors (`--space-5`, from the shared `pipeline-detail-page__aggregate-config` container), verified in the running app in both themes.
- AC2: After a rejected save, the fillnull/window/pivot editor keeps the user's chosen value (no revert) and marks the offending control invalid: `aria-invalid="true"` and `aria-describedby` pointing at the rendered InlineError's id. The mark clears when the error clears (next save attempt).
- AC3: The pivot validator comments (`PivotStep.validateRawConfig` doc, `StepConfigValidation.validatePivot` inline comment) are worded the same way as their fillnull/window counterparts. Comment-only; no behaviour change.
- AC4: At run time, a `lag`/`lead` step missing `field` AND carrying a non-positive `offset` fails with the missing-`field` error (the pre-HEL-1416 order, and the order analyze already reports). Every other WindowStep error stays unchanged.
- AC5: The fillnull, window and pivot op specs gain write-time validation scenarios in the HEL-1310 aggregate pattern, plus the run-time error-order scenario for window and the rejected-save editor scenario.
