# HEL-1523: Step reference-check follow-ups: rollback pin, reorderSteps cycles, create-position anchor, existence probe, picker polish

## Description

Follow-ups the HEL-1515 delivery lane reported but didn't file (PR matto00/helio#974, merged 7359a676a). Re-verify each against main before starting. The cut scope (cycles through lane links, picker disabling) is already HEL-1521.

1. **Correctness:** `reorderSteps` can make a stored lane reference cyclic. The new descendant check runs on create and update only.
2. **Correctness: create `position` arm.** It takes ancestors from the last trunk step but anchors the insert at the position before it.
3. **Security-ish (predates the PR): create's lane check runs before the pipeline access check,** so a caller can probe whether a step exists.
4. **Test gap: rollback.** No test pins the rollback outcome. Rollback of a failed apply that deleted a tail-adjacent lane step now leaves that step deleted (`unrecoverable`) rather than restoring an unrunnable pipeline. Undo and rollback recreate steps without `attachAsTail`.
5. **Optional test:** an edit that is both stale and cyclic should get the HEL-1458 409 first.
6. **Duplication:** the ownership check is still copied in `PipelineCreateTransaction` and `PatchSetPipelineStepResolvers`; route both through `StepReferenceChecks`.
7. **Picker polish:** the picker keeps showing a rejected choice; the message shows a raw step UUID; `saveErrorIsValidation` is not passed.
8. **e2e:** `hel908-tail-attach` tests 2-4 look repairable by locator alone; that would restore step-duplicate e2e coverage (HEL-962). Test 1 asserts the one-tail-per-step rule that HEL-912 removed and needs a rewrite.
9. **Wording:** a few frontend comments and the archived proposal and tasks still say "dependent" instead of "descendant".

## Acceptance Criteria (this delivery -- assumed scope call, see proposal.md)

Delivered here (correctness + security + backend test gaps):
- AC1 (item 1): a trunk reorder that would make any step's stored `lane` reference name that step's own ancestor or descendant is rejected (400, naming the cycle) and nothing is persisted; a reorder that introduces no new such violation is unaffected.
- AC2 (item 2): a create with a bare `position` (no `parentStepId`/`rootId`) computes the lane check's ancestors from the SAME anchor the insert uses (`current(position - 1)`, or none at position 0).
- AC3 (item 3, security): a step create with a `lane` reference on a pipeline the caller cannot edit returns the same response whether or not the referenced step exists (no existence probe); proven red-first.
- AC4 (item 4): a test pins the patch-set rollback (and undo) outcome when a failed apply deleted a tail-adjacent lane step.
- AC5 (item 5): a test pins that a patch-set edit that is both stale and cyclic gets the HEL-1458 409 `PATCH_SET_STALE`.
- AC6 (item 6): `PipelineCreateTransaction` and `PatchSetPipelineStepResolvers` call the secondary-source ownership check through `StepReferenceChecks`; observable messages unchanged.

Deferred to a Follow-up ticket (assumed scope call): items 7 (picker polish), 8 (hel908-tail-attach e2e repair), 9 ("dependent" wording).
