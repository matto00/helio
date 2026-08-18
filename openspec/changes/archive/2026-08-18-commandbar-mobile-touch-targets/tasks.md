## 1. Frontend: theme toggle relocation

- [x] 1.1 Remove the theme `IconButton` (faSun/faMoon, `onClick={toggleTheme}`) from
      `frontend/src/app/CommandBar.tsx`; remove the now-unused `faSun`/`faMoon` imports and the
      `theme`/`toggleTheme` destructure/`useTheme` import if nothing else in the file uses them.
      Update the file's top docstring (currently lists "theme toggle" among the bar's contents).
- [x] 1.2 Add a labeled theme-toggle button to `frontend/src/features/settings/ui/SettingsPage.tsx`'s
      existing "Appearance" section, alongside `AccentPicker`, reusing the same `useTheme()` call
      already made there for `accentColor`/`setAccentColor` (add `theme`/`toggleTheme` to that same
      destructure). Label copy: "Light mode"/"Dark mode" (matches the old pre-F-082 UserMenu row),
      `aria-label`/`title` matching the removed CommandBar button's exact text
      (`Switch to light theme` / `Switch to dark theme`).
- [x] 1.3 Add styles for the new theme-toggle row/button in
      `frontend/src/features/settings/ui/SettingsPage.css`, matching the existing
      `.preferences-editor__add-btn` hairline-border secondary-button recipe for visual consistency.
- [x] 1.4 Update the stale F-082 comment blocks in `frontend/src/features/auth/ui/UserMenu.tsx`
      (~lines 59-64 and ~150-159) to state the theme toggle now lives in Settings' Appearance
      section, not "the top-bar icon" / App.tsx.

## 2. Frontend: mobile command-bar touch-target framing

- [x] 2.1 In `frontend/src/app/App.css`, inside the existing `@media (max-width: 768px)` block for
      `.app-command-bar`, add `height: var(--space-10);` (64px) alongside the existing
      `padding: 0 var(--space-3);` rule. Do not touch the unconditional (desktop) `height: 48px;`
      rule above it.
- [x] 2.2 After 1.1-1.4 land, re-measure the mobile command bar visually (live, not jsdom) to confirm
      the ticket's own instruction — with the theme toggle removed, crowding severity from the
      remaining 1-2 icon buttons ("Refine with AI" when a dashboard is selected, "Open assistant") is
      resolved by the height bump alone; no further layout change needed.

## 3. Tests

- [x] 3.1 Move the "toggles theme from the top-bar toggle button" test out of `frontend/src/app/App.test.tsx`
      (it currently renders the full app and clicks the removed CommandBar control) and rewrite it in
      `frontend/src/features/settings/ui/SettingsPage.test.tsx` as a new test asserting: the
      Appearance section's theme button toggles `document.documentElement.dataset.theme` and persists
      to `localStorage`, mirroring the existing accent-swatch immediate-apply test pattern
      (`renderWithStore`, no fetch-mock changes needed since neither test depends on
      preferences/agent-memory fetch state).
- [x] 3.2 Update `frontend/src/features/auth/ui/UserMenu.test.tsx`'s "does not render a theme-toggle
      control inside the popover" test's comment (not its assertions, which remain valid) to match
      the updated UserMenu.tsx comment from 1.4.
- [x] 3.3 Add/update a `CommandBar` or `App.test.tsx` assertion confirming no theme-toggle button
      (`Switch to light theme` / `Switch to dark theme`) renders in the command bar at all.
- [x] 3.4 Add `frontend/src/app/App.css.test.ts`, following `IconButton.css.test.ts`'s exact pattern
      (find the `max-width: 768px` media block, find the `.app-command-bar` rule body, assert it
      matches `/height:\s*var\(--space-10\)\s*;/`). This is a required regression guard, not
      optional — jsdom cannot observe media-query CSS, so this is the only test type that can catch a
      future silent removal of task 2.1's mobile height rule (skeptic design-gate round 1 change
      request).
- [x] 3.5 Run `npm test`, `npm run lint`, `npm run build` from `frontend/` — all must pass before
      handoff.

## 4. Live mobile verification (390x844) — required before evaluator/skeptic sign-off

- [x] 4.1 With the dev server running, use Playwright at a 390x844 viewport to confirm: (a) no theme
      toggle renders in the mobile command bar; (b) the Settings page's Appearance section shows a
      working theme toggle; (c) the mobile command bar's icon buttons (44px) have visible clearance
      above/below within the bar, not edge-to-edge as before.
- [x] 4.2 Confirm desktop (e.g. 1280px+) command bar is visually unaffected: 48px height, 28px icon
      buttons, theme toggle absent from the bar (now only in Settings).
