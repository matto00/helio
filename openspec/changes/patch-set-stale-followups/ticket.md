# HEL-1522: Patch-set stale-check follow-ups: cascade coverage for output/step deletes, impact hint, double-apply, test gaps

## Description

Follow-ups left unfiled by the HEL-1458 delivery lane (PR #976, merged 34c6c6236). Each was re-verified against
main at d16e58d7e before planning (see `.concertino/runs/HEL-1522/evidence/premise-validation.md`): all seven are
still open; none was fixed by HEL-1498 (#984), HEL-1535 (#989) or HEL-1534 (#987).

1. **Cascade coverage for more delete targets.** `output` and `pipelineStep` delete targets don't yet fingerprint the
   panels and alert rules that their deletion cascade removes. The pipeline fingerprint already does this. The
   relevant cascade is `outputs.node_step_id` (V94:209).
2. **Pipeline-delete impact hint.** `PatchSetPreviewImpact.PipelineDeleteCascadeHint` should name the bound panels and
   alert rules that the delete removes.
3. **Double apply.** A create-only patch set re-entered from the refinement drawer or the assistant hand-off can still
   be applied twice.
4. **Test gaps.** Change-then-409 tests for alert-rule edits, schedule `enabled`/`timezone`, step reorder or
   reparent, Output `kind`/`nodeStepId`; an alert-rule mutation run; the run-stability guard also calls
   `updateSchemaInternal`.
5. **Spec contradiction.** The first run of an `upsertsource` step rewrites its config, so a preview taken before that
   run goes stale. This fails safe but contradicts the spec scenario "stable across a pipeline run". Document it or
   adjust the spec.
6. **Conflict UX.** Banner names stale targets by title instead of UUID; MCP tool description states the 409's edit
   index is 0-based.
7. **File size.** Split `PatchSetStaleCheckRoutesSpec.scala` (375 lines) and
   `PatchSetStaleWidenedFingerprintRoutesSpec.scala` (393 lines).

Known accepted gap, not a follow-up: a change to a secret alone is not detected (secrets are excluded from the
fingerprint by design).

## Scope of this delivery (assumed scope call, recorded)

The driver authorised splitting this ticket. This run delivers the correctness items **1-5**. Items **6** (conflict
UX: banner titles + MCP 0-based wording) and **7** (splitting the two oversized specs) are filed as a separate
Follow-up ticket (relatedTo HEL-1522) and are out of scope here. Item 6's MCP half also touches `helio-mcp/`, where
PR #990 (HEL-1524) is parked; item 7 is a pure refactor best done once this change's new tests have landed in their
own files.

## Acceptance Criteria

- AC1: An `output` delete edit's fingerprint covers the panels bound to that Output and the alert rules targeting it;
  binding/unbinding a panel or creating/editing/deleting such an alert rule between preview and apply makes the apply
  409 PATCH_SET_STALE with nothing applied. An `output` update edit's fingerprint is unchanged by those events.
- AC2: A `pipelineStep` delete edit's fingerprint covers every step the delete removes (the target and its tail
  subtrees, per the existing splice-on-delete rule) and every Output on a removed step, with that Output's bound
  panels and targeting alert rules; any change to those between preview and apply is refused with 409. A
  `pipelineStep` update edit's fingerprint is unchanged by those events.
- AC3: A `pipeline` delete edit's impact hints name the panels bound to its Outputs and the alert rules targeting
  them (the ones the delete removes), never naming a panel/alert rule the caller cannot see (counted instead), and
  omitting panels an earlier edit in the same set already deletes.
- AC4: A patch set produced by refinement or the assistant's `propose_patch_set` carries a server-minted
  `proposalId`; applying a patch set with a `proposalId` that the same user already applied is refused (409
  PATCH_SET_ALREADY_APPLIED, nothing applied); a failed/rolled-back apply does not consume the id; the review page
  shows a non-retryable "already applied" state. A patch set without `proposalId` behaves exactly as before.
- AC5: Change-then-409 route tests exist for: alert-rule edits (pipeline and output-delete targets), schedule
  `enabled` and `timezone`, step reorder and step reparent, Output `kind` and `nodeStepId`; each new fingerprint
  coverage has a recorded mutation run (removing the covered field turns its test red); the run-stability tests also
  call `OutputRepository.updateSchemaInternal` between the previews and still see an unchanged fingerprint.
- AC6: The `patch-set-stale-check` spec states that the first run of an `upsertsource` step targeting a new source
  rewrites that step's config, so a preview taken before that run is refused as stale (fail-safe), and a test pins it.
- AC7: Items 6 and 7 are filed as a Follow-up ticket related to HEL-1522.
