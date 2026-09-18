## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

- All ticket ACs addressed: six controls (text/textarea/number/date/select/checkbox) render on the
  panel body sized for a grid cell; every field is keyboard-reachable/completable; every field has a
  computed-accessible-name label; errors are associated via `aria-invalid`/`aria-describedby`
  resolving to `toHaveAccessibleDescription`. Verified directly in `FormFieldControl.test.tsx`,
  `FormPanelView.test.tsx`, and the Playwright spec — no AC reinterpreted.
- Tasks 1.1–4.9 all marked done in `tasks.md` and match the diff (`git diff --stat` against base
  `9f6f4d41`): `PanelPacker.Bounds` form clamp, `TextField`/`FormField`/`Select`/`Toggle` primitive
  extensions, `formFieldValidation.ts`, `useFormPanelValues.ts`, `FormFieldControl.tsx`,
  `FormPanelView.tsx`/`FormPanel.css`, `FormRenderer.tsx`, `PanelContent.tsx` dispatch, `PanelContent.css`
  variant, and the full test suite including the E2E spec.
- No scope creep: `openspec/changes/form-field-renderers/` and the file list above are exactly the
  set `files-modified.md` claims; nothing touching HEL-1086 (file upload), HEL-1087 (submit), or
  HEL-1088/1089 (counter) is present.
- No regressions: `computeFormIssues`/`formConfigValidation.ts` correctly reused from HEL-1084
  (unmodified — confirmed via `git log -1` on that file, last touched by `9f6f4d41`), not
  reimplemented. `.panel-content--form` correctly joins the existing F-038 shared scroll-affordance
  selector group rather than duplicating it (comment updated "three times" accordingly).
  `elevationTokenGuard`/`motionTokenGuard` pinned CSS-file counts correctly bumped 114→115 for the
  new `FormPanel.css`.
- No API/schema changes needed or made (config schema already shipped in HEL-1083/1084); no drift
  between planning artifacts and final diff — `design.md` D1–D10 items are each traceable to a
  concrete file in the diff.
- Standing Constraints C1–C6 (workflow-state.md) all honored — see Phase 2/3 detail below; none
  retired, all binding, all satisfied by the diff.

### Phase 2: Code Review — PASS

Gates re-run fresh in `WORKTREE_PATH` (not trusted from the executor's report):
- `npm run lint` — clean, 0 warnings.
- `npm run format:check` — clean.
- `npm test` — 3564/3564 passing, 331 suites (matches executor's claim).
- `npm --prefix frontend run build` — succeeds.
- `sbt test` (backend) — 4631/4631 passing, 311 suites, "All tests passed" (matches executor's claim).

Mutation-evidence spot checks (re-verified myself, not just trusted from `files-modified.md`):
- **PanelContent.test.tsx / `isFormPanel` branch (task 4.6)**: manually deleted the `isFormPanel`
  branch from `PanelContent.tsx`, re-ran `PanelContent.test.tsx` — 2/28 failed as claimed (fell
  through to `MetricRenderer`, `Unable to find role="form"`). Restored the file exactly
  (`diff` against the pre-mutation backup showed zero delta) before continuing.
- **PanelPackerSpec (task 4.1)**: not independently re-mutated (spot-checked one mutation per the
  brief), but the new `clamp(PanelKind.Form, ...) shouldBe (3, 5)` assertion is present at
  `PanelPackerSpec.scala:119` and passed in the full fresh `sbt test` run above.

Code-quality review (CONTRIBUTING.md / DESIGN.md, mechanical):
- Token usage is fully compliant: `PanelContent.css`'s new form-state and container-query rules use
  only `var(--space-*)`/`var(--text-*)`/`var(--app-radius-pill)`; no hardcoded px/color/duration.
- `FormFieldControl.tsx` correctly reuses shared primitives (`FormField`, `TextField`, `Textarea`,
  `Select`, `Toggle`) rather than hand-rolling markup — DRY, no duplication of the a11y-wiring
  pattern already established by `FormField.tsx`'s `errorId`/`hintId` contract (HEL-1084).
  `useId()` used for stable control/error/hint ids.
- C1 honored: every a11y assertion across `FormFieldControl.test.tsx`, `FormPanelView.test.tsx`, and
  the E2E spec uses `getByRole(..., {name})` / `toHaveAccessibleName` / `toHaveAccessibleDescription`
  / `toHaveAttribute("aria-invalid", "true")` — zero `getByText`/presence-only assertions found for
  any a11y claim.
- C3 honored: `file`, orphaned, unfit, and bad-options fields all render disabled with the label
  intact and the issue/reason as the accessible description (`FormFieldControl.tsx`'s `issue`/`file`
  branches; covered by 4 dedicated test cases).
- C4 honored: the `PanelContent.tsx` if-chain dispatch comment correctly cites C4 and the mutation
  test; confirmed above.
- Type safety: no `any`, no untyped escape hatches. `FormFieldValue` union typed in
  `useFormPanelValues.ts`.
- No dead code / no leftover TODO/FIXME found in the new files.
- No over-engineering: `FormPanelView`'s effect mirrors an existing established pattern
  (`FormEditor.tsx`'s cancelled-flag effect) rather than introducing new abstraction.

No issues found.

### Phase 3: UI Review — PASS

Servers: reused already-healthy servers at DEV_PORT=6517/BACKEND_PORT=9424; confirmed via
`/proc/<pid>/cwd` that both the frontend (pid on :6517) and backend (pid on :9424) processes' cwd
resolve to THIS worktree (`.../worktrees/feature/form-field-renderers/HEL-1085/{frontend,backend}`),
per MISTAKES.md guidance on reused-server risk. `assert-phase.sh servers` → `PASS servers`.

- Re-ran `DEV_PORT=6517 npx playwright test e2e/hel1085-form-field-renderers-keyboard.spec.ts`
  myself against this run's live servers — **1/1 passing**, matching the executor's claim. Read the
  spec in full: it seeds a real dataset/dashboard/form panel via the API, tabs through all six
  controls keyboard-only, asserts `toHaveAccessibleDescription` per control, blurs an empty required
  field and asserts `aria-invalid="true"` + `toHaveAccessibleDescription("Quantity is required")`,
  confirms Tab never traps focus, and captures light/dark screenshots — this is exactly the
  computed-ARIA-state evidence the AC and C1 require, not `role="alert"` presence.
- Screenshot claim verified: `.concertino/runs/HEL-1085/evidence/form-panel-fields-{light,dark}.png`
  exist (mtime ~18 min before this review, consistent with the just-completed Playwright re-run
  overwriting them) — the executor's report of a false-empty evidence dir at spawn time was accurate
  for that earlier moment but is now resolved; no false-completion claim to record as of this
  review's evidence.
- Viewed both screenshots directly: light and dark both render the form panel with token-consistent
  chrome (card border, label/hint typography, orange accent on the checked switch in both themes),
  no layout breakage, no unstyled/raw-HTML leakage. The panel was deliberately placed undersized
  (w:1, h:1, per the E2E spec's comment) so the field stack is mid-scroll in both captures — this is
  the F-038 scroll-affordance recipe operating as designed, not a rendering defect.
- No console errors surfaced during the Playwright run (test would have failed on an unhandled
  page/console error path if present; test passed clean).
- Happy path (fill all six, values commit) and one unhappy path (required-empty → error, then
  correction clears it) both exercised end-to-end against the real backend.
- Interactive elements have accessible names/keyboard support — proven above, both in RTL and in the
  real browser.

No issues found. Visual-cohesion subjective judgment (beyond the mechanical token checks above) is
left to the skeptic per role scope.

### Overall: PASS

### Non-blocking Suggestions

- None.
