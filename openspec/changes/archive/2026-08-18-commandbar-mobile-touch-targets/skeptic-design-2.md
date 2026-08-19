## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

**Round 1's change request — CSS-lock test for the mobile command-bar height rule**
- Read the revised `specs/command-bar-touch-target-framing/spec.md`. It now has a second requirement,
  `### Requirement: CSS-lock test guards the mobile command-bar height rule`, with a `Scenario: Mobile
  command-bar height rule removed`. I diffed its wording against both precedent specs I read fresh this
  round (`openspec/specs/modal-emptystate-touch-targets/spec.md:61-72`'s "CSS-lock tests guard the
  mobile modal and empty-state rules" and `openspec/specs/shared-popover-touch-targets/spec.md:34-42`'s
  "CSS-lock tests guard the mobile rules") — same shape: SHALL-static-assert-the-media-block-keeps-the-
  rule, plus a "rule removed → test fails" scenario. This is a faithful mirror, not just an assertion of
  one.
- Read `tasks.md` task 3.4 (new) and diffed it against `frontend/src/shared/ui/IconButton.css.test.ts`,
  read in full fresh this round. Task 3.4 correctly names the actual mechanism that file uses
  (`findMediaBlock`/`findRuleBody` helpers, brace-matched, regex-asserted rule text) rather than
  hand-waving "similar to." I checked this is actually implementable against the real `App.css`: the
  file (read in full) has exactly one `@media (max-width: 768px)` block (lines 364-404), and inside it
  the `.app-command-bar { padding: 0 var(--space-3); }` rule (line 365) appears *before* the later
  compound selector `.app-command-bar .save-state-indicator` (line 386) that also contains the substring
  `.app-command-bar` — so `findRuleBody`'s first-`indexOf` semantics will correctly resolve to the
  dedicated `.app-command-bar` rule body, not the compound selector, exactly as task 2.1 plans to add
  `height: var(--space-10);` to. The planned test is mechanically sound against the real file, not just
  plausible-sounding.
- Confirmed via `find frontend/src -iname "*.css.test.ts"` (13 files) that no `App.css.test.ts` exists
  yet — this is a real gap being closed, not a duplicate.
- **Round 1's change request is fully and correctly addressed**, in both the spec delta and the task,
  faithfully following the precedent this codebase itself established.

**Fresh re-verification of the rest of the plan against ground truth (not reused from round 1)**
- `frontend/src/app/CommandBar.tsx:9-10,34,63,235,238` — theme `IconButton` (`faSun`/`faMoon`,
  `useTheme()`, `onClick={toggleTheme}`) still lives exactly where the ticket/design say, unchanged
  since round 1. Task 1.1's planned removal is grounded.
- `frontend/src/features/settings/ui/SettingsPage.tsx:13,25,44` — `useTheme()` already destructures
  `accentColor`/`setAccentColor` for the existing "Appearance" section (`AccentPicker`); task 1.2's plan
  to add `theme`/`toggleTheme` to the same call and same section is grounded, not invented.
- `frontend/src/features/auth/ui/UserMenu.tsx:58-64,151-159` — both stale F-082 comment blocks exist,
  read in full, and say exactly what design.md quotes ("the top-bar icon ... is the single canonical
  theme control"). Task 1.4's target lines are accurate.
- `frontend/src/app/App.test.tsx:357-375` — the "toggles theme from the top-bar toggle button" test
  exists exactly as described, asserting `dataset.theme`, `localStorage`, and the button's
  `title`/accessible-name text that task 1.2 says the new Settings control must reuse verbatim. Task
  3.1's planned move is grounded.
- `frontend/src/features/settings/ui/SettingsPage.test.tsx:18,60-139` — already uses `renderWithStore`
  (which wraps `ThemeProvider`) repeatedly; task 3.1's plan to mirror this pattern for the new theme
  toggle test is grounded, not aspirational.
- `frontend/src/theme/theme.css:56,59-61` — `--space-10: 4rem` (64px), `--control-sm: 28px`,
  `--control-md: 32px`, `--control-lg: 40px` — all match `design.md`'s clearance arithmetic
  ((64-44)/2 = 10px) and the ticket's own "confirmed still 28px on desktop" claim, verified fresh.
- `frontend/src/app/App.css:39-51,364-404` — `.app-command-bar` uses `align-items: center` (not
  `stretch`) both at the unconditional (desktop) rule and inside the mobile media block, and the
  unconditional `height: 48px` (line 40) sits outside the `max-width: 768px` block entirely — task 2.1's
  "do not touch the desktop height" instruction is achievable exactly as planned, and AC4 (desktop
  unaffected) is architecturally satisfiable by the plan as written.
- Spec deltas (`frontend-theme-system`, `user-menu-popover`) — read both revised deltas and their base
  specs (`openspec/specs/frontend-theme-system/spec.md:4-25`, `openspec/specs/user-menu-popover/
  spec.md:6-19`) side by side. Both `### Requirement:` headers in the deltas match the base specs'
  headers character-for-character ("Persistent frontend light/dark theme system",  "Single trigger
  button opens user menu popover"), which is what `specs-apply.js`'s merge requires for a MODIFIED
  requirement to correctly replace (not duplicate) the base text. No contradiction between the two
  deltas' cross-references to each other (both now say "Settings page's Appearance section", not a
  stale "command bar" reference in one and a fixed one in the other).
- All five ticket ACs trace to a specific task: AC1 (removal + relocation) → tasks 1.1-1.3; AC2 (stale
  comment) → task 1.4; AC3 (mobile height/clearance) → task 2.1 + new CSS-lock test (3.4); AC4 (desktop
  unaffected) → task 2.1's explicit scoping + task 4.2's live check; AC5 (live 390×844 verification) →
  tasks 4.1/4.2. No AC is left uncovered, and no task is unmoored from an AC.

### Verdict: CONFIRM

### Non-blocking notes

- (Carried from round 1, still valid, still non-blocking.) `user-menu-popover`'s `## Purpose` prose
  will remain stale ("a standalone command-bar icon") after archive, since `specs-apply.js` only merges
  `## Requirements`. `design.md`'s Planner Notes correctly identifies and defers this as a doc nit
  outside the normal archive flow — reasonable for a same-day hotfix.
- (Carried from round 1, still valid.) No mobile 44px floor is being added to the new Settings
  theme-toggle button; `design.md` documents this as a pre-existing, page-wide gap (no sibling control
  on `SettingsPage` has one either) rather than an inconsistent one-off fix. Worth a spinoff ticket for
  a Settings-page touch-target audit, not a blocker here.
