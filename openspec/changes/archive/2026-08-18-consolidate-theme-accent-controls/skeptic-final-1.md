## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Ticket AC** ("Theme and accent controls each live in exactly one primary, documented location"):
- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `files-modified.md`, `evaluation-1.md` as claims, then independently checked each against `git diff main...HEAD` and the live app.

**Code diff traced file-by-file** (`git diff main...HEAD`):
- `frontend/src/features/settings/ui/SettingsPage.tsx` — new "Appearance" section added before "Preferences", rendering `<AccentPicker accentColor={accentColor} setAccentColor={setAccentColor} />` sourced from `useTheme()` (Decision 3) — matches task 1.1.
- `frontend/src/features/auth/ui/UserMenu.tsx` — `AccentPicker` import, props, and the "Accent color" section (plus its two flanking dividers) removed; F-082 comment extended to cover HEL-728 — matches task 2.1.
- `frontend/src/app/CommandBar.tsx` — `accentColor`/`setAccentColor` dropped from the `useTheme()` destructure and no longer passed to `<UserMenu>` — matches task 2.2.
- `frontend/src/features/auth/ui/UserMenu.css` — `.user-menu__section`/`.user-menu__section-label` removed; `grep -rn "user-menu__section" frontend/src` returns zero hits — confirmed dead, correctly deleted (task 2.3).
- `UserMenu.test.tsx` / `SettingsPage.test.tsx` diffs read in full — match tasks 4.1/4.2 exactly (accent-picker test moved, ArrowDown/Up focus-order tests updated to "Settings" as first item, two new Appearance tests added that assert immediate-apply with no Save click).
- `AccentPicker.tsx` and `ThemeProvider.tsx` are **untouched** (`git diff --stat main...HEAD -- frontend/src/shared/chrome/ frontend/src/theme/` empty) — confirms the design's Non-Goal ("no change to how accent color is computed/persisted") held.

**Gates re-run myself, fresh, in the worktree** (not trusted from evaluation-1.md):
- `npm run lint` → clean, zero warnings.
- `npx jest --testPathPatterns="UserMenu|SettingsPage|AccentPicker|App.test"` → 5 suites / 64 tests, all pass.
- `npm test -- --ci` (full suite) → 215/215 suites, 2303/2303 tests pass — matches evaluation-1.md's count exactly.
- `npm run build` → succeeds; same pre-existing >500kB chunk warning as evaluation-1.md noted, no new large chunks.

**Live UI check** (servers already healthy via `start-servers.sh`/`assert-phase.sh` → `PASS servers`; navigated with Playwright, screenshots taken and inspected):
- Dark theme: opened User menu → popover shows only "Matt / matt@helio.dev", "Settings", "Sign out" — no accent section, no theme-toggle row.
- Navigated to `/settings` → "Appearance" section renders first (before "Preferences"), 8 swatches, "Orange" `aria-pressed=true` (current default).
- Clicked "Blue" → swatch became pressed and `document.documentElement.style.getPropertyValue('--app-accent')` read back `#3b82f6` immediately (evaluated live via `browser_evaluate`, not inferred) — confirms immediate-apply, no Save button exists in that section. Reverted to Orange.
- Toggled to light theme → re-screenshotted both `/settings` (Appearance + Preferences sections) and the User-menu popover: token-driven surfaces adapt correctly, no hardcoded-color artifacts, no light/dark asymmetry introduced by the new section (it reuses the existing `settings-page__section`/`settings-page__section-heading` classes verbatim, no new CSS was added).
- Keyboard: opened User menu, pressed `ArrowDown` — focus moved live from "Settings" (now first) to "Sign out", reproducing the updated `UserMenu.test.tsx` expectation outside jsdom.
- `browser_console_messages` (warning level, whole session) → 0 errors, 0 warnings.

**OpenSpec artifacts vs. what shipped:**
- Delta files under `openspec/changes/consolidate-theme-accent-controls/specs/{frontend-theme-system,workspace-accent-color,user-menu-popover,settings-preferences-ui}/spec.md` read in full — Requirement/Scenario text in each matches the shipped code exactly (theme = command-bar-only Requirement + "no duplicate toggle inside popover" scenario; accent = new Settings "Appearance" Requirement + immediate-apply scenario; popover scoped to session/identity + "theme and accent are documented exceptions" scenario).
- Live (non-delta) `openspec/specs/user-menu-popover/spec.md` and `openspec/specs/settings-preferences-ui/spec.md` — confirmed via `git diff main...HEAD` that **only** their `## Purpose` paragraphs changed (Requirements bodies untouched), exactly as design.md Decision 5 / tasks 3.1–3.2 specify. Read the new Purpose text in full — it accurately reflects the shipped location split and cross-references the sibling specs.
- Verified Decision 5's *technical* claim directly against the installed tool source, not just trusted the prose: read `/usr/lib/node_modules/@fission-ai/openspec/dist/core/specs-apply.js`'s `buildUpdatedSpec` — confirms `rebuilt = [parts.before.trimEnd(), parts.headerLine, reqBody, parts.after]`, i.e. everything before `## Requirements` (including `## Purpose`) is carried through verbatim from whatever the live file contains at archive time; only `### Requirement:` blocks are rewritten. This is exactly what design.md asserts, and it means archiving this change later will correctly rewrite `frontend-theme-system`'s and `user-menu-popover`'s Requirement bodies onto the already-corrected, hand-edited Purpose text — resolving the (expected, transient) Purpose-vs-stale-Requirements mismatch that exists in the live specs right now. Per this repo's own `/opsx-archive` flow and the documented `concertino-deliver` sequence (verification → archive → PR), archiving happens *after* this final gate and *before* the PR — so this transient state is normal mid-workflow, not a shipped defect. I checked this rather than assume it, since a spec self-contradicting itself would otherwise be a real finding.
- `files-modified.md` accurately lists all 8 touched frontend/spec files; no undisclosed files in the diff (`git diff main...HEAD --stat` shows nothing beyond the named files plus openspec change-management artifacts).
- No API/schema changes needed or made — `accentColor` persistence path (`updateUserPreferences`) untouched, confirmed by the empty diff on `ThemeProvider.tsx`/`authSlice`.

**No dead code / no orphans:**
- `grep -rn "user-menu__section" frontend/src` → 0 hits.
- `grep -rn "accentColor" frontend/src/features/auth frontend/src/app/CommandBar.tsx` → only legitimate remaining references (`user.ts` type, `authSlice.test.ts`).

### Verdict: CONFIRM

### Non-blocking notes
- `frontend/src/app/CommandBar.tsx` is 253 lines, marginally over CONTRIBUTING.md's ~250-line soft budget — pre-existing (255 lines on `main` before this diff; this change is a net -2 line change, not a regression) and nowhere near the ~400-line "propose a split" threshold. Not a reason to block.
- The live `openspec/specs/frontend-theme-system/spec.md` Requirements body still describes the pre-F-082 popover-toggle location until this change is archived (its Purpose paragraph, which doesn't make a location claim, needed no hand-edit and got none — correctly scoped per design.md Decision 5). This resolves automatically at the archive step that follows this gate; flagging only so the archive step isn't skipped.
