## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (HEAD e184391c)
- CR1 (e2e path): tasks 1.2 now names repo-root e2e/hel1007-multi-root-reorder.spec.ts and requires `npx playwright test --list`; playwright.config.ts:22 testDir is ./e2e; hel908-* siblings live there. Resolved.
- CR2 (focus): design Decision 4 now clears pendingFocus on consume and on every no-commit path (!id, CR2 refusal, failed PUT rollback), locates buttons via data-step-id, and tasks 3.5 adds the stale-focus component test. Resolved.
- CR3 (root-0-relative sites): Decision 1a enumerates drop indicator, per-card onDragOver/onDrop, real stepIndex (vs -1), position-aware edge-disabling, cross-lane drop ignored, one-step root trunk lane behavior. Resolved.
- CR4 (e2e sweep): tasks 3.4 covers e2e/hel908-step-card-split.spec.ts and hel908-trunk-reorder-order.spec.ts (grep confirms these are the only e2e files matching "Move step"; jest files PipelineRiverView/StepCard/PipelineDetailPage tests also match and are covered by the Decision 3 "existing tests updated" line). Resolved.
- CR5 (name ambiguity): Decision 3a records the accepted trade-off; spec scenario uses distinct names. Resolved.
- Spec delta (pipeline-lane-editor-ui) is consistent with design: every-root reorder, no cross-lane, branch lanes no controls, lane-named labels, focus, persistence. No placeholders/contradictions found; all ACs (wire all roots, remove NOOP_MOVE, verify payload, CR2 coverage, accessibility/e2e/themes) map to tasks 2.x/3.x/4.1. CR2-guard plan escalates rather than fabricates if unreachable.

### Verdict: CONFIRM

### Non-blocking notes
- Task 4.1 does not restate the e2e path; 1.2 is authoritative.
- Drag is covered only at component-test level (labelled in design Risks).
