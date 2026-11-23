## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: 3418a9cd63c71c2b6076405fa3cb42a586345f11 (base 032321ada8880dbfce4a1197c28e34d55b964388, resolved live via
resolve-review-base.sh). Commits: 142de4c9c (red e2e), 3418a9cd6 (implementation + jest tests).

### Phase 1: Spec Review — PASS
- AC1 (failing test, no blank gap at 390/768/1100, light+dark): `e2e/hel1819-form-live-region-gap.spec.ts:154` checks
  `submit.top - lastField.bottom <= rowGap + 1` with rowGap read from computed style, per theme at all three widths.
  Committed red first (142de4c9c). The red log (`evidence/red-e2e.txt:22,48`) shows 36 px vs a 12 px gap at 390 px in
  both themes. The per-width loop stops at the first failure, so the red run only shows 390 px. `heights-before.json`
  shows the +24 px at 768 and 1100 too. My green run passed at all widths.
- AC2 (messages still render and are announced): the spec's test at line 201 asserts the same pre-mounted element,
  its role, `position: static`, visible, between the last field and Submit, for both the status and the alert. The AT
  announcement itself cannot be measured; the role plus the same mounted node is the proxy, as design.md states.
- AC3 (other kinds keep their height): my run's per-kind table (`heights-eval.json`, persisted at
  `/home/matt/Development/helio/.concertino/runs/HEL-1819/evidence/e2e-evidence/HEL-1819/heights-eval.json`) is
  byte-for-byte the same as the executor's `heights-after.json` after a sorted-key comparison. Compared with
  `heights-before.json`, only the multi-field form changes (-24.0 px at each width); the compact counter and every other
  kind are 0.0. hel1791's full spec (compact counter) also passes unedited.
- AC4 (scope addition, fails first): jest `FormPanelView.test.tsx` "HEL-1819 a". The red log (`evidence/red-jest.txt`)
  shows it failing on the unmodified TSX. I also checked by reading the code: on the base, the indeterminate branch
  never calls `setExternalErrors`, and `reconcileValue` never clears errors, so the final assertion has to fail.
  "Not red" is covered because the colour depends only on `[aria-invalid="true"]` (`CounterControl.css:27`), as
  design.md D2 says.
- No AC was reinterpreted. All tasks are ticked and match the diff. The scope is tight: four frontend files and one new
  e2e spec. hel1791 is unedited, as the lane constraint requires. No backend, schema or migration change.
- Spec deltas match the implementation (burst = click started with an empty pending set; a same-burst rejection keeps
  its error). `openspec validate collapse-form-empty-live-regions --strict` reports the change as valid.
- workflow-state `CONSTRAINTS: []`. The lane constraints are honoured in the diff: e2e in a new spec, frontend only.

### Phase 2: Code Review — PASS
Gates, run fresh by me in WORKTREE_PATH:
- `npm run lint`: exit 0. `npm run format:check`: exit 0. `npm run typecheck`: exit 0.
- `npm test` (3 workers): exit 0. Root 73/73 suites, 645 tests. Frontend 920/920 suites, 10606 tests.
- `npm --prefix frontend run build`: exit 0.
- `check:e2e-user-cleanup`, `check:e2e-evidence-paths`, `check:e2e-types`: all clean.

Review:
- CSS (`FormPanel.css:10-11,28-30`) mirrors HEL-1804's rule. The child combinator keeps the compact counter's regions
  (children of `.form-panel-view__compact-counter`) out of the new rule, and the unchanged compact heights confirm it.
  There is no `display`/`visibility` change. The token and design rules hold: no new values; `position` only.
- TSX: `onReconciled` runs only on the applied path (the generation check passed and the pending set is empty), never
  on a catch or a discarded result. `burstRejectedRef` is reset only when a click starts with nothing in flight, and set
  on a definite rejection. This matches D2 and the spec's "same burst keeps its error" rule. `setExternalErrors({})`
  clears every field, which is safe because the compact counter has exactly one field. The success and rejection
  branches are unchanged.
- Tests: (a) is a real regression test. (b) and (c) are labelled GUARDs and name their mutations. I checked the
  mutation reasoning against the code: dropping the burst guard clears the error in (b), and calling the clear from the
  catch clears it in (c). The executor's `mutation-b.txt` and `mutation-c.txt` each show 1 failed. I did not re-run the
  mutations myself, because that would mean editing the code under review. `FormPanel.css.test.ts` is labelled a
  source-shape guard, and the e2e is the real proof.
- Comments follow CONTRIBUTING's comment standard: they record hazards and the reason for the rule, with the decision
  written out next to each ticket reference. No dead code, no TODOs, no `any`.

### Phase 3: UI Review — PASS
- Servers started with `start-servers.sh` and checked with `assert-phase.sh servers`: PASS. I stopped them with
  `stop-servers.sh` and confirmed both ports were free afterwards.
- `npx playwright test e2e/hel1819-form-live-region-gap.spec.ts e2e/hel1791-compact-counter-stack-height.spec.ts
  --workers=2`: 10 passed, none flaky. This covers both themes at 390/768/1100: the empty-region gap, the status
  ("The row was added.") and alert ("HEL1819 rejected submit") rendering in flow in the same mounted regions, and
  the per-kind heights for both specs.
- Residual: I did not log browser console output during the e2e flows, and the lane DB has no dev account for a
  manual MCP pass. The change adds one CSS rule and one callback, so the risk of a console error is very low.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- `FormPanelView.tsx` is now 481 lines, past CONTRIBUTING's ~400-line threshold, where the guide asks for a split
  proposal in the PR description. Mention it in the PR, for example extracting `handleImmediateStep` and its
  reconciliation into a hook. HEL-1618 is next on this file.
- The ticket says 1100 px is measured "sidebar open". The new spec relies on the default shell state at 1100 px, as
  hel1791 does, and does not assert that the sidebar is open. The spec's header comment could say so.
- The red e2e only shows 390 px, because the loop stops at the first failure. `expect.soft` would show the red at
  every width in one run.
- `openspec/changes/collapse-form-empty-live-regions/` is still untracked. Make sure the delivery archive step commits
  it.
