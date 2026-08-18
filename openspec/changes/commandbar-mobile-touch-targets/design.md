## Context

`CommandBar.tsx` currently renders a standalone `faSun`/`faMoon` `IconButton` wired to
`useTheme().toggleTheme`, per `frontend-theme-system`'s existing requirement ("a standalone icon
button in the command bar, not nested inside the UserMenu popover") and `user-menu-popover`'s
matching "documented exception." HEL-728 was asked, in an explicit chat instruction predating its
own filing, to move this control to Settings; it moved only the accent picker and left the theme
toggle in place, citing the (now-superseded) spec text as authoritative. This ticket executes the
already-answered instruction rather than re-litigating it.

Separately, HEL-718 migrated the command bar's icon buttons onto the shared `IconButton` primitive,
which carries `IconButton.css`'s unconditional 44px mobile tap-target floor (`HEL-308/314/319`
convention). `.app-command-bar` itself never grew to accommodate that floor — it stays a fixed 48px
at every viewport — so on mobile a 44px square button sits inside a 48px bar with 2px clearance on
each side, "nearly filling the entire" bar (confirmed live at 390×844).

## Goals / Non-Goals

**Goals:**
- Theme toggle lives in exactly one place — Settings' Appearance section — and nowhere else.
- Mobile command-bar icon buttons keep their 44px floor (accessibility-correct, not to be touched)
  but have visible breathing room inside the bar.
- Both fixes verified live at a real 390×844 viewport, not just jsdom, per the ticket's explicit ask.

**Non-Goals:**
- Do not shrink the 44px mobile tap-target floor, and do not special-case the command bar out of it
  — that would reintroduce the exact accessibility regression `IconButton.css`'s floor exists to
  prevent.
- Do not re-litigate whether the toggle belongs in the top bar — already decided by explicit user
  instruction; this ticket only executes it.
- Do not restructure the command bar's broader mobile layout beyond the height bump — the ticket's
  own text says to re-measure severity after the toggle removal before deciding how much further
  work (if any) is needed, and the height bump alone clears the 44px floor with real margin for the
  remaining 1-2 icon buttons.

## Decisions

**Toggle destination: Settings' Appearance section, not the UserMenu popover.** The ticket offers
both as acceptable, "Settings ... or at minimum ... UserMenu." Settings' Appearance section already
exists (HEL-728) and already holds one immediate-apply, no-Save-button preference control (the
accent picker) — the theme toggle is functionally identical in persistence/apply semantics, so it
slots in next to it with no new pattern. The UserMenu popover was deliberately emptied of both
controls by F-082/HEL-728 specifically because "a persisted, infrequently-changed preference [does
not belong] behind a quick top-bar affordance" — the same reasoning applies to Settings-vs-popover:
Settings is the more discoverable, intentional home for a preference a user sets rarely, not a
quick-access popover item.

**Rendered as a labeled button, not a bare icon.** In the command bar the icon-only recipe made
sense (space-constrained top bar, `title` tooltip carries the label). In Settings, next to the
labeled `AccentPicker`, an icon-only control would be the odd one out — rendered instead as a small
labeled button (`<FontAwesomeIcon icon={faSun|faMoon} /> Light mode|Dark mode`), matching the exact
"Light mode"/"Dark mode" copy the old (F-082-removed) UserMenu dropdown row used, and reusing
`toggleTheme`/`theme` from the same `useTheme()` call `SettingsPage.tsx` already makes for the
accent picker — no new state, no new hook usage.

**No mobile 44px floor added to the new Settings button.** DESIGN.md's control-metrics section says
phone-reachable buttons get the 44px floor, but neither `PreferencesEditor`'s "Save preferences"/
"Add color" buttons nor any other control on this same Settings page currently carries it — this
page has never applied the floor. Adding it to only this one new button would be inconsistent with
every sibling control on the page it sits in; it's flagged here as a known, pre-existing gap for the
whole page (out of scope — this ticket is scoped to the two `CommandBar.tsx` mobile regressions, not
a Settings-page touch-target audit) rather than fixed inconsistently on one control.

**Command-bar mobile height: `var(--space-10)` (64px), not a new literal.** `BottomNav.css` already
establishes this codebase's precedent for framing 44px mobile targets in a chrome bar: `height:
calc(var(--control-lg) + var(--space-4))` = 56px, "well over the 44px HIG minimum." `.app-command-bar`
uses `align-items: center` (not `stretch`), so its children keep their own height and center within
whatever the bar's height is — at 56px that's (56-44)/2 = 6px clearance per side, only marginally
better than today's 2px. `--space-10` (64px) gives 10px clearance per side, a materially more
comfortable frame, while still reusing an existing design token rather than introducing a new
literal — consistent with DESIGN.md's spacing-token convention even though `height` itself isn't
literally covered by the margin/padding/gap rule. No other file hardcodes the command bar's height
for positioning math (`grep` confirmed only `App.css` references `.app-command-bar`), so this is an
isolated, self-contained change — no compensating offset needed elsewhere.

**New capability spec for the height fix; extend two existing capabilities for the toggle move.**
No existing spec captures "the command bar frames its own tap targets" — `icon-button` owns the
button's own floor, not the bar's height, so a small new capability (`command-bar-touch-target-
framing`) is added, mirroring the narrow single-purpose precedent of `modal-emptystate-touch-targets`
/`shared-popover-touch-targets`. The toggle-location change is a requirement edit to two specs that
already govern exactly this fact (`frontend-theme-system`, `user-menu-popover`) — not a new
capability.

**CSS-lock regression test required (skeptic design-gate round 1 REFUTE).** Both cited precedent
specs also include a "CSS-lock tests guard the mobile rule" requirement — a static test (e.g.
`IconButton.css.test.ts`) asserting the actual mobile-media-query CSS text is present, since jsdom
cannot evaluate media queries and so cannot otherwise observe this fix at all. The new capability's
delta now includes the equivalent requirement, and `tasks.md` §3.4 adds `App.css.test.ts` following
that exact pattern. This is required, not optional, per `.concertino/laws/systematic-debugging.md`'s
regression-test obligation — without it, nothing would catch a future silent removal of the mobile
height rule, which is exactly the failure mode (a sibling CSS change silently breaking the bar's
framing, unnoticed until the next live-testing pass) that produced this hotfix in the first place.

## Risks / Trade-offs

- [Risk] Removing `CommandBar.tsx`'s only use of `useTheme()`'s `theme`/`toggleTheme` values could
  leave a dangling unused import if anything else in the file still needs `useTheme()`. → Mitigation:
  confirmed via read that `theme`/`toggleTheme` are used nowhere else in `CommandBar.tsx`; the whole
  `useTheme` import is removed, not just the two destructured values.
- [Risk] `App.test.tsx`'s existing "toggles theme from the top-bar toggle button" test would start
  failing (control no longer exists there) if left in place. → Mitigation: task explicitly moves this
  coverage to `SettingsPage.test.tsx`, mirroring the accent-picker immediate-apply test already there
  (`renderWithStore` already wraps `ThemeProvider`), rather than leaving a broken assertion or simply
  deleting coverage.
- [Risk] A live-viewport-only regression (the actual bug this ticket fixes) could recur silently if
  only jsdom/unit tests are relied on going forward. → Mitigation: per the ticket's explicit request,
  both fixes are live-verified at a real 390×844 viewport (Playwright) during evaluation/skeptic
  gates, not just unit tests — this is a process step for this ticket's delivery, not a code change.

## Planner Notes

Self-approved: destination = Settings' Appearance section (not UserMenu popover) — the ticket names
both as acceptable and states a preference order ("either ... or at minimum"); Settings matches the
existing accent-picker precedent most closely. Self-approved: `--space-10` (64px) command-bar mobile
height — no existing token or file dictates an exact value; this is a bounded UI-polish judgment
call, not an architectural or breaking change, so it does not rise to a Planning `ESCALATION`.
Self-approved: `user-menu-popover`'s canonical `## Purpose` prose (not a `## Requirements` block, so
outside the delta-spec ADDED/MODIFIED mechanism entirely — `openspec archive` never merges Purpose
text for an already-existing spec, confirmed against `specs-apply.js`) still says "a standalone
command-bar icon" after this change lands. Left as-is rather than hand-edited outside the normal
archive flow — the Requirements text (the testable, normative part) is corrected by this change's
delta; the Purpose-prose staleness is a minor doc nit, out of scope for this hotfix.
