## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)
- Source on HEAD 9c247cf6: handleInsertStep (usePipelineDetailPage.ts ~734) and handleAddLaneStep (~803) are the only two makeStep callers (grep), both await createPipelineStep then syncStepsFromServer, which replaces the whole list (setSteps(freshSteps...)). Draft early-return (requiresCompleteConfigForCreate) precedes the try, so a finally-based exit does not affect it. Matches design.
- StepCard: `expanded` is local useState(false) (:174); the only setter is the toggle (:211); no other path auto-expands, so disabling the toggle closes the window. Toggle is a native <button> (:232), so `disabled` blocks pointer and keyboard.
- <StepCard render sites: LaneColumn.tsx:203, :253 and PipelineRiverView.tsx:360 (RootColumn only passes through). Design's grep-enumeration instruction covers them.
- Failure path: catch keeps temp step; a finally-cleared set re-enables the toggle, so the derived-from-isTempStepId alternative is rightly rejected.
- e2e spec: click on "Join tables" button .first() auto-waits for enabled and re-resolves after remount; unchanged spec is consistent with the fix. Spec ordering (created -> click -> patched armed after click) matches the trace reading in premise-validation.md.
- Constraints respected: no edits to playwright.config.ts/ci.yml/other specs; no quarantine/loosening; RTL red-without-fix planned (D4 a); P1 stop-condition gates the product edit; N>=30 planned.

### Verdict: CONFIRM

### Non-blocking notes
1. P1's page.route must delay only the GET /steps issued AFTER the step POST (initial page-load GET /steps must pass undelayed); the design says this, make the probe enforce it (flag set on POST).
2. Use functional setState for creatingStepIds add/remove so overlapping creates do not clobber each other; clear in finally even when syncStepsFromServer rejects.
3. Disabled toggle has no explanation for AT users; consider title/aria-describedby per DESIGN.md's disabled pattern, no new tokens. Verify a :disabled style exists on the toggle (it currently has none of its own).
4. tasks.md has an empty "Standing Constraints" heading, and 3.3 "lane-add covered" is vague; D4's hook-level fallback should be made the explicit acceptance signal.
5. A local P2 rate of 0 is likely; the "reproduction under load" AC rests on P1 (deterministic) -- state that explicitly in the final report. The AI-draft swap follow-up is noted but unfiled; consider filing it.
