## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- AC1 (popover aligns to trigger at 390x844, options tappable): verified live via Playwright — see Phase 3.
- AC2 (probe/audit note, every Select-inside-dialog site checked): verified independently. Only three components
  render a native `<dialog>`: `PanelCreationModal.tsx` (afflicted, fixed), `PanelDetailModal.tsx` (confirmed no
  `animation` declaration in `PanelDetailModal.css`/`.mobile.css`/`.appearance.css`/`.binding.css`/`.sections.css`
  — unaffected), and `shared/ui/Modal.tsx` (`Modal.css:21` already uses `backwards` — unaffected). `ActionsMenu`,
  `UserMenu`, `DashboardAppearanceEditor` portal to `document.body` (confirmed via grep), never inside a `<dialog>`,
  so `Select.tsx`'s `closest("dialog[open]")` never matches them regardless of fill mode. `MobileNavSheet` uses
  `role="dialog"` on a `<div>`, not a native `<dialog>` element, so it's outside the `closest("dialog[open]")`
  match scope and correctly excluded from the audit. The design.md audit claim (only `PanelCreationModal.css`
  afflicted) checks out.
- AC3 (regression coverage): the static CSS-source test exists and — verified independently by reverting the CSS
  to the pre-fix `both` fill mode and re-running — genuinely fails against the pre-fix source (see Phase 2).
- Tasks 1.1–3.2 all marked done and match the implemented diff exactly (one-line CSS fill-mode change + comment,
  one new test file).
- No scope creep: diff touches only `PanelCreationModal.css` and the new test file, plus the OpenSpec change
  artifacts themselves.
- No regressions: `Modal.css`/`Modal.tsx` untouched; `Select.tsx`/`usePortalPopover` untouched per design's
  explicit non-goal.
- No API/schema changes; none expected for a CSS fix.
- Planning artifacts (proposal/design/tasks/spec delta) accurately reflect the final one-line implementation —
  no drift.

### Phase 2: Code Review — PASS
Issues: none.

- **Canonical code-quality compliance**: change is a single CSS declaration plus an explanatory comment
  (`PanelCreationModal.css:12-19`) and a new 55-line test file, both well under CONTRIBUTING.md's ~250-line
  file budget. No inline-FQN, import, or Scala-specific rules apply (frontend CSS/TS only).
  `npx eslint`/`npx prettier --check` on both touched files pass clean (eslint reports only "no matching
  configuration" for the `.css` file, which is expected — CSS isn't linted by ESLint in this repo).
- **DRY**: the fix reuses the exact pattern already shipped in `Modal.css:21` rather than introducing a new
  mechanism; the test mirrors the existing `ActionsMenu.css.test.ts` static-assertion precedent (confirmed by
  reading both).
- **Readable**: the CSS comment clearly explains the containing-block mechanism and cites the `Modal.css`
  precedent commit; the test file's header comment and per-assertion structure are self-explanatory.
- **Type safety**: N/A (CSS + test-only TS with no `any`).
- **Security**: N/A, no user input or boundary code touched.
- **Error handling**: N/A.
- **Tests meaningful — independently verified**: reverted `PanelCreationModal.css` to the pre-fix `both` fill
  mode and re-ran `npx jest --testPathPatterns=PanelCreationModal.css.test` — the first assertion
  (`toMatch(/\bbackwards\b/)`) genuinely failed with `Received string: "animation: panel-creation-modal-in
  var(--transition-slow) both;"`. Restored the fix and re-ran — both assertions pass. This is a real regression
  guard, not a tautology.
- **No dead code**: no unused imports, no leftover TODO/FIXME.
- **No over-engineering**: rejected the JS containing-block-compensation alternative in favor of the minimal
  root-cause CSS fix, consistent with the design doc's stated rationale.
- **Behavior-preserving at rest**: confirmed via the second test assertion and live DOM inspection (Phase 3) that
  the `to` keyframe (`transform: none`) is the dialog's resting state, so dropping the forwards fill changes
  nothing visually at rest — only removes the lingering containing-block transform.

### Phase 3: UI Review — PASS
Issues: none.

Dev servers started via `scripts/concertino/start-servers.sh` / `assert-phase.sh` — both reported healthy.

- **Happy path (390x844, live Playwright)**: Add panel → Chart → Start blank template → selected a data type →
  Next → "Name your panel" step showing the "Chart type" combobox. Opened the combobox; DOM inspection gave:
  trigger `bottom = 489.5`, panel `top = 493.5` (options render just below the trigger, ~4px gap for the panel's
  own margin), and `left` matches exactly (21 = 21). `getComputedStyle(dialog).transform` was `"none"` at rest —
  confirms the dialog is no longer a containing block. Clicked the "Bar" option; selection was applied
  (combobox value updated to "Bar"), confirming the options are genuinely tappable, not just visually aligned.
  This is the exact regression the fix targets and it's resolved.
- **No console errors** during the full flow (0 errors, 5 pre-existing warnings unrelated to this change) at
  390x844 or after resizing to 1440x900.
- **Interactive elements/keyboard**: the Select trigger is a native combobox with accessible name "Chart type";
  options are proper `option` roles inside a `listbox` — accessible names and roles intact, unchanged by this
  fix (fix is CSS-only, no markup/ARIA changes).
- **Breakpoints**: verified 390 (primary regression target, full interactive flow) and 1440 (no console errors,
  desktop layout unaffected — expected, since the bug and fix are about a `position: fixed` containing-block
  interaction that's breakpoint-independent in mechanism, only the previous *symptom offset* was mobile-specific
  because of the dialog's centered position at that viewport).
- Jest suite for touched area: `npx jest --testPathPatterns="PanelCreationModal"` — 2 suites, 48 tests, all pass.

### Overall: PASS

### Change Requests
(none)

### Non-blocking Suggestions
- The design doc's noted follow-up (fold `PanelCreationModal` onto the shared `Modal` primitive to eliminate the
  duplication that let this fix diverge) is reasonable but correctly out of scope here — worth a spinoff ticket
  as already suggested in design.md's Planner Notes.
