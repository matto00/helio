## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed head: `5319977e4157e213720218678595da401bb490bf`. Base resolved live with `resolve-review-base.sh` (main/origin): `d777803c1fbdf45f093584527ed4c052c8ad992f`, exit 0. 82 files changed.
Spawn guard: `assert-cwd.sh` → `READY ambient=/home/matt/Development/helio branch=feature/mobile-dashboard-glass-nav/HEL-1583`.
Evidence ref root: `/home/matt/Development/helio/.concertino/runs/HEL-1583/evidence/.concertino/scratch/HEL-1583/skeptic/` (`<name>.png` below).

### What I verified (with evidence)

**Code read (diff vs base):** `BottomNav.tsx/.css`, `navDestinations.ts`, `DashboardChipRow.tsx/.css`, `PanelList.tsx/.css`, `MobilePanelStack.css`, `CommandBar.tsx`. The code matches D1–D11 and the owner rulings: tabs Home, Dashboards, Data, Pipelines, Me; the Assistant is reached through the header button; the active pill is an opaque `--app-surface-strong` fill with an inset 1px `--app-text` ring; the capsule glass (blur, 55% tint, `--app-border-strong`) is unchanged; the label is `--app-text` and the accent is on the icon only.

**Live app:** `start-servers.sh` READY on 7015/9922 and `assert-phase.sh servers` PASS. I used one throwaway user with 9 dashboards (including "Q") and 3 long markdown panels on two of them. I deleted that user afterwards through `buildUserDeleteSql` with its exact id and email; a count of `hel1583skep-%` users returns 0. I stopped the servers with `stop-servers.sh` (`STOPPED ports=7015,9922`).

- **AC1 (markdown text <= 28px from the edge at 375).** Measured from a text Range rect after `document.fonts.ready`: left = **27px** at 375 (light) and **27px** at 320 (`p` rect left). No horizontal overflow. Screenshots: `dash-375-light.png`, `dash-375-dark.png`. **Met.**
- **AC2 (one tap switches; active chip in view on load).**
  - One `click()` on the "Q" chip went to `/dashboards/55ee…` (title "Q · Dashboards"), and a click on "Hiring pipeline" switched back.
  - I switched to "Ops" through the name-button sheet. Ops is the last chip and was off-screen. The row then set `scrollLeft=737`, and the active chip sat at 310.7–363.0 inside a row 0–375 wide. `window.scrollY` stayed 0, so the page did not scroll vertically.
  - On load, the active chip was inside the row at 375 and 768.
  - **Met.**
- **AC3 (five tabs; active label visible; Connectors and Usage reachable; HEL-774 floors >= 3:1).**
  - Tabs: Home, Dashboards, Data, Pipelines, Me (the DOM has 5). The active tab is 121.8px wide at 375 and shows its label.
  - Data → "Sources | Connectors" sub-row → `/connectors` works (`connectors-375-dark.png`), and Data stays the current tab there.
  - The Me tab opens the user menu upward, above the nav (`me-375-dark.png`). My user is free tier, so Usage was not shown. The owner gating of Usage is unchanged `UserMenu` code, and the unit tests cover it (see below).
  - Contrast, re-measured by me from rendered pixels. I inserted a fixed backdrop under the nav, took a screenshot, and analysed it with PIL using the WCAG luminance formula. The capsule material was sampled 4px outside the pill, across 35–65% of the pill's width.
    - Dark theme over white: ring **3.43:1** at the outer ring row; the opaque fill's own edge is 3.96:1; inactive glyphs max 3.43:1. Pixels: ring (242,239,233), capsule (129,128,127). The owner's thin margin is real, and it holds above 3:1 (`nav-375-dark-overwhite.png`).
    - Light theme over black: ring **4.86:1**; inactive glyphs 4.91:1 (`nav-375-light-overblack.png`).
    - These match the executor's `measurements.md` table exactly.
  - **Met.**
- **AC4 (nothing floats over panel content except the glass nav; bottom clearance).** I enumerated every visible `position: fixed|sticky` element at 375. Only `.bottom-nav` is on screen; the skip link sits at y=-800. There are 0 zoom widgets on the phone shell (375, 768). Scrolled to the end of `.app-content`, the last card's bottom is at 711.6 and the nav's top at 732, a **20.4px** gap. **Met.**
- **Widths and themes:**
  - 320 (dark): tabs are 44/102/44/44/44, and every lozenge stays inside its own tab. The Dashboards label truncates to "Dashb…" (clientWidth 54, scrollWidth 74), as design D9 predicted (`dash-320-dark.png`).
  - 768 (light): stack layout, 12px edges, chip row, five-tab capsule (`dash-768-light.png`).
- **Desktop unchanged at 1280.** No chip row, no refreshed line, the zoom widget is present, `.panel-list` padding is 24px, the RGL grid renders and the bottom nav is `display: none`. The rail still has Connectors, Assistant and the avatar User menu (`dash-1280-light.png`).
- **Light/dark parity.** The chip row, cards and pill read consistently in both themes. The inverted active chip uses no accent, and the pill looks like the board's outlined pill.
- **Gates re-run by me at 5319977e4:**
  - Related jest suites (2 workers, nice 19): BottomNav, navDestinations, DataSectionTabs, DashboardChipRow, DashboardRefreshLine, PanelList*, MobilePanelStack, mobilePanelHeights, accentTextSourceSync, elevation/motion guards, AppShell.rail, UserMenu, CommandBar. Result: **28 suites, 260/260 passed**.
  - `npm --prefix frontend run typecheck`: exit 0.
  - Playwright (DEV_PORT=7015, 2 workers, nice 19, outputDir in SCRATCH) on `hel1583-glass-nav`, `hel1583-mobile-dashboard`, `hel1583-home-375`, `hel1574-shell-rail` and `hel813-mobile-touch-target-floor`: **104 passed (3.6m)**, and the harness deleted its 104 throwaway users.
- **Prior reports.** evaluation-4's CR1 (mono refreshed line) is a narrow diff, and the evaluator's red/green evidence is self-authenticating (computed font-family strings). I did not see the refreshed line live, because my fixture had no pipeline runs and the state is `unknown`. I rely on the evaluator's pasted e2e red/green for it, plus the CSS pin test, which passed in my jest run. No mtime-ordering claims were relied on, so there is no gate defect to record.

### Verdict: CONFIRM

### Non-blocking notes
- At 320 the active "Dashboards" label truncates to "Dashb…". This was anticipated and accepted in D9, and AC3 is still met. A follow-up could tighten the inactive tab floor or the capsule inline padding to fit the full word.
- `navDestinations.ts`: `connectorsPath`/`settingsPath` fall back to `""`. A missing section would make `underPrefix("")` match every path. This is latent and the evaluator flagged it too. A throw like `navEntry`'s would be safer.
- The name-button sheet changes the selection without changing the URL. This is pre-existing and the chips handle it (D3), but a reload returns to the URL's dashboard.
- On non-dashboard phone pages the header shows "Helio |" with an orphaned divider. This is not introduced by this diff (CommandBar's left side is untouched).
