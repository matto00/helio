## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD a2ae646ebb9420e239740c70de9be4a7dbc0e7e0 (planning artifacts uncommitted in change dir).

### What I verified (with evidence)
- cwd guard: `assert-cwd.sh` -> READY branch=bug/duplicate-double-click-guard/HEL-706.
- Read ticket.md, proposal.md, design.md, tasks.md, and all three delta specs in full.
- Round-2 CR1 (StepCard render sites): `grep -rn "<StepCard" frontend/src` returns exactly
  PipelineRiverView.tsx:399, LaneColumn.tsx:175, LaneColumn.tsx:218 (plus StepCard.test.tsx only).
  RootColumn.tsx: no StepCard references; it imports/renders `LaneColumn` (line 95) and passes
  `onDuplicateStep` through (line 108). design.md Decision 3 and tasks.md 1.5 now match.
- Round-2 CR2 (prop naming): the new StepCard prop is `isDuplicating` throughout design.md and
  tasks.md. Remaining `disabled` mentions refer only to `ActionsMenuItem.disabled` (confirmed at
  ActionsMenu.tsx:10, :37, :138) or the existing step enable/disable toggle — no leftover ambiguity.
  No "four" render-site references remain.
- Round-2 CR3 (test shape): ActionsMenu.tsx:74-75 confirms `close()` runs before `item.onClick()`;
  tasks 2.2 and 2.3 both describe reopening the menu between activations and each states its own
  fails-without-guard check.
- StepCard is `React.memo` (StepCard.tsx:111), supporting the boolean-prop rationale; duplicate
  button is a plain `<button>` (StepCard.tsx:285-287).
- AC coverage: AC1 (one clone) -> tasks 1.1-1.5 + spec double-activation scenarios; AC2 (re-enable
  on success/failure) -> hook finally-cleanup + tests 2.1-2.4; AC3 (tests per surface) -> 2.2/2.3/2.4;
  AC4 (synchronous guard) -> ref-based Decision 1 + 2.1 same-tick unit test. No scope drift; no
  API/schema change so no contract delta needed.

### Verdict: CONFIRM

### Non-blocking notes
- Task 2.4: once the button is `disabled` after a re-render, a second RTL click is swallowed by the
  DOM, which can mask a missing ref guard. The fails-without-guard check should remove the ref
  check specifically (or fire both activations before React re-renders), so the test proves the
  synchronous guard rather than the disabled attribute. Task 2.1 covers the ref path directly, so
  AC4 is still traced.
- `frontend/src/hooks/` exists (README.md, useIsNarrowerThan.ts, etc.), so the new hook location
  fits existing layout.
