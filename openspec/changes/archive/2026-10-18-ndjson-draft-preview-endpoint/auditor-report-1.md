## Auditor Report

### Condition 1-3 (check-merge-readiness.sh)
- Exit 4 (STALE), no merge performed:
- STALE evaluator reviewed=dc43a2059 head=81796d6ac changed=<14 paths: ApiRoutes.scala, DraftPreviewRoutes/Service/Gate/Config/Limits, PivotStep.scala, StringBudget.scala, DraftPreviewHeapSpec/ResetLeakSpec/WalkSlotSpec, StringBudgetSpec, DraftPreviewBoundFixture, CLAUDE.md>
- STALE skeptic reviewed=fddd4537b head=81796d6ac changed=backend/src/test/scala/com/helio/api/routes/pipelines/DraftPreviewHeapSpec.scala
- Also observed: origin/main (d0c600fbf, HEL-1668) is NOT an ancestor of HEAD; the branch is one commit behind. Merge rule requires it be an ancestor.

### Condition 4 (acceptance criteria, traced cold)
- Not performed; verdict is decided by the staleness gate.

### Verdict: STALE

### Reason
- Evaluator: its only PASS (cycle 5) is at dc43a2059. Production source (DraftPreviewRoutes/Service/Gate, PivotStep, StringBudget, etc.) changed afterwards during final-gate rounds 2-3 and no evaluator run covers it. Evaluator re-run on the current head is required.
- Skeptic: CONFIRM at fddd4537b predates 81796d6ac, which edits DraftPreviewHeapSpec.scala (test only: 180 s timeout, wait-out-429 retry in previewRaw). Post-CONFIRM commits e00f4400b, 25c2486c9, 116f692d0 differ from the reviewed tree only in change-dir bookkeeping (not independently re-verified beyond the diffstat). The 81796d6ac test edit is low risk but is a reviewed-source change the gate has not seen; the skeptic should re-confirm, a cheap cold pass.
- Branch must also be merged with origin/main (HEL-1668 d0c600fbf) so that it is an ancestor of head, and CI re-verified on the new head.
- Owner rulings found as human escalation.answered events: extend-one-cycle-fix-here, extend-one-more-cycle-narrow-fix, extend-final-gate (all answer_source=human).
