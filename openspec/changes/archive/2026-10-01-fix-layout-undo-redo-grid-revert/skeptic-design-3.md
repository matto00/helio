## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)
- Read ticket, proposal, design, tasks, spec delta, skeptic-design-2.md, and current useLayoutSave.ts.
- Round-2 CR1 (non-interaction layout changes would become unrequested PATCHes) is resolved: Decision 2 keeps the default re-baseline in the resolvedLayout effect (matches current useLayoutSave.ts effect) and skips it only for the interaction commit (localCommitRef) and undo/redo (revision counter). Spec has a "Panel created" scenario; tasks 2.1 pins panel create/delete/refetch -> no PATCH, no pending.
- All four ACs trace to tasks/spec: undo, redo, CommandBar buttons, real-browser Playwright spec with rendered boundingBox, red-on-main then green. Keyboard bindings left out of scope. No placeholders or contradictions.
- RGL stop-before-change ordering was confirmed in round 2 and the design builds on it.

### Verdict: CONFIRM

### Non-blocking notes
- Implementation must still set latestLayoutRef = resolvedLayout in the two skip branches (current effect does this); otherwise drag/undo/flush would send the dragged layout. Design implies it; make it explicit in code and a unit test.
- Edge: drag (committed to store, dirty), then a non-interaction change (panel create) before flush hits the default re-baseline, setting persisted = resolved (which includes the drag) and clearing pending, so the drag is never PATCHed. Previously the drag was visually lost in that case; now it is visible but unsaved. Consider a unit test and, if cheap, keeping persisted un-advanced while localCommitRef-derived dirt is outstanding.
- localCommitRef should be cleared when consumed/after PATCH to avoid a stale spurious match against a later equal layout.
- Late PATCH response overwriting a newer drag remains pre-existing, out of scope.
