## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)
- HEAD 227ae4f9; diff vs live base 9c247cf6. No e2e/, playwright.config.ts, or ci.yml in the diff (git diff --name-only grep empty). No hel958 spec edits; no quarantine.
- (1) Race: markCreating(temp,true) is set synchronously in the same handler tick as the optimistic setSteps(temp) (batched, so the temp card never renders enabled). Cleared in finally, after `await syncStepsFromServer()`, whose setSteps(fresh) runs before the finally in the same microtask chain. Any intermediate render has either (temp present, disabled) or (temp gone; persisted card has a new id, not in the set, enabled and already mounted collapsed). No render pairs a stale temp card with an enabled toggle, and the converse is harmless. Failure path: finally re-enables the kept temp. Both handleInsertStep and handleAddLaneStep covered; AI drafts (no POST) correctly untouched.
- (2) Load check I ran myself: 3 nice-19 busy loops (PIDs recorded, killed by exact PID), `playwright test e2e/hel958-join-step-editor.spec.ts --repeat-each=30 --workers=2` against 6726/9633 => 30 passed (1.5m). Evaluator's 20/20 without load is consistent. The executor's 4/30 -> 0/30 baseline and the P1 traces I did not replay (probe spec deleted); the fix mechanism is sound by reading, and 30/30 under load is independent corroboration. Not run: 4-leg sharding (no CI per rules).
- (3) RTL: jest on PipelineDetailPage.creatingStep + PipelineDetailPage.test = 134 passed. Evaluator's mutation (product files reverted => 3 failed/1 passed, the passer being the AI-draft control) is plausible: tests hold the resync on a deferred promise, assert disabled + no editor, then PATCH of the real id; they exercise the right branch.
- (4) Change to "removing a step" test: the old test expanded the temp card immediately, which is the exact buggy behavior; the new one rejects the create so the kept local step is expandable and still asserts removal. Justified; failed-create re-enable is separately covered.
- (5) UI: only CSS is a :disabled rule (opacity/cursor) plus :hover:not(:disabled); no new tokens/hardcoded colors. Did not take screenshots; the change is a disabled-state affordance on an existing control, no layout change.

### Verdict: CONFIRM

### Non-blocking notes
- The AI-draft create path (~line 1078, `.then` swapping temp id for persisted) has the same remount-collapses-card shape but is outside this ticket (hel958 is join, a non-draft kind). Consider a follow-up.
- Disabled opacity 0.6/cursor:progress differs from sibling disabled buttons (0.35/0.5, not-allowed); title-only reason is hover-only.
- P1 trace/4-of-30 claims remain executor-reported; my own evidence is the 30/30 under-load run and code reading.
