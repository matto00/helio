# Files modified — HEL-745

- `frontend/src/app/CommandBar.tsx` — removed the theme `IconButton` (faSun/faMoon,
  `onClick={toggleTheme}`) and its now-unused `faSun`/`faMoon` icon imports and `useTheme`
  destructure/import; updated the file's top docstring and the quick-launcher comment (which
  referenced "mirrors the theme-toggle button's recipe below") to stop referencing the removed
  control.
- `frontend/src/app/App.css` — added `height: var(--space-10);` (64px) to the existing
  `@media (max-width: 768px) { .app-command-bar { ... } }` block so the bar frames its 44px
  `IconButton` mobile tap-target floor with real clearance; the unconditional desktop
  `height: 48px;` rule is untouched.
- `frontend/src/app/App.css.test.ts` (new) — CSS-lock regression test (skeptic design-gate round 1
  REFUTE requirement), following `IconButton.css.test.ts`'s exact pattern: locates the
  `max-width: 768px` media block, then the `.app-command-bar` rule body, and asserts it matches
  `/height:\s*var\(--space-10\)\s*;/`.
- `frontend/src/app/App.test.tsx` — replaced the "toggles theme from the top-bar toggle button" test
  (which clicked the now-removed CommandBar control) with "renders no theme-toggle button in the
  command bar", asserting neither `Switch to light theme` nor `Switch to dark theme` renders there.
  The original toggle-behavior coverage moved to `SettingsPage.test.tsx` (see below).
- `frontend/src/features/settings/ui/SettingsPage.tsx` — added a labeled theme-toggle button to the
  existing "Appearance" section, alongside `AccentPicker`, reusing the same `useTheme()` call already
  made there (added `theme`/`toggleTheme` to the existing `accentColor`/`setAccentColor` destructure).
  Label copy "Light mode"/"Dark mode" and `aria-label`/`title` text match the removed CommandBar
  button and the pre-F-082 UserMenu dropdown row exactly.
- `frontend/src/features/settings/ui/SettingsPage.css` — added `.settings-page__theme-toggle`,
  matching `PreferencesEditor.css`'s `.preferences-editor__add-btn` hairline-border secondary-button
  recipe for visual consistency with this page's other controls.
- `frontend/src/features/settings/ui/SettingsPage.test.tsx` — added "toggles theme from the
  Appearance section's theme button", moved (not duplicated) from `App.test.tsx`, mirroring the
  existing accent-swatch immediate-apply test pattern already in this file
  (`renderWithStore`, which already wraps `ThemeProvider`).
- `frontend/src/features/auth/ui/UserMenu.tsx` — updated the two stale F-082 comment blocks
  (focus-management effect + the popover's theme-toggle-omission comment) to state that both the
  theme toggle and the accent picker now live in Settings' Appearance section, with no top-bar icon
  left at all — comment-only, no behavior change.
- `frontend/src/features/auth/ui/UserMenu.test.tsx` — updated the "does not render a theme-toggle
  control inside the popover" test's comment to match the corrected UserMenu.tsx comment; assertions
  unchanged (still valid).
- `openspec/changes/commandbar-mobile-touch-targets/tasks.md` — checked off all 13 completed tasks
  (sections 1-4).

## Live-verification evidence (task 4, required per ticket)

Verified with a real Playwright browser (not jsdom) against the running dev server
(`http://localhost:6177`, backend `http://localhost:9084`), authenticated as `matt@helio.dev`:

**Mobile (390×844):**
- `.app-command-bar` bounding box: `height: 64` (was 48) — the `var(--space-10)` mobile rule is live.
- 0 theme-toggle buttons found under `.app-command-bar__right` — confirmed removed from the bar.
- 2 remaining icon-only buttons ("Refine this dashboard with AI", "Open assistant"), each 44×44px,
  with `clearanceTop≈9.5px` / `clearanceBottom≈10.5px` inside the 64px bar — visible breathing room,
  not edge-to-edge (was ~2px each side at the old 48px height).
- `/settings` Appearance section renders a visible, working theme-toggle button (`aria-label`
  `"Switch to light theme"`, text `"Light mode"` while dark). Clicking it: `document.documentElement
  .dataset.theme` flips `dark → light` (confirmed via `page.waitForFunction`, not a fixed sleep),
  `localStorage["helio-theme"]` updates to `"light"`, computed `body` background color updates to
  the light-theme value (`rgb(244, 242, 237)`), and the button's own label flips to `"Dark mode"`.
  Screenshots captured before/after at `/tmp/.../scratchpad/hel745-mobile-commandbar.png` and
  `hel745-mobile-settings.png` (not committed — Playwright test-run artifacts, not project files).

**Desktop (1440×900) sanity check:**
- `.app-command-bar` height: `48` (unchanged).
- 0 theme-toggle buttons in the bar (confirmed absent, matching mobile).
- 3 icon-only buttons ("Customize dashboard appearance", "Refine this dashboard with AI", "Open
  assistant"), each 28×28px (unchanged desktop sizing).

One test-script false alarm during this verification, resolved without any app-code change: an
initial screenshot taken immediately after `page.waitForFunction` (theme-dataset flip confirmed)
still showed the old dark background, because `.app-shell`'s `background-color` is CSS-transitioned
(`--app-transition`, 0.16s) and the screenshot was captured mid-transition. Probed by polling
`getComputedStyle(document.body).backgroundColor` every 200ms after the click
(`localStorage`/`dataset.theme` flipped within the first 200ms poll; visual background color
followed within the same window) — confirmed the app itself applies the new theme correctly and
promptly; only the verification script's screenshot timing needed a longer settle wait, which was
added. No product defect.
