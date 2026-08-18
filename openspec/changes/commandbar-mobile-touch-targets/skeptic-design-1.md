## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

**Focus 1 — theme toggle relocation actually executed, not re-litigated**
- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md` in full. The plan removes the theme
  `IconButton` from `CommandBar.tsx` entirely (desktop + mobile, single canonical location) and adds
  a labeled toggle to `SettingsPage.tsx`'s existing Appearance section (task 1.1–1.4). `design.md`
  explicitly states "Do not re-litigate whether the toggle belongs in the top bar" as a Non-Goal and
  cites the ticket's own instruction as already-decided. This matches the ticket's explicit, twice-
  stated instruction and does not weigh it against the old F-082 precedent — it correctly treats the
  new instruction as authoritative.
- Confirmed via `Read` of `frontend/src/app/CommandBar.tsx:63,234-241` that the theme `IconButton`
  currently lives exactly where the ticket says, wired to `useTheme()`'s `theme`/`toggleTheme`, used
  nowhere else in the file — so the planned full-import removal (task 1.1) is safe, matching
  `design.md`'s own stated risk-mitigation.
- Confirmed via `Read` of `frontend/src/features/settings/ui/SettingsPage.tsx:13,25,40-48` that
  `useTheme()` is already called there for `accentColor`/`setAccentColor` in an "Appearance" section
  alongside `AccentPicker` — task 1.2's plan to add `theme`/`toggleTheme` to the same destructure is
  grounded, not invented.
- Confirmed via `Read` of `frontend/src/features/auth/ui/UserMenu.tsx:59-64,150-159` that the stale
  F-082 comment blocks task 1.4 targets exist at (almost) the cited lines and say exactly what the
  ticket/design describe ("the top-bar icon ... is the single canonical theme toggle").
- Confirmed via `grep` that `App.test.tsx:359-375` contains the exact "toggles theme from the top-bar
  toggle button" test the proposal says must move, and that `SettingsPage.test.tsx` already has the
  matching accent-picker immediate-apply test pattern (`renderWithStore`, which wraps `ThemeProvider`
  per `frontend/src/test/renderWithStore.tsx:20,244`) that task 3.1 says to mirror.
- Read both spec deltas (`frontend-theme-system`, `user-menu-popover`) against the current
  `openspec/specs/*` base files: both MODIFIED requirements correctly replace the base requirement's
  full text (matching the exact `### Requirement:` header the openspec archive tool matches on —
  confirmed by reading `specs-apply.js` itself, which extracts/merges only the `## Requirements`
  section, never `## Purpose`). No contradiction between proposal/design and spec deltas.

**Focus 2 — command-bar height fix, precedent check**
- Confirmed via `Read` of `frontend/src/shared/ui/IconButton.css:95-106` that the cited root cause
  (`.ui-icon-btn`'s unconditional `min-width/min-height: 44px` at `max-width: 768px`) is real and
  matches the ticket's diagnosis.
- Confirmed via `Read` of `frontend/src/shared/chrome/BottomNav.css:25-29` that the cited precedent
  (`height: calc(var(--control-lg) + var(--space-4) + env(...))` = 40+16 = 56px) is accurate, and that
  `theme/theme.css:56,61` confirms `--space-10` = 64px, `--control-lg` = 40px, matching `design.md`'s
  arithmetic exactly.
- Confirmed via `Read` of `frontend/src/app/App.css:39-51,111-116,364-394` that `.app-command-bar` and
  `.app-command-bar__right` both use `align-items: center` (not `stretch`), so the (64−44)/2 = 10px
  clearance math in `design.md` is correct, and that the mobile-only rule the task plans to add
  (task 2.1, inside the existing `@media (max-width: 768px)` block) does not touch the unconditional
  desktop `height: 48px` at line 40 — satisfying the ticket's "desktop unaffected" AC.
- Confirmed via `grep -rn "48px|app-command-bar"` that no other file hardcodes `.app-command-bar`'s
  height for positioning math, matching `design.md`'s "isolated, self-contained change" claim.
- Confirmed `--control-sm` = 28px (`theme.css:59`), matching the ticket's own "confirmed still 28px on
  desktop" claim.

**Focus 3 — spec-delta consistency and live-viewport verification coverage**
- Tasks section 4 (4.1/4.2) explicitly requires live Playwright verification at 390×844 for both
  fixes before evaluator/skeptic sign-off, plus a desktop-viewport check — matches the ticket's own
  explicit "not just jsdom" requirement.
- Found one genuine gap (below).

### Verdict: REFUTE

### Change Requests

1. **Missing CSS-lock regression test for the new `.app-command-bar` mobile height rule — inconsistent
   with the plan's own cited precedent, and unguarded against the exact failure mode this ticket
   exists to fix.** `design.md` (lines 76-80) states the new `command-bar-touch-target-framing`
   capability "mirrors the narrow single-purpose precedent of `modal-emptystate-touch-targets`/
   `shared-popover-touch-targets`." I read both precedent specs
   (`openspec/specs/modal-emptystate-touch-targets/spec.md:61-73`,
   `openspec/specs/shared-popover-touch-targets/spec.md:34-43,78-90`) and both include, as a first-class
   requirement, "CSS-lock tests guard the mobile rule" — a static test (e.g.
   `frontend/src/shared/ui/IconButton.css.test.ts`, which I also read) that asserts the actual
   mobile-media-query CSS rule text is present, because (per that file's own comment, lines 4-11)
   "jsdom implements no real layout or media-query evaluation, so no DOM-rendering Jest test can
   observe the rendered control size at a phone viewport." This codebase has 13 such
   `*.css.test.ts` files (confirmed via `find`); there is none for `App.css`. Neither
   `openspec/changes/commandbar-mobile-touch-targets/specs/command-bar-touch-target-framing/spec.md`
   nor `tasks.md` §2/§3 includes an equivalent requirement/task. Without it, a future refactor could
   silently drop `.app-command-bar`'s mobile `height: var(--space-10)` rule and reintroduce this
   exact ticket's bug (icon buttons nearly filling the bar edge-to-edge), with nothing catching it
   until the next live-testing pass — precisely the failure mode that produced this hotfix in the
   first place (a sibling CSS change, `IconButton.css`'s HEL-718 floor, silently broke the bar's
   framing with no test noticing). This is also required to satisfy `.concertino/laws/
   systematic-debugging.md`'s binding "regression test that fails before the fix and passes after"
   requirement for a bug fix — since a jsdom test literally cannot observe this CSS rule, a CSS-lock
   test is the only test type that can play that role here.
   **Required revision:** Add a `### Requirement: CSS-lock test guards the mobile command-bar height
   rule` to `specs/command-bar-touch-target-framing/spec.md` (mirroring the precedents' wording), and
   add a task under tasks.md §3 to create `frontend/src/app/App.css.test.ts` (following
   `IconButton.css.test.ts`'s pattern) asserting the `max-width: 768px` media block for
   `.app-command-bar` sets `height: var(--space-10)` (or equivalent).

### Non-blocking notes

- `design.md`'s Planner Notes correctly identifies that the `user-menu-popover` spec's `## Purpose`
  prose will remain stale ("a standalone command-bar icon") after this change archives, since
  `specs-apply.js` only merges the `## Requirements` section. I independently verified this against
  the actual archive tool source. Deferring as an out-of-scope doc nit is reasonable for a hotfix,
  but worth a one-line follow-up whenever this spec is next touched.
- The decision not to add a 44px mobile floor to the new Settings theme-toggle button is
  well-reasoned (no sibling control on that page has one either) but leaves a page-wide gap that
  might be worth a spinoff ticket rather than only a comment in `design.md`.
