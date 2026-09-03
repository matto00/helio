# HEL-950: Join op: adding step via picker 404s on empty rightDataSourceId default (same defect as HEL-620/HEL-386)

## Description

`joinCheckF` in `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` unconditionally runs the cross-tenant ACL check (`dataSourceRepo.findByIdOwned`) against `JoinConfig.rightDataSourceId`, at both the `addStep` (L857-863) and `updateStep` (L1096-1103) call sites. An empty id therefore returns `404`, because "no source chosen yet" is resolved as "resource does not exist".

This is the THIRD occurrence of one defect: HEL-386 (lookup op), HEL-620 (union op, PR #532), and now join. `lookupCheckF` and `unionCheckF` already carry the correct guard (`case lc: LookupConfig if lc.referenceDataSourceId.nonEmpty => ...`).

An ACL check that 404s on an *empty* id is misordered, not wrong. "No source chosen yet" is a validation state that should be handled before ACL resolution runs — returning 404 implies the resource doesn't exist, which leaks a misleading status for what is really an incomplete form.

### CORRECTION — the ticket's stated repro is wrong (design gate round 1)

The ticket says the frontend picker seeds a join step with an empty id, "making the op uncreatable from the UI". **The picker cannot create a join step at all.** `frontend/src/features/pipelines/state/stepNarrowing.ts:82-84` documents the exclusion as deliberate — "OP_TYPES drives the picker dropdown — join is intentionally excluded: no `JoinConfig.tsx` editor exists (HEL-264's original rationale)" — the `OP_TYPES` array omits `join`, and `frontend/src/features/pipelines/ui/stepConfigs/` contains 20 editors including `UnionConfig.tsx` and `LookupConfig.tsx` but no `JoinConfig.tsx`. `defaultConfigFor` is reached only from `usePipelineDetailPage.ts:481,544` with an `opType` that came from the picker.

**Corrected reachability.** The empty-id join body reaches the backend from the **agent/MCP and patch-set surfaces**, not the UI. `PatchSetApplyResolvers` is therefore the reachable-today half of this defect; the `PipelineService` join cells are reachable by direct API/MCP callers. AC4's probe body is unchanged and still correct — it is exactly what `defaultConfigFor("join")` returns — only the "via the picker" framing was wrong.

**Why HEL-950 was drafted this way, and the near-miss it caused.** HEL-620 fixed union, saw join's identical unguarded code, and inferred an identical user-facing symptom. The code inference was right; the reachability inference was not. This run's own premise validation then repeated the error from the other direction: it confirmed that `defaultConfigFor("join")` returns `""` and that `handleInsertStep` forwards it verbatim — **both true** — and concluded the picker emits it, without ever asking whether `"join"` can reach `handleInsertStep`. Two individually-correct facts composed into a false conclusion, and every check performed on either fact alone came back green. This is the same family as HEL-949's conjunction finding: a claim can be false even when each premise supporting it is independently verified. Verify the *composition*, not only the parts.

## Acceptance Criteria

1. `joinCheckF` skips the ownership check when `rightDataSourceId` is empty, at BOTH `PipelineService` call sites (`addStep`, `updateStep`), matching the existing `lookupCheckF`/`unionCheckF` shape.
2. The same empty-id guard covers join AND union in `PatchSetApplyResolvers`'s pipeline-step-edit ACL triad, closing the two call sites HEL-620's fix missed.
3. The three per-op guards are factored into ONE shared helper used by every call site, so a fourth op (or a fourth surface) cannot reintroduce the defect by hand-copying. If the shared helper proves infeasible within this change's scope, the scoped fix ships and a class-closing follow-up ticket is filed — the choice and its reasoning must be stated explicitly.
4. RED FIRST: the picker's exact empty-default join body (`{"rightDataSourceId":"","joinKey":"","joinType":"inner"}`) is posted against the real running backend and the 404 observed and recorded BEFORE the fix; the same request is re-posted after the fix and succeeds.
5. The genuine cross-tenant ACL check is NOT weakened: a non-empty `rightDataSourceId` belonging to another user still 404s. Existing cross-user 404 tests still pass, and the new tests guard the ownership leg and the empty-id leg INDEPENDENTLY (each mutation must be able to turn a test red on its own, not only in conjunction).
6. Live end-to-end verification at the surface where the defect is actually reachable, in two parts, with the RED demanded on the first:
   a. **RED-FIRST, MANDATORY, deterministic.** `POST /api/patch-sets/apply` with a `pipelineStep` update edit whose `UnionConfig.otherDataSourceId` is `""` MUST be rejected against the UNFIXED code (this is the cell HEL-620 missed, unguarded today) and MUST succeed after the fix. The same probe MUST be recorded for `JoinConfig.rightDataSourceId: ""`. An AC rewritten to be performable is worthless if it passes either way — record the red before the green, verbatim.
   b. **UI regression guard, explicitly labelled as a guard and NOT as the red proof.** Through the running UI: add a `union` step from the op picker (union IS in `OP_TYPES`) and choose its other source. This exercises the already-guarded `PipelineService` union path and proves the shared-extractor rewrite did not regress the ops that were previously correct. It is not evidence for the join fix and must not be reported as such.
   c. A UI walkthrough of the patch-set apply path is deliberately NOT required: the frontend reaches `/api/patch-sets/apply` only via `PatchSetReviewPage`/`ProposalHandoff` with an assistant-generated payload, so it cannot deterministically produce an empty second-source id. Do not fake one, and do not claim UI evidence for the patch-set cells.

## Notes for reviewers (lessons from HEL-879/886/949)

1. Any fixture or test datum changed to accommodate new behavior must answer "why did this need to change?"
2. Check the implementation against the LITERAL wording of the ACs above. "Stricter than asked" and "looser than asked" both read as reasonable and both pass a careless review.
3. The MECHANISM is constrained, not just the outcome: the guard must skip the ACL check on empty, and must not alter the check's behavior for any non-empty value.
4. Absence of the gate you looked for is not absence of coverage; a green gate may scan nothing. Check what a gate actually scans before citing it.
5. A test guarded only by a CONJUNCTION of two mutations independently guards neither. Break each leg alone as well as together.
6. Do not blanket-update expected values to match new output; diagnose each changed assertion individually.
