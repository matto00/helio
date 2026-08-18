## 1. Frontend: Settings page gains an Appearance section

- [x] 1.1 In `SettingsPage.tsx`, import `useTheme` and `AccentPicker`; add a new "Appearance"
      section (matching the existing `settings-page__section`/`settings-page__section-heading`
      markup), placed before the "Preferences" section, rendering
      `<AccentPicker accentColor={accentColor} setAccentColor={setAccentColor} />`.

## 2. Frontend: remove the accent picker from UserMenu

- [x] 2.1 In `UserMenu.tsx`, remove the `accentColor`/`setAccentColor` props, the `AccentPicker`
      import, and the "Accent color" section + its two flanking dividers from the popover markup.
      Update the F-082 comment above the removed block to also cover HEL-728 (accent moved to
      Settings, not just theme moved to the command bar).
- [x] 2.2 In `CommandBar.tsx`, drop `accentColor`/`setAccentColor` from the `useTheme()` destructure
      and stop passing them as props to `<UserMenu>`.
- [x] 2.3 In `UserMenu.css`, remove the now-dead `.user-menu__section`/`.user-menu__section-label`
      rules (confirm via grep they have no other usage before deleting).

## 3. OpenSpec Purpose text corrections

- [x] 3.1 The `openspec` archive tool can only rewrite `### Requirement:` blocks from a delta file —
      everything before `## Requirements` (including `## Purpose`) is carried through verbatim from
      the current `openspec/specs/<capability>/spec.md` at archive time, with no delta syntax for it.
      Directly hand-edit the live `openspec/specs/user-menu-popover/spec.md`'s `## Purpose` paragraph
      now (not the delta file under this change's own `specs/` directory) so it no longer claims the
      popover "consolidates... theme... accent color" — reword to match the corrected Requirement
      text this change's delta already writes (popover scoped to session/identity controls; theme =
      command bar, accent = Settings, by design).
- [x] 3.2 Directly hand-edit the live `openspec/specs/settings-preferences-ui/spec.md`'s `## Purpose`
      paragraph the same way, so it describes both the existing explicit-save "Preferences" section
      and the new immediate-apply "Appearance" section as part of what `/settings` now provides.

## 4. Tests

- [x] 4.1 Update `UserMenu.test.tsx`: drop `accentColor`/`setAccentColor` from `renderMenu`'s props
      and both direct-render call sites; remove the "renders accent color picker inside popover"
      test; update the ArrowDown-focus test's expected first-focused item now that the accent
      swatches are no longer the first focusable element in the popover.
- [x] 4.2 Add a test (in `SettingsPage.test.tsx` or a new file) asserting the Appearance section
      renders the accent picker with the current accent color selected, and that clicking a swatch
      calls through to the same immediate-apply path `AccentPicker.test.tsx` already covers (no
      "Save preferences" click required).
- [x] 4.3 Run `npm run lint` and `npm test` (frontend) to confirm no regressions in adjacent
      suites (`App.test.tsx` — the only suite exercising `CommandBar`, since there is no standalone
      `CommandBar.test.tsx` — and `AccentPicker.test.tsx`).
