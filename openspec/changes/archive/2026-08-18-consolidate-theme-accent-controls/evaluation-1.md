## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS
Issues: none.

- Ticket's single AC ("Theme and accent controls each live in exactly one primary, documented
  location") is met: theme toggle remains the standalone `CommandBar.tsx` icon; accent picker now
  lives only in a new "Appearance" section on `/settings`, ahead of "Preferences".
- No AC reinterpretation.
- All `tasks.md` items (1.1, 2.1–2.3, 3.1–3.2, 4.1–4.3) marked done and verified to match the actual
  diff (see Phase 2 file-by-file confirmation).
- No scope creep: diff touches exactly the 6 files `files-modified.md` names plus the two live specs'
  Purpose paragraphs — nothing else.
- No regressions to other specs: `UserMenu`'s remaining session/identity behavior (avatar/initials
  fallback, Escape-to-close, focus trap, ArrowUp/Down nav) is untouched apart from the necessarily
  updated first-focusable-item expectation.
- No API/schema changes needed or made (accent already persists via `updateUserPreferences`; only the
  UI entry point moved) — consistent with proposal.md's stated Impact.
- Planning artifacts reflect the final implementation:
  - `openspec/specs/frontend-theme-system/spec.md` and `openspec/specs/user-menu-popover/spec.md`
    delta files correctly describe the command-bar-only toggle / popover scoped to session-identity.
  - `openspec/specs/workspace-accent-color/spec.md` and `settings-preferences-ui/spec.md` delta files
    correctly document the Settings-page Appearance section.
  - **Verified directly**: the two *live* `openspec/specs/user-menu-popover/spec.md` and
    `openspec/specs/settings-preferences-ui/spec.md` files had their `## Purpose` paragraphs
    hand-edited exactly as design.md Decision 5 / tasks.md 3.1–3.2 require (confirmed via
    `git diff main...HEAD` on those two paths — only the `## Purpose` block changed, the
    `## Requirements` bodies are untouched, which is correct: those bodies still carry the
    pre-archive text and get rewritten by the delta-apply step at archive time, not by hand).
    `user-menu-popover`'s Purpose no longer claims the popover "consolidates... theme... accent
    color"; `settings-preferences-ui`'s Purpose now documents both the explicit-save "Preferences"
    section and the immediate-apply "Appearance" section.

### Phase 2: Code Review — PASS
Issues: none.

**Fresh gate run** (frontend-only diff; `WORKTREE_PATH`, no `CLEAN_WORKTREE`):
- `npm run lint` — clean, zero warnings.
- `npm run format:check` — clean.
- `npm test` — 8/8 helio-mcp suites (186 tests) + 215/215 frontend suites (2303 tests), all pass.
- `npm --prefix frontend run build` — succeeds (pre-existing >500kB chunk-size warning, unrelated to
  this change — no new large chunks introduced).

**Diff-level review**:
- `frontend/src/app/CommandBar.tsx`: `accentColor`/`setAccentColor` dropped from the `useTheme()`
  destructure and no longer passed to `<UserMenu>` — matches task 2.2 exactly, no leftover references
  (`grep` confirms none).
- `frontend/src/features/auth/ui/UserMenu.tsx`: `AccentPicker` import, props, and the "Accent color"
  section + its two flanking dividers removed; the F-082 comment above the theme-toggle removal was
  extended to cover the HEL-728 accent move — matches task 2.1 exactly.
- `frontend/src/features/auth/ui/UserMenu.css`: `.user-menu__section`/`.user-menu__section-label`
  rules removed; `grep -rn` across `frontend/src` confirms zero remaining references — dead CSS
  correctly identified and removed, no orphaned selectors left behind.
- `frontend/src/features/settings/ui/SettingsPage.tsx`: new "Appearance" section added before
  "Preferences", reusing the existing `settings-page__section`/`settings-page__section-heading`
  classes (no new CSS, no hardcoded tokens/colors — DESIGN.md mechanical token rules N/A here since
  nothing new was styled), reading `accentColor`/`setAccentColor` via `useTheme()` per Decision 3
  rather than new prop-threading — matches task 1.1 and design.md Decision 3 exactly.
- `CONTRIBUTING.md` mechanical checks: no inline FQNs (N/A, TS), no new `any`, all touched files well
  under the ~250-line soft budget (`SettingsPage.tsx` 101 lines, `UserMenu.tsx` 206 lines), changes
  focused/no unrelated refactors.
- DRY: no duplicated logic; `useTheme()` is the same shared hook already used elsewhere
  (`DashboardAppearanceEditor.tsx`, `PanelDetailModal.tsx`) per Decision 3, not a new pattern.
- Readable/modular: clear naming, comments explain the "why" (F-082/HEL-728 provenance) at each
  removal site.
- Type safety: no new escape hatches.
- No dead code: no unused imports/props left in `UserMenu.tsx`/`CommandBar.tsx`; no leftover
  TODO/FIXME.
- No over-engineering: accent picker reused as-is, no new abstraction introduced.
- Behavior-preserving where expected: accent's immediate-apply semantics and persistence wiring are
  provably unchanged (same `useTheme()` hook, same `AccentPicker` component, same
  `updateUserPreferences` dispatch path) — confirmed live in Phase 3 below, not just by inspection.

**Tests** (task 4):
- `UserMenu.test.tsx`: `accentColor`/`setAccentColor` dropped from `renderMenu` and the direct-render
  call site; the "renders accent color picker inside popover" test removed; the ArrowDown/ArrowUp
  focus-order tests updated to expect "Settings" as first-focused instead of the removed swatches —
  matches task 4.1 exactly, and independently reproduced live in Phase 3 (ArrowDown moved focus from
  Settings to Sign out).
- `SettingsPage.test.tsx`: two new tests added — Appearance section renders with current accent
  (Orange) selected, and clicking a swatch (Blue) applies immediately (`--app-accent` written, no
  Save-preferences click) — matches task 4.2 exactly and mirrors what `AccentPicker.test.tsx` already
  covers for the picker in isolation. These are meaningful: they'd catch a regression to either the
  Appearance section's presence or its immediate-apply behavior.
- Task 4.3 (adjacent-suite regression check): `App.test.tsx` (2 suites) and `AccentPicker.test.tsx`
  pass; the full frontend suite (215/215) confirms no adjacent breakage.

### Phase 3: UI Review — PASS
Issues: none.

Dev servers started via `scripts/concertino/start-servers.sh`/`assert-phase.sh` — both healthy
(`READY backend=.../health`, `READY frontend=...`, `PASS servers`).

- **Happy path end-to-end**: opened the app, clicked the User menu → popover shows only "Matt /
  matt@helio.dev", "Settings", "Sign out" — no accent color section, no theme toggle row. Navigated to
  `/settings` via the popover's "Settings" item → an "Appearance" section renders first (before
  "Preferences"), with 8 accent swatches and "Orange" shown pressed (the app's current/default
  accent). Clicked "Blue" → swatch became `aria-pressed="true"`, `--app-accent` on `:root` updated to
  `#3b82f6` live, no separate save action — confirms immediate-apply end-to-end, not just by test
  inspection. Reverted to Orange for cleanliness.
- **Theme toggle**: the standalone command-bar icon (`Switch to light theme` / `Switch to dark theme`)
  works independently of the accent move — toggled light then back to dark, both applied immediately
  and are unaffected by the Settings-page accent picker.
- **Keyboard support**: opened the User menu, pressed ArrowDown — focus moved from "Settings" (now
  first, since swatches are gone) to "Sign out", matching the updated `UserMenu.test.tsx` expectation
  live in the browser, not just in jsdom.
- **No console errors/warnings**: zero errors and zero warnings across the whole session (menu open,
  navigation to Settings, accent-swatch clicks, theme toggles).
- **Entry points**: accent is reachable from `/settings` (the only entry point per this change, by
  design — the redundant UserMenu surface was intentionally removed, not left as a second entry
  point).
- **Accessible names**: all interacting elements have accessible names (`aria-label` on swatches,
  `role="menuitem"`/`aria-label` on Settings/Sign out, `aria-pressed` on swatches, `role="group"
  aria-label="Accent color presets"` on the picker container).
- **Breakpoints** (1440 / 1100 / 768 / 375 as a stand-in for 0 — real 0px isn't renderable, 375 is the
  narrowest realistic mobile width used elsewhere in this repo's own screenshot conventions): screenshots
  taken at all four widths, no layout breakage in the new Appearance section or existing Preferences
  section at any width. (Note: the "Default panel style" color `<input type="color">` fields render as
  plain white/blank boxes at all widths — this is pre-existing `PreferencesEditor.tsx` behavior,
  unrelated to this change's diff, not flagged as an issue here.)

### Overall: PASS

### Non-blocking Suggestions
- None.
