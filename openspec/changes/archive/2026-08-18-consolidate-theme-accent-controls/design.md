## Context

Ground truth from the current codebase (verified, not assumed):

- **Theme toggle**: a standalone `.cmd-btn.cmd-btn--icon` in `CommandBar.tsx` (line ~234), wired to
  `useTheme().toggleTheme`. `UserMenu.tsx` carries an F-082 comment confirming its own theme-toggle
  row was already removed, "the top-bar icon is the single canonical theme control now."
- **Accent picker**: `AccentPicker` is rendered only inside `UserMenu.tsx`'s popover, under an
  "Accent color" section (lines 166-169), fed `accentColor`/`setAccentColor` threaded down from
  `useTheme()` in `CommandBar.tsx`. Nothing in `/settings` touches accent today.
- **Spec drift**: `openspec/specs/frontend-theme-system/spec.md` and
  `openspec/specs/user-menu-popover/spec.md` both still document the *pre*-F-082 state ("theme
  toggle... located inside the UserMenu popover", "No standalone theme toggle in command bar") —
  contradicted by the code that already shipped. This change is also a spec/code reconciliation,
  not just a UI move.
- `accentColor` is a `UserPreferences` field (`features/auth/types/user.ts`), persisted via
  `updateUserPreferences` (`PATCH` through `authService`), entirely separate from `AgentPreferences`
  (`defaultSeriesColors`/`defaultPanelStyle`/`namingConventions`, the explicit-Save-button resource
  `PreferencesEditor.tsx` already edits via `PUT /api/preferences`). These are two different backend
  resources with two different save models — this matters for Decision 2 below.

## Goals / Non-Goals

**Goals:**
- One documented, single primary location per control: theme = command bar; accent = Settings.
- Specs match shipped behavior exactly (no more `frontend-theme-system`/`user-menu-popover` drift).
- Preserve accent's existing immediate-apply behavior and persistence wiring untouched.

**Non-Goals:**
- No change to how accent color is computed, derived, or persisted server-side.
- No change to the theme toggle's implementation — it already lives in the right place; only its
  spec is updated to stop contradicting the code.
- No redesign of `PreferencesEditor.tsx`'s explicit-Save form itself.

## Decisions

**Decision 1 — Theme stays put; specs are corrected, not the code.** F-082 already made the
top-bar icon canonical (a beta-sweep finding, PR #382) but never updated the two specs that
described the pre-F-082 layout. Reverting the code to match the stale spec would undo a deliberate,
already-shipped fix; correcting the spec to match the code is the right direction of travel here,
and matches this ticket's own recommendation ("top-bar quick-toggle for theme"). Self-approved —
this is exactly HEL-728's stated scope, not an unrelated architectural reversal.

**Decision 2 — Accent moves into its own "Appearance" section, not into the "Preferences" form.**
`PreferencesEditor.tsx`'s form is explicit-Save (`AgentPreferences`, a different backend resource).
Accent applies immediately on click today (no Save button) and must keep doing so — embedding
`AccentPicker` inside that form would either (a) silently change accent to require clicking "Save
preferences" to take effect (a real behavior regression), or (b) mix two save models in one `<form>`
(confusing and easy to implement wrong). A sibling section in `SettingsPage.tsx`, placed first
(before "Preferences"), keeps the accent picker's existing immediate-apply semantics unchanged and
avoids conflating two unrelated backend resources under one save button.

**Decision 3 — `SettingsPage.tsx` reads `useTheme()` directly**, the same hook `CommandBar.tsx`
already uses, rather than threading `accentColor`/`setAccentColor` through new props. `ThemeProvider`
wraps the whole app in `main.tsx`, so this is a direct, already-established pattern (mirrors
`DashboardAppearanceEditor.tsx`, `PanelDetailModal.tsx`, etc.), and the shared test helper
`renderWithStore` (used by `SettingsPage.test.tsx`) already wraps `ThemeProvider` — no new test
scaffolding needed.

**Decision 4 — Remove `UserMenu`'s accent props and dead CSS.** `accentColor`/`setAccentColor` props
on `UserMenu` (and the pass-through in `CommandBar.tsx`) are deleted, not left unused. The
`.user-menu__section`/`.user-menu__section-label` CSS rules become dead once the "Accent color"
block is removed (grep confirms no other usage) and are deleted with it.

**Decision 5 — Hand-edit the two affected specs' `## Purpose` paragraphs directly, not just their
Requirement bodies (skeptic round 1 finding).** The `openspec` archive tool's delta-apply
(`specs-apply.js`, `buildUpdatedSpec`) only ever rewrites `### Requirement:` blocks; everything
before `## Requirements` — including `## Purpose` — is carried through **verbatim** from whatever
`openspec/specs/<capability>/spec.md` currently contains at archive time. There is no delta syntax
for `## Purpose` at all. `user-menu-popover/spec.md`'s current Purpose ("Consolidates all per-user
controls (theme, display name, sign-out, accent color) into a single avatar-triggered popover...")
directly contradicts the corrected Requirement text this change's own delta writes just below it
("theme toggle... and accent color picker... are intentionally rendered outside this popover") — if
left alone, landing this change would create a fresh self-contradiction in the exact file HEL-728
exists to de-contradict. `settings-preferences-ui/spec.md`'s Purpose has the same, milder gap (it
describes only the explicit-save model, no longer complete once an immediate-apply Appearance
section exists). Fix: tasks.md 3.1/3.2 have the executor hand-edit both live `openspec/specs/...`
files' Purpose paragraphs directly (not the delta files under this change's own `specs/` directory) —
so archive's verbatim carry-through picks up the already-corrected text. This closes the "Specs match
shipped behavior exactly" goal end-to-end, not just for Requirement bodies.

## Risks / Trade-offs

[Users with the popover open mid-session lose a shortcut to accent] → Settings is already one click
away from the same popover (the "Settings" menu item), so the picker is never more than two clicks
from the account trigger either way.

[Spec-correction direction (code wins over spec) could mask an unintentional regression] →
Cross-checked against the F-082 commit message and code comment, which both explicitly state the
top-bar icon is intentional and canonical; this is not a guess.

## Planner Notes

Self-approved: reconciling `frontend-theme-system`/`user-menu-popover` spec text with already-shipped
F-082 behavior is within HEL-728's own stated scope (the ticket's own recommendation matches the
current code), not a new architectural decision — no external dependency, no breaking API change, no
scope expansion beyond "one documented home per control."
