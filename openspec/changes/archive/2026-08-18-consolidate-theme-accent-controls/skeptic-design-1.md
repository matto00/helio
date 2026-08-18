## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Ticket AC** (`openspec/changes/consolidate-theme-accent-controls/ticket.md`): "Theme and
  accent controls each live in exactly one primary, documented location." Read in full.

- **Planning artifacts read in full**: `proposal.md`, `design.md`, `tasks.md`, and all four spec
  deltas (`specs/frontend-theme-system/spec.md`, `specs/user-menu-popover/spec.md`,
  `specs/workspace-accent-color/spec.md`, `specs/settings-preferences-ui/spec.md`).

- **Ground-truth code claims cross-checked against the actual files** (not taken on faith):
  - `frontend/src/app/CommandBar.tsx:234-242` — theme toggle is a standalone `.cmd-btn.cmd-btn--icon`
    wired to `useTheme().toggleTheme`, exactly as design.md's Context section claims. Confirmed.
  - `frontend/src/features/auth/ui/UserMenu.tsx:159-169` — the F-082 comment and the "Accent color"
    section (`AccentPicker` inside a `.user-menu__section`) are exactly where design.md says, at the
    lines it cites. Confirmed.
  - `frontend/src/shared/chrome/AccentPicker.tsx` — confirmed prop signature
    (`accentColor`/`setAccentColor`) matches what tasks 1.1/2.1 assume.
  - `frontend/src/features/auth/ui/UserMenu.css:131,138` + `grep -rn "user-menu__section"` — confirmed
    `.user-menu__section`/`.user-menu__section-label` have exactly one usage site (the block being
    removed), so task 2.3's "dead CSS" claim is accurate, not a guess.
  - `frontend/src/features/settings/ui/SettingsPage.tsx` — confirmed `settings-page__section` /
    `settings-page__section-heading` markup pattern task 1.1 says to match, and that "Preferences" is
    currently the first section (so "placed before Preferences" in design.md Decision 2 / task 1.1 is
    unambiguous — it puts Appearance first overall).
  - `frontend/src/features/settings/ui/PreferencesEditor.tsx:1-6` header comment — confirms explicit
    "Save" button model, supporting Decision 2's rationale for not merging accent into that form.
  - `frontend/src/theme/ThemeProvider.tsx` + `frontend/src/main.tsx:48` — confirmed `ThemeProvider`
    wraps the whole app and is the sole owner of accent-token application, supporting Decision 3.
  - `frontend/src/features/dashboards/ui/DashboardAppearanceEditor.tsx:51`,
    `frontend/src/features/panels/ui/PanelDetailModal.tsx:79` — both call `useTheme()` directly, as
    Decision 3 claims as precedent for `SettingsPage.tsx` doing the same.
  - `frontend/src/test/renderWithStore.tsx:244-248` — confirmed `ThemeProvider` is already wrapped
    by the shared test helper, supporting Decision 3's "no new test scaffolding needed" claim.
  - `frontend/src/features/auth/ui/UserMenu.test.tsx` — confirmed the exact test names tasks.md 3.1
    targets exist today: `"renders accent color picker inside popover"` (line 153) and
    `"opens with focus on the first item (the first accent swatch) and ArrowDown moves to the
    next"` (line 169), and that `renderMenu` currently passes `accentColor`/`setAccentColor` props
    (lines 17-23) as tasks.md 3.1 says to drop.
  - Manually traced the divider removal in task 2.1 against `UserMenu.tsx`'s actual markup
    (lines 158-184): removing the "Accent color" block + its two flanking dividers leaves exactly
    one divider (between Settings and Sign out) with no orphaned/doubled dividers — unambiguous.

- **Base specs read** (`openspec/specs/frontend-theme-system/spec.md`,
  `openspec/specs/user-menu-popover/spec.md`, `openspec/specs/workspace-accent-color/spec.md`,
  `openspec/specs/settings-preferences-ui/spec.md`) to confirm the "spec drift" premise in
  proposal.md/design.md is real, not asserted: base `frontend-theme-system` and `user-menu-popover`
  do say the toggle lives inside the popover ("The theme toggle control SHALL be located inside the
  UserMenu popover, not as a standalone button in the command bar" / "theme toggle... are only
  accessible inside the popover") — genuinely contradicted by the shipped code. Confirmed.

### A structural gap the plan does not cover (grounded, not speculative)

I read the `openspec` CLI's own delta-apply implementation
(`/usr/lib/node_modules/@fission-ai/openspec/dist/core/specs-apply.js`, `buildUpdatedSpec`) to check
exactly what the archive/sync step is capable of rewriting. It only ever replaces/adds/removes
`### Requirement:` blocks inside the `## Requirements` section; everything before that header
(`parts.before`, which includes the `## Purpose` paragraph) is carried through **verbatim**
(`[parts.before.trimEnd(), parts.headerLine, reqBody, parts.after]`). There is no delta syntax for
`## Purpose` at all (confirmed: no `Purpose` handling anywhere in `requirement-blocks.js`'s delta
parser). I also confirmed via `git log -p` that `user-menu-popover/spec.md`'s Purpose line has never
been edited since the file was created — it's been stale since F-082 already, and this change's own
proposal.md/design.md never revisits it.

Concretely: `openspec/specs/user-menu-popover/spec.md`'s current Purpose reads *"Consolidates all
per-user controls (theme, display name, sign-out, **accent color**) into a single avatar-triggered
popover in the app header..."* The delta in this change modifies the Requirement text right below it
to say the opposite: *"The theme toggle (command bar) and accent color picker (Settings page) are
intentionally rendered outside this popover."* Because the tooling cannot touch Purpose text, landing
this change as planned will leave that direct self-contradiction sitting in the same file,
immediately below each other — which is exactly the "spec/code contradiction" failure mode HEL-728
exists to eliminate (per design.md's own stated Goal: "Specs match shipped behavior exactly"). The
same gap applies more mildly to `settings-preferences-ui/spec.md`'s Purpose text ("the preferences
view/edit surface... with an explicit-save... editing model"), which is no longer a complete
description of the capability once it also owns an immediate-apply Appearance section.

None of `proposal.md`, `design.md`, or `tasks.md` schedule a task to hand-edit these two Purpose
paragraphs (the only way they can be corrected, since the delta mechanism structurally can't reach
them). This is a concrete, actionable, easily-fixed gap in the plan, not a nitpick — the whole point
of this ticket is eliminating exactly this class of contradiction.

### Verdict: REFUTE

### Change Requests

1. Add an explicit task (in `tasks.md`, section 1 or 2) instructing the executor to hand-edit the
   `## Purpose` paragraph of `openspec/specs/user-menu-popover/spec.md` directly (not via the delta
   file, which the `openspec` archive tool cannot use to rewrite Purpose text — verified against
   `specs-apply.js`) so it no longer claims accent color and the theme toggle are "consolidated...
   into a single avatar-triggered popover." Word it to match the corrected Requirement text this
   change already writes (theme = command bar, accent = Settings, popover scoped to
   session/identity).
2. Do the same for `openspec/specs/settings-preferences-ui/spec.md`'s Purpose paragraph, updating it
   to mention the new Appearance section's immediate-apply model alongside the existing
   explicit-Save Preferences description, so the Purpose statement stays an accurate summary of the
   capability once this change lands.
3. Reflect both edits in `design.md`'s Impact/Context (or a new Decision) so the "no more
   frontend-theme-system/user-menu-popover drift" goal in design.md's Goals section is actually met
   end-to-end, including the Purpose sections, not just the Requirement bodies.

### Non-blocking notes

- Everything else checked out cleanly against ground truth: the code claims in design.md's Context
  section, the dead-CSS claim, the existing test names/props tasks.md targets, the divider-removal
  math, and the `useTheme()`-direct-read precedent are all accurate, not asserted. Once the Purpose-
  section gap above is closed, I'd expect to confirm this design on a second pass.
