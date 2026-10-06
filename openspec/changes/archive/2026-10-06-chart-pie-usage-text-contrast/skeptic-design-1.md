## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD `2c1884ac5b2cc2578320ace4a21e37b32df5c603` (branch `bug/chart-pie-usage-label-contrast/hel-1342`; the change dir is untracked, with no code changes). Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/chart-pie-usage-label-contrast/hel-1342`.

### What I verified (with evidence)

**Ticket / driver claims**
- "Pie labels use #333 with a white outline": **confirmed from source.** ECharts 6.1.0 `PieSeries.js` leaves the default `label.color` commented out (`// color: 'inherit'`). Pie labels are attached text (`PieView.js:176` `setLabelStyle(sector, ...)`). For attached text, `labelStyle.js:373-377` does not fall back to the global `textStyle.color`, which is why HEL-1263's `textStyle` never reached them. With no fill, zrender 6.1.0 `Element.js:159-166` uses `getOutsideFill()`, which is `DARK_LABEL_COLOR = '#333'` (`config.js:11`) because `isDarkMode('transparent')` is false (lum with alpha 0 against a background of 1). It uses `getOutsideStroke()` with autoStroke, which is white for a transparent background.
- "1.40:1 without outline": **confirmed analytically.** #333 (L=0.0331) on the dark `--app-surface` #1a1816 (L=0.0093) gives (0.0831/0.0593) = 1.40. D3 still re-measures it on the running app, which is correct.
- "UsageChart builds its own option and was never checked": **confirmed.** `UsageChart.tsx:47-90` spreads `appearanceToEChartsOption(...)`. That function sets colour only on the tooltip `textStyle` (`chartAppearance.ts` ~l.162). Axis labels get only `fontFamily`, and the global `textStyle` is `{fontFamily}` only. There is no colour on axisLabel, nameTextStyle or legend. `UsageChart` is the only ECharts call site outside the panel path (grep for `echarts-for-react|ReactECharts|echarts.init` outside tests: ChartPanel/ChartRenderer/echartsCore/UsageChart plus helpers).
- design.md's Context claims hold: `resolveChartTextColor` is at `appearance.ts:286`, `buildChartOption.ts:103` and the pie branch at lines 115-133, and `applyPie` runs only when `chartOptions.pie` exists (`chartTypeOptions.ts:148`). That validates D1's rejection of putting the colour in `applyPie`. `applyHoverEmphasis` (`chartAppearance.ts:242-262`) sets no label colour. No non-test config sets pie labels `inside`/`inner`/`center` (grep).

**D1 (pie labels, no placement escalation): sound.** Labels default to `position: 'outer'`, so the surface is the panel surface and `--app-text` is the right token. A post-merge pass covers the raw path and the aggregate path. Not escalating is correct, because no placement change is proposed. One mechanism detail the executor must get right (see the notes): in zrender `Text.js:226-234`, an explicit `fill` already suppresses the auto outline (`!defaultStyle.autoStroke || useDefaultFill`). `textBorderWidth: 0` is therefore not what removes the outline. Task 1.4 correctly makes the executor confirm this rather than guess.

**D2 (UsageChart): approach right.** `resolveChartTextColor(theme, undefined, tokens.text)` resolves through `resolvePanelTextColor(theme, "transparent", 0, "inherit")` to the live token. The card surface is `--app-surface` (`UsageCard.css:6`), the same surface §10 measured (#1a1816 / #fdfcfa). Rejecting a route through `buildChartOption` is justified, because that function is panel-shaped. All 4 usage charts render unconditionally (`AdminUsagePage.tsx:109,130,152,236`), and the DAU/WAU chart has 2 series, so it renders a legend. That makes measurement possible even with empty rollups.

**D4 (tests red on main):** the pie cases are genuinely red on main, because `series[].label.color` is undefined today. The UsageChart axisLabel and legend colour assertions are also red on main. The "both themes" part is vacuous as written (Change Request 2).

**D3 (measurement / owner-tier user): the stated mechanism does not work** (Change Request 1).
- `backend/build.sbt:124`: `Compile / run / envVars ++= loadDotEnv(baseDirectory.value)`, with `Compile / run / fork := true` (l.100). The forked JVM's env is the parent env overlaid with the `.env` map, so `.env` wins.
- The worktree's `backend/.env` (a regular file copy, not a symlink) **defines `HELIO_OWNER_EMAILS`** (set to the owner's own address).
- So "start this run's own backend with `HELIO_OWNER_EMAILS=<throwaway>`" through the process environment is silently overridden. The throwaway is not promoted, and `/admin/usage` is denied. `start-servers.sh` only injects `PORT`/`CORS_ALLOWED_ORIGINS` and inherits the env (`nohup env $cmd`), which does not help.

### Verdict: REFUTE

### Change Requests

1. **D3 / task 1.1: replace the owner-tier mechanism with one that actually works, and add a verify step.** A process-env `HELIO_OWNER_EMAILS` is overridden by `backend/.env` (`build.sbt:124` with `fork := true`; `.env` defines `HELIO_OWNER_EMAILS`). Pick one of these and write it into design.md D3 and task 1.1:
   - (a) **Preferred.** Edit only the **worktree's own** `backend/.env` copy so that `HELIO_OWNER_EMAILS` also contains the throwaway address. Back the file up first and record its checksum before and after. Restore it byte-identically afterwards, before any commit. Never touch the main checkout's `backend/.env`. This keeps the promotion on the documented allowlist path: CLAUDE.md says owner tier comes from `HELIO_OWNER_EMAILS`, "never a one-off DB edit".
   - (b) The fallback, only with a recorded justification: run `UPDATE users SET tier='owner' WHERE id=<recorded throwaway id>` on the throwaway's **own** row, then log in fresh. Record the statement and its row count in `evidence-ids.md`. This departs from the CLAUDE.md convention quoted in (a), so justify it in design.md if you choose it.

   Also add a verify step before any usage-page measurement: as the throwaway session, `GET /api/admin/usage?days=7` returns 200. Never put `matt@helio.dev` in the list.
2. **D4 / task 2.2: make the UsageChart "both themes" test non-vacuous.** In jsdom no theme CSS is loaded, so `resolveChartTheme()` returns `FALLBACK_CHART_THEME.text` (`#f2efe9`, the dark token) regardless of theme. An assertion of "equals the live text token in both themes" would then pass with the same value twice. That proves neither that the live token is read nor that it tracks a theme switch. Make three changes:
   - The test sets distinct `--app-text` values on `document.documentElement` for each theme (e.g. `#111111` light, `#eeeeee` dark), switches theme, re-renders or flushes the rAF tick, and asserts that the captured option follows the change.
   - Add a mutation to `mutation.txt` that hardcodes the fallback/dark token in place of `tokens.text`, and show that it turns the test red.
   - Keep the named axis-colour-removal mutation.

### Non-blocking notes
- **The pie outline mechanism, for task 1.4 and the D4 "no outline" guard.** The outline is zrender's autoStroke default (`Element.js:164-166`). An explicit label `color` alone already disables it (`Text.js:229-233`). Setting `textBorderWidth: 0` is harmless but redundant. Two consequences follow:
  - A unit assertion that merely checks `textBorderWidth === 0` guards a no-op. Prefer asserting that no `textBorderColor` and no positive `textBorderWidth` are set, and let the rendered measurement prove the absence of a stroke.
  - When measuring, read the painted style from the label Text element's **TSpan children** (or `_defaultStyle`), not only from `Text.style`. Before the fix, `style.fill`/`stroke` on the Text element itself are undefined; the painted values are #333 with a white `stroke` and `lineWidth` 2. The §10 "read `style.fill`" step alone would record `undefined` for the before state.
- Adding `theme` to UsageChart's `useMemo` deps is fine (it keeps exhaustive-deps happy). Theme tracking is actually driven by `themeSyncTick`.
- The pie label line keeps the sector colour (a stated non-goal). That is acceptable: it is a non-essential graphic, not text.
- Task 4.3's grep should find no new call sites (`UsageChart` is the only one outside the panel path), so expect "none" rather than inventing candidates.
