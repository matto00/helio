## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

- All AC items addressed: (1) full keyboard-only submit against running app — verified myself by
  re-running the spec against the live dev server, not just trusting the executor's report; (2) tab
  order across all 8 field types incl. file+counter — spec test 1 walks every control in authored
  order with real `Tab` presses except one documented `date`-widget CDP limitation (see below); (3)
  focus on submit/success/server-rejection — spec test 2, independently mutation-confirmed (see Phase
  2); (4) computed live-region text-change measurement — spec test 4, read directly, not inferred;
  (5) panel role/name via computed AX tree — spec test 3 uses `page.accessibility.snapshot()`,
  genuinely computed state, not `toHaveAttribute`; (6) HEL-1158 three-finding re-measurement — spec
  test 5, values matched my own fresh run (dark overflowPx=403.19, light overflowPx=-11.81, matching
  the executor's reported "still holds in dark theme only, ~403-423px").
- No AC silently reinterpreted. The `date`-field-Tab-trap workaround (`.click()` instead of `Tab`) is
  explicitly documented in the spec's own comment as an automation/CDP-only limitation, reproduced on
  bare HTML with zero Helio code, and every other transition in the same test remains a real `Tab`
  keypress — this is a legitimate, disclosed exception, not scope creep or a silently weakened claim.
- Tasks 1-6 all marked done and match what was implemented; nothing appears done-but-unimplemented.
- No scope creep: the only production code touched is the one submit-button focus-loss defect
  (`FormPanelView.tsx`/`FormPanel.css`), directly required by Requirement 2 of the new spec delta.
- No regressions to existing behavior: `:hover:not([aria-disabled="true"])` and
  `[aria-disabled="true"]` selectors are behavior-preserving replacements for
  `:hover:not(:disabled)`/`:disabled` — same visual states, same tokens (`--app-accent-strong`,
  `cursor: not-allowed`, `opacity: 0.7`), confirmed by reading the diff directly.
- No API/schema changes needed or made; none claimed.
- Planning artifacts (ticket/proposal/design/tasks/spec-delta) all match the implemented behavior;
  read directly, no discrepancy found.
- No non-retired `workflow-state.md` CONSTRAINTS entries found beyond C7/C8, both honored (see Phase 2).

### Phase 2: Code Review — PASS

Gates run myself, fresh, in `WORKTREE_PATH` (no `CLEAN_WORKTREE` set this run):
- `npm run lint` — pass, zero warnings.
- `npm run format:check` — pass.
- `npm test` — 28+332 suites, 271+3630 tests, all pass (helio-mcp + frontend).
- `npm --prefix frontend run build` — succeeds (pre-existing >500kB chunk warnings only, unrelated
  to this change).

Diff-level review (`git diff 3471d891...HEAD`, resolved fresh via `resolve-review-base.sh`):
- `FormPanelView.tsx`/`FormPanel.css`: minimal, correctly scoped fix — `aria-disabled` in place of
  native `disabled`, with the re-entrancy guard already handled by `handleSubmit`'s/
  `handleImmediateStep`'s own `submitState === "pending"` early-return (confirmed present at
  FormPanelView.tsx:115,154). No dead code, no untyped escape hatches, no magic values. CSS change is
  a pure selector swap, tokens untouched (`--app-accent`, `--control-sm`, `--app-radius-sm`, etc. all
  still in place per direct read).
- **C7 independently reproven, not just trusted**: I mutated the exact fix back to native `disabled`
  and reran the new spec's focus-management test — it failed exactly as the executor's report
  describes (`toHaveAttribute("aria-disabled","true")` received `""`, i.e. the attribute silently
  vanished because focus/state tracking broke). Restored byte-identical (`git diff` on the file is
  empty after restore). This is a genuinely load-bearing, mutation-provable fix, not a decorative one.
- **C8 honored**: every assertion I read in the new spec queries computed state — `toBeFocused()`,
  `toBeChecked()` (explicitly not `aria-checked` attribute, per the test's own comment),
  `page.accessibility.snapshot()` for role/name, `alert.textContent()` before/after for live-region
  text. No assertion found that checks mere attribute/DOM presence in place of computed state.
- DRY/readable/modular: new e2e spec reuses `hel1087-form-submit-path.spec.ts`'s established
  harness shape (register/login via API, seed dataset/dashboard/panel), no unnecessary duplication.
- No stray uncommitted files or shared-DB fixture leakage found in `git status --porcelain` in either
  the worktree or the main checkout.

### Phase 3: UI Review — PASS

Ran the canonical `start-servers.sh`/`assert-phase.sh` (both reused already-healthy servers), then
ran the new spec myself against the live dev server (not trusting the executor's reported 5/5):

```
5 passed (20.1s)
[HEL-1158 remeasure][dark] overflowPx=403.19
[HEL-1158 remeasure][light] overflowPx=-11.81
[HEL-1158 remeasure] same-frame clear/refill: STILL HOLDS (unchanged)
[HEL-1158 remeasure] duplicated error text: duplicated=true — STILL HOLDS (unchanged)
```

- All 5 tests pass on a fresh run I executed directly.
- HEL-1158 re-measurement independently confirmed: submit-below-fold still holds in dark theme only
  (~403px overflow, matches claimed "403-423px" range) and does not block keyboard reachability
  (`submitButton.focus()` + `toBeFocused()` succeeds regardless); light theme shows no overflow
  (-11.81px, i.e. within bounds); same-frame re-announcement and duplicated error text both
  reconfirmed still holding, with the harness's stated real-AT-unmeasurability limitation disclosed
  explicitly rather than asserted as a pass.
- No console errors surfaced by the Playwright run (no test failures, no unhandled route errors).
- Keyboard/accessible-name checks: `getByRole` resolution throughout the spec depends on real
  accessible names computed from labels/ARIA, not test-ids — this is itself an accessible-name proof
  for every field.
- Checked both worktree root and main-checkout root for stray screenshots: none from this cycle; the
  `.playwright-mcp/` directory at the main-checkout root is pre-existing, gitignored accumulation from
  unrelated prior sessions (dated across many days, none matching HEL-1090), not introduced by this
  cycle.
- Confirmed no ticket duplicating HEL-1158 was filed (report references HEL-1158 as the sole tracking
  ticket throughout; no new ticket ID appears anywhere in the diff or files-modified.md).

### Overall: PASS

### Non-blocking Suggestions

- The `date`-field Tab-trap workaround is well-documented, but consider filing a small follow-up note
  (not required by this ticket, and explicitly a non-goal to file new tickets here) if this Playwright/
  Chromium CDP limitation on `<input type="date">` is likely to recur in future e2e specs that need to
  tab past date fields — a shared comment/helper would save re-deriving the same probe each time.
