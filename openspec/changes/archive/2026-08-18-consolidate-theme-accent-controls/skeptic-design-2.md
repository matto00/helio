## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- **Round 1's technical claim, re-derived independently (not trusted from the report).** Read
  `/usr/lib/node_modules/@fission-ai/openspec/dist/core/specs-apply.js` (`buildUpdatedSpec`, line 243:
  `[parts.before.trimEnd(), parts.headerLine, reqBody, parts.after]`) and
  `.../parsers/requirement-blocks.js` (`extractRequirementsSection`, `before = lines.slice(0,
  reqHeaderIndex)`) myself. Confirmed: `parts.before` — everything in the file before the
  `## Requirements` header, i.e. including `## Purpose` — is read from `targetContent` (the live
  `openspec/specs/<capability>/spec.md` at archive time) and carried through **verbatim**; there is no
  delta syntax that can rewrite it. This independently confirms round 1's premise was correct, not a
  hallucination.

- **The two live spec files, read fresh**: `openspec/specs/user-menu-popover/spec.md` (Purpose still
  says "Consolidates all per-user controls (theme, display name, sign-out, accent color) into a single
  avatar-triggered popover") and `openspec/specs/settings-preferences-ui/spec.md` (Purpose still
  describes only the explicit-save Preferences model). Both still stale, confirming the gap is live,
  not already fixed by drift elsewhere.

- **This round's fix, read in full and checked against the mechanism above**:
  - `tasks.md` §3 (3.1/3.2) — new section instructing the executor to hand-edit the **live**
    `openspec/specs/user-menu-popover/spec.md` and `openspec/specs/settings-preferences-ui/spec.md`
    `## Purpose` paragraphs directly, not the delta files under this change's own `specs/` directory.
    3.1's reword direction ("popover scoped to session/identity controls; theme = command bar, accent
    = Settings, by design") matches the delta's actual corrected Requirement text I read in
    `openspec/changes/consolidate-theme-accent-controls/specs/user-menu-popover/spec.md` line 4
    verbatim. 3.2's direction (describe both the explicit-save Preferences section and the new
    immediate-apply Appearance section) matches the delta's added Requirement in
    `specs/settings-preferences-ui/spec.md`. Both are concrete rewording instructions, not
    hand-waving.
  - `design.md` Decision 5 — correctly names the mechanism (`specs-apply.js`, `buildUpdatedSpec`),
    correctly explains why (verbatim carry-through, no Purpose delta syntax), and correctly ties back
    to tasks 3.1/3.2 as the fix, closing the loop the round-1 report asked for (change requests 1–3 are
    all addressed: both files, and design.md now documents it).
  - Checked scope completeness myself, not just trusting "these are the only two files that need
    it": read the other two affected specs' live Purpose paragraphs
    (`openspec/specs/frontend-theme-system/spec.md`: "Defines requirements for the frontend light/dark
    theme system, including the default theme, user toggle control location, and theme token
    standards" — no location asserted; `openspec/specs/workspace-accent-color/spec.md`: "User-selectable
    accent color from a curated preset palette that updates all accent CSS tokens immediately and
    persists to the backend" — no location asserted either). Neither makes a location-specific claim
    that the corrected Requirement text (theme = command bar, accent = Settings) contradicts, so the
    plan's scoping to exactly two files for hand-edits is correct — not under-inclusive.
  - Checked for a concurrency hazard in hand-editing live specs mid-change: `openspec/changes/`
    contains only `archive/` and `consolidate-theme-accent-controls/`; no other in-flight change
    touches `user-menu-popover` or `settings-preferences-ui`, so there's no cross-change collision risk
    in this repo's current state.

- **Spot-checked a sample of round 1's other ground-truth claims myself** (not re-trusted wholesale):
  - `frontend/src/app/CommandBar.tsx:233-246` — confirmed standalone `.cmd-btn.cmd-btn--icon` theme
    toggle wired to `toggleTheme`, and `accentColor`/`setAccentColor` destructured from `useTheme()`
    (line 62) and passed to `<UserMenu>` (line 246), exactly as design.md/tasks.md assume.
  - `frontend/src/features/auth/ui/UserMenu.tsx:158-184` — confirmed the F-082 comment, the "Accent
    color" `.user-menu__section` block with `AccentPicker`, and exactly two flanking
    `.user-menu__divider`s around it; removing them per task 2.1 leaves exactly one divider (Settings/
    Sign-out), no orphans.
  - `frontend/src/features/auth/ui/UserMenu.css:131,138` + grep — `.user-menu__section`/
    `.user-menu__section-label` have no usage outside the block being removed; task 2.3's dead-CSS
    claim holds.
  - `frontend/src/shared/chrome/AccentPicker.tsx` — prop signature (`accentColor: string`,
    `setAccentColor: (hex: string) => void`) confirmed; `frontend/src/theme/ThemeProvider.tsx` exposes
    `accentColor`/`setAccentColor` (`Dispatch<SetStateAction<string>>`) from `useTheme()` — assignable
    to `AccentPicker`'s narrower setter type, so Decision 3's "read `useTheme()` directly in
    `SettingsPage.tsx`" plan type-checks against the existing hook shape without new plumbing.
  - `frontend/src/features/settings/ui/SettingsPage.tsx:29-49` — confirmed the
    `settings-page__section`/`settings-page__section-heading` pattern and that "Preferences" is
    currently the first section, matching task 1.1's "placed before Preferences" instruction
    unambiguously.
  - `frontend/src/features/auth/ui/UserMenu.test.tsx` — confirmed both target test names exist
    ("renders accent color picker inside popover" line 153; the ArrowDown-focus test line 169) and
    confirmed exactly two `accentColor=` call sites (lines 22, 98) matching tasks.md 4.1's "both
    direct-render call sites."
  - `frontend/src/test/renderWithStore.tsx:244-248` — confirmed it wraps `ThemeProvider`, and
    `SettingsPage.test.tsx` already uses `renderWithStore`, supporting Decision 3's "no new test
    scaffolding" claim.

### Verdict: CONFIRM

### Non-blocking notes

- `tasks.md` 4.3 lists "CommandBar" among adjacent suites to re-check for regressions, but no
  `CommandBar.test.tsx` exists and no test file references "CommandBar" by name (verified via grep).
  Coverage isn't actually missing — `App.test.tsx` exercises `CommandBar` indirectly through full-app
  rendering (e.g. its "toggles theme from the top-bar toggle button" test) — but the suite name in the
  task text is imprecise. Not plan-blocking; flagging so the executor doesn't go looking for a
  nonexistent file.
- Round 1's other findings (dead CSS, prop threading, divider math, test names, spec/code drift
  premise) all reconfirmed against ground truth on this pass, not just carried forward from the prior
  report.
