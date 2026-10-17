## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Scope: Phase B (design.md D8–D11), tasks.md §3, specs/mobile-bottom-nav/spec.md, specs/mobile-dashboard-meta-line/spec.md.
Reviewed worktree HEAD d9ab82edd696f9c171632c477cc7d236ef42d91b (Phase B artifacts uncommitted in the working tree).

### What I verified (with evidence)

- Spawn-cwd guard: `assert-cwd.sh` → `READY ambient=/home/matt/Development/helio branch=feature/mobile-dashboard-glass-nav/HEL-1583`.
- Owner answers: `.concertino/runs/HEL-1583/events.jsonl` line 39 is `escalation.answered`, `sub_answers ["assistant-to-header","wire-after-1576"]`, `answer_source human`, `resolution_channel chat`, escalation id `HEL-1583-1792056262977-6fc1da`, matching the raise on line 6. (It is not the last line any more; later lines are evidence/spawn events.) The record was written by the orchestrator role from chat. I can verify that it was recorded, but not the chat itself.
- Ticket ACs on Linear match `ticket.md` (unchanged; updatedAt 2026-10-15).
- origin/main is 19 ahead. HEL-1576 (38de7610a), HEL-1572 (2a9f9e467) and HEL-1575 are merged. **HEL-1578 is not merged**, and neither is HEL-1573. The design's precondition (stop and report if 1578 is not merged) handles this.
- The D8 premises hold on origin/main:
  - `CommandBar.tsx` still mounts on the phone shell, including the dashboard view.
  - "Open assistant" is unconditional except on `/chat`.
  - The phone-only `UserMenu` avatar exists (`isPhoneShell && ... <UserMenu>`).
  - `UserMenu` lists Settings, Usage (owner only), Getting started and Sign out, and has a `placement` prop (`bar|rail`) that a tab variant can extend.
- The D8 base in the HEL-1578 worktree holds: `isDestinationActive` and the active `homeAlias` are in `navDestinations.ts`; `sections.ts` has `/home` (non-nav), `/dashboards` (end), `/sources`, `/pipelines`, `/connectors`, `/chat`, `/settings` and `/admin/usage`; and `BottomNav.tsx` uses `isDestinationActive`.
- The D11 premises hold on origin/main:
  - `useDashboardMeta(dashboardId, panels)` carries the "do not mount on the public route" warning.
  - `DashboardMetaRow` feeds it the `state.panels.items` selector.
  - The refresh text is computed inline in `DashboardMetaFacts.tsx` (never / ran / failed), so extracting it into a helper is real and feasible.
  - `DashboardMetaRow` mounts only on the rail shell (`usesDashboardMetaRow(pathname, isPhoneShell)`), so the phone line would be the only instance there.
- D9 tokens exist on main: `--motion-duration-standard` 280ms and `--motion-ease-out`. The `data-motion="off"` gating pattern exists in `BottomNav.css`. DESIGN.md §12 already names "a width transition on --motion-duration-standard with --motion-ease-out".
- Phase A interaction with the main merge: the overlapping files are PanelList.tsx, MobilePanelStack.css, theme.css, the two token guards, hel813 and hel1023. HEL-1576 changed only a comment in MobilePanelStack.css. HEL-1572 density applies to the grid gap and row padding only (not the phone stack), so the D1 math is not invalidated. Task 3.0's re-run of the Phase A tests and e2e is enough.
- Spec-delta headers: MODIFIED "Bottom tab bar provides section navigation on phone", MODIFIED "Every one of the five current routes is escapable via the tab bar" and REMOVED "Tab bar visual and ergonomic constraints" all match existing headers in `openspec/specs/mobile-bottom-nav/spec.md`.
- No TODO/TBD placeholders in D8–D11 or tasks §3. Every AC clause for Phase B traces to a task: 5 tabs (3.1/3.5), the active label (3.2), Connectors/Usage reachability (3.1/3.5), contrast re-measure (3.3) and the refreshed line (3.4).

### Verdict: REFUTE

Phase B is close. These five defects would ship something wrong, or let two competent implementers build different things.

### Change Requests

1. **The mobile-bottom-nav MODIFIED block regresses HEL-1578's breakpoint wording.**
   - HEL-1578 already rewrote this requirement (archive `2026-10-16-home-page-run-timeline/specs/mobile-bottom-nav/spec.md` and its synced `openspec/specs/mobile-bottom-nav/spec.md`). It now reads "in the phone layout" and "above the phone layout → not visible / the desktop rail behaves exactly as before".
   - This delta reintroduces "below the 768px breakpoint" and "WHEN the viewport is 768px or wider → not visible". That is false against the code: `BottomNav.css` gates on `@media (max-width: 768px)`, and `PHONE_SHELL_QUERY` is `(max-width: 768px)` ("exactly 768px is a phone layout"). At exactly 768px the bar is visible.
   - Since this ticket merges second, rewrite the MODIFIED block against HEL-1578's text: phone layout = 768px and below; hidden only above it.

2. **The active label's ink is unspecified, and the carried-over clause forbids the obvious choice.**
   - `.bottom-nav__tab--active { color: var(--app-accent-text) }` colours the whole tab, so a label added inside it inherits the accent. The design board (Motion--nav-tab3.png, DashboardMobile.png) also shows an accent label.
   - The ADDED requirement still says "`--app-accent` SHALL apply to the active tab's icon alone and to nothing else in the bar". The label's 4.5:1 scenario also covers backdrops only, not the user-customisable accent presets.
   - D9/D10 must state the label colour and make the spec agree. Either:
     - (a) the label uses `--app-text` (accent stays on the icon only), with a pin; or
     - (b) amend the clause to "icon and label", and add "every shipped accent preset, both themes" to the 4.5:1 label scenario.
   - Also specify the opaque-lozenge fallback so it still passes the "active lozenge visible against the capsule material ≥3:1" scenario. An opaque `--app-surface-strong` fill converges with a theme-matched capsule, which is why HEL-774 needed a boundary in the first place. Say what carries the boundary in the fallback (a hairline, or the accent wash composited over the opaque base).

3. **The D9 tab distribution produces an off-pattern bar above 320px, and its "width transition" is not implementable as written.**
   - With inactive tabs `flex: 0 0 44px` and the active tab `flex: 1 1 auto`, the active tab takes all the remaining width:
     - about 157px at 375px;
     - about 212px at 430px;
     - about 550px at a 768px viewport (capsule 744px minus padding minus 4×44).
   - The four inactive icons sit 44px apart while the active pill floats in a large empty slot: uneven rhythm, unlike the board's evenly spaced icons around a content-sized pill. The active hit area also becomes a huge band.
   - Separately, `flex-basis: 44px` ↔ `auto` does not interpolate, so "width/max-width transition" leaves the tab width jumping.
   - Specify a distribution with even rhythm and a content-sized active pill. For example:
     - inactive `flex: 1 1 0; min-width: 44px`;
     - active `flex: 0 0 auto`, sized by its content, with the label's `max-width` transitioning (so the tab width follows) and capped for the 320px ellipsis case.
   - Add an e2e/measurement assertion for the even spacing at 375 and 768.
   - Also reconcile the lozenge geometry: `.bottom-nav__lozenge` is `--space-3` padding × 2 + a 22px icon = 46px, inside a 44px tab with `padding: 0 2px` (40px content box). State whether the lozenge padding changes for inactive tabs.

4. **D11 does not say where the refresh line goes vertically, and "under the name button" does not fit the phone header as built.**
   - The phone command bar's height is fixed by the `--app-command-bar-height` seam: 56px = `--control-lg` + `--space-4`. That seam feeds `--app-top-chrome-height`, which other layout reads (App.css ~l.400 comment; theme.css l.163–172).
   - `.app-command-bar__mobile-title` is `min-height: 44px`, so a mono caption under it needs about 60px or more.
   - The design only addresses horizontal fit. Decide and specify one of:
     - (a) inside the bar: how the 44px hit area and the caption stack within 56px, or whether the seam changes, and what consumes it;
     - (b) the first line in `.panel-list` flow above the chip row on the dashboard view. This needs no seam change and matches the board, where the caption sits between the title and the chips.
   - Add a scenario to `mobile-dashboard-meta-line` that pins the choice, for example "header height unchanged" or "line sits above the chip row".

5. **The "no trapped route" claim is false for free-tier users.**
   - D8 says the quick launcher's "browse" link reaches `/chat`. `QuickLauncherOverlay.tsx` (origin/main ~l.90) renders that link only when `!isFreeTier`.
   - With the Assistant tab gone, a free-tier phone user has no link to `/chat`. The spec scenario "every other top-level route is reachable within two taps" would then be false as written.
   - Either scope the scenario and design sentence correctly: for example, the assistant surface (the overlay, which shows the same request-access state `/chat` shows a free user) is reachable in one tap, and `/chat` is reachable for non-free tiers. Or provide a path. Add the free-tier case to task 3.5 or a unit test.

### Non-blocking notes

- **Me tab's type:** Me is a `<button>` with `activePrefixes`, but `NavDestination.to` is required. State Me's shape in `phoneNavTabs`: a discriminated `kind: "menu"` entry, or a `to` used only for matching. Also state that "current" on a button is `aria-current="page"`, so the "exactly one current" unit table has one attribute to read.
- **Failure dot:** the desktop refresh fact also renders a red/ok intent dot (`dashboard-meta-row__dot--${refreshIntent}`). Say whether the phone line carries it. "Last run failed" without the danger dot is a small parity gap.
- **Reduced-motion requirement:** the new "expansion animates on the motion tokens and respects motion settings" requirement overlaps the existing "Added bottom-nav motion respects reduced-motion preference", which already defines saved Full/Subtle overriding the OS. Consider extending that one instead of adding a parallel requirement.
- **Phone "User menu" e2es:** the e2es that click `User menu` (auth-cookie-migration, hel1562 l.71, hel1575 l.630) appear to run at desktop widths. Any that run at phone widths will break when the phone avatar goes. Task 3.6's full suite covers this, but grep them in 3.1.
- **HEL-1573** is not merged; the fallback to `--motion-duration-standard`/`--motion-ease-out` is correctly planned.
