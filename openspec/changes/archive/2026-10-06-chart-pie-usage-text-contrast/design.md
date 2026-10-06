## Context

See proposal.md (Why). Current state on main (2c1884ac5):

- `resolveChartTextColor(theme, appearance, liveTextToken)` (`frontend/src/theme/appearance.ts:286`, HEL-1263) returns an
  explicit `appearance.color` unchanged and resolves `"inherit"`/absent/empty to the live `--app-text` token.
- `buildChartOption.ts:103` computes `textColor` with it and writes it into `textStyle` and `legend.textStyle` for pie
  (lines ~116-135). Nothing sets `series[].label.color` for pie. `chartTypeOptions.applyPie` only spreads the existing
  `s.label` and adds a percent `formatter` when `showPercentLabels` is on. So slice labels take ECharts 6.1's own pie
  label default. `docs/contrast-audit.md` §10 records this as `#333` with a light outline, "outline-confounded", not
  measured. The ticket's 1.40:1 figure is a claim to re-measure, not a fact.
- `UsageChart.tsx` (admin usage page, owner-only) calls `appearanceToEChartsOption(defaultChartAppearance-derived, resolveChartTheme())`
  and spreads it. `appearanceToEChartsOption` sets `fontFamily` on `textStyle`/axis labels and `color` only on tooltip
  text. No colour reaches axis labels, axis names, legend text or global `textStyle`, so they render in ECharts' built-in
  defaults (not DESIGN.md tokens) in both themes. It already has `theme` from `useTheme()` and a `themeSyncTick` rAF
  recompute, the same as `useChartOption`.
- Chart canvases are transparent (`backgroundColor: "transparent"`); the surface behind pie labels is the panel card
  surface, and behind usage charts it is the usage card surface (`UsageCard.css`). Both must be sampled, not assumed.

## Goals / Non-Goals

**Goals:** pie slice labels and every piece of usage-chart text resolve through `resolveChartTextColor` to a DESIGN.md
token, measure >= 4.5:1 (WCAG 2.x SC 1.4.3 AA, normal text — these labels are ~12px) on their rendered surface in both
themes, and are guarded by jsdom tests that are red on main.

**Non-Goals:** changing pie label position, content, font size, or label-line colour (label lines are graphics, not
text; SC 1.4.3 does not apply, and they follow the sector colour by design); restyling series/sector colours; tooltip text
(already tokened); `buildChartOption` refactors beyond the pie label pass; any other chart surface (the executor greps for
other `ReactECharts`/`echarts.init` call sites and records any it finds as follow-up candidates, not in scope).

## Decisions

**D1 — Pie slice labels take `textColor`, applied as a post-merge pass in `buildChartOption`.** After
`applyChartTypeOptions` (so the percent formatter is already present and preserved), for `chartType === "pie"` map every
series to `label: { ...existingLabel, color: textColor }` An explicit label `color` already suppresses zrender's auto outline (`Text.js:226-234`, skeptic design r1/r2), so no
`textBorderWidth`/`textBorderColor` is added unless the rendered measurement shows a stroke remains. Running it as its own pass after merge covers both the raw
and the aggregate (`buildAggregateDataOption`) series paths with one rule.
- Alternative: put the colour into `applyPie`. Rejected — `applyPie` only runs when `chartOptions.pie` exists, so a pie
  with no persisted per-type options would keep the default.
- Alternative: keep the outline and only change the fill. Rejected — a light outline around light dark-theme text is the
  "heavy" look the ticket describes, and an outline must not be what carries contrast (spec).
- Emphasis: if hover emphasis (`applyHoverEmphasis`) or ECharts' pie emphasis re-sets a label colour, the executor makes
  the emphasised label resolve to the same `textColor` and records what it found.
- **Exception, justified:** labels stay outside the slices (ECharts' default `position: "outside"`; no config in this repo
  sets `inside`). Their surface is therefore the panel surface, the same surface the themed legend is measured against,
  which is why `--app-text` is the correct token. Inside-slice labels would sit on the sector colour and need a different
  rule; no reachable config produces them, so that is not built here. This is a recorded exception, not an escalation:
  no placement change is proposed, so no design decision is being taken on the owner's behalf.

**D2 — `UsageChart` resolves its text colour with `resolveChartTextColor(theme, undefined, tokens.text)`.** The usage page
has no panel appearance, so the `undefined` appearance makes it resolve exactly as an inherited panel colour does: the
live `--app-text` token. Write it into global `textStyle` (merged over the base `fontFamily`, F-196), `legend.textStyle`
(merged likewise), `xAxis`/`yAxis` `axisLabel.color`, and `nameTextStyle`, mirroring what `buildChartOption` does for
non-pie charts. Add `theme` to the `useMemo` deps.
- Alternative: route `UsageChart` through `buildChartOption`. Rejected — `buildChartOption` is panel-shaped
  (rows/headers/fieldMapping/aggregate) and the usage page passes pre-aggregated series with `null` gaps; forcing it
  through would be a larger, riskier refactor for no behaviour gain.
- Alternative: a shared `applyChartTextColor(option, color)` helper used by both. Rejected for this ticket — it would
  restructure `buildChartOption`'s HEL-1263 code path (refactor discipline: keep behaviour-preserving changes out of a
  bug fix). Noted as a follow-up candidate if a third call site appears.

**D3 — Measurement is the arbiter, on the running app, same method as `docs/contrast-audit.md` §10.** Before (on this
branch before any code change) and after, in light and dark, on own ports (dev 6774 / backend 9681), own headless browser
context, own throwaway user:
- every zrender text element of each chart (`echarts.getInstanceByDom(...).getZr()`): record `style.fill` and any outline
  (`stroke`/`lineWidth`); screenshot its rect at DPR 2; the painted colour is the glyph pixel farthest from the rect's
  background mode; the surface is sampled from a background pixel. Report the "without outline" ratio of the fill against
  the surface for before (that is the ticket's 1.40:1 claim — confirm or correct it), and the painted ratio after.
- pie: a default (`"inherit"`) pie panel with >= 3 slices, plus one with percent labels on, on a dashboard owned by the
  throwaway user.
- usage page: needs an owner-tier session. A process-env `HELIO_OWNER_EMAILS` does NOT work: `backend/build.sbt:124`
  overlays `backend/.env` (which defines `HELIO_OWNER_EMAILS`) onto the forked JVM's env, so `.env` wins (skeptic
  design round 1, CR1). Mechanism instead: after creating the throwaway user, promote **that row only** with
  `UPDATE users SET tier='owner' WHERE id='<recorded throwaway id>'` (statement + row count recorded in
  `evidence-ids.md`; never `matt@helio.dev`, never any other row, never `backend/.env`), then log in fresh.
  Justification for the row edit over editing the worktree's `backend/.env` copy (skeptic r1 offered both): CLAUDE.md's
  "never a one-off DB edit" describes how real accounts get owner tier (prod allowlist, both auth paths); it is not
  a ban on test fixtures. This throwaway row is created by this run, is promoted by its exact id, and is deleted by that id
  at cleanup. The `.env` route instead mutates a secrets-bearing config file that the backend re-reads on every start,
  and it needs a byte-identical restore that could be missed. A miss would silently grant owner tier to an extra address
  on every later restart of this worktree's backend, or reach the main checkout's copy if a path is mistyped. Both routes
  leave no lasting change on success. The row edit has the smaller failure blast radius and is undone by the same delete
  that removes the user.
  Verify before any usage-page measurement: as the throwaway session, `GET /api/admin/usage?days=7` returns 200. All four usage charts
  render unconditionally (DAU/WAU has 2 series, so a legend), so empty rollups still give measurable text; if a chart
  does not render, record that honestly and escalate rather than measure a substitute.
- Reading painted style: before the fix, a pie label `Text` element's own `style.fill`/`stroke` are undefined; the painted
  values live on its TSpan children / `_defaultStyle` (`#333`, white auto-stroke, lineWidth 2). Read those, not only
  `Text.style`, so the before state is not recorded as `undefined`. Note (verified by the skeptic from zrender
  `Text.js:226-234`): an explicit label `color` already suppresses the auto outline, so `textBorderWidth: 0` is redundant;
  do not add it unless the rendered measurement shows it is needed.
- Extend `docs/contrast-audit.md` §10 with new rows (or a §10.1 subsection) in the existing before -> after table format,
  threshold stated, plus an honest scope note (what already passed before). Screenshots of both surfaces in both themes,
  before and after, in the change dir. Compare against the running app in both themes against DESIGN.md (labels must read
  as the same text as the legend/axes beside them).
- Every created user/row id is recorded in `evidence-ids.md` and deleted by those ids at the end.

**D4 — Regression guards are jsdom tests on the option, red first.**
- `buildChartOption.textColor.test.ts` (extend): pie, inherited/absent colour -> every `series[].label.color` equals
  `themeTokens.text` and no outline; pie with `chartOptions.pie.showPercentLabels` -> formatter kept and colour set;
  aggregate pie path; explicit `#336699` passes through to the labels.
- `UsageChart` test (new, e.g. `UsageChart.test.tsx`): mock `echarts-for-react/esm/core` to capture the `option` prop.
  jsdom loads no theme CSS, so `resolveChartTheme()` would return the dark fallback (`#f2efe9`) in both themes and a
  "both themes" assertion would be vacuous (skeptic CR2). So the test sets DISTINCT `--app-text` values on
  `document.documentElement` per theme (e.g. `#111111` light, `#eeeeee` dark), switches theme, flushes the rAF
  `themeSyncTick` recompute, and asserts the captured option's axisLabel/nameTextStyle/legend/global textStyle colours
  follow the change (and `fontFamily` survives). This shape runs on main unchanged, so it is genuinely red on main.
- The pie "no outline" guard asserts no `textBorderColor` and no positive `textBorderWidth` are set on slice labels (not
  merely `textBorderWidth === 0`, which would guard a no-op); the rendered measurement proves the absence of a stroke.
- Record red-on-main output (`red-first.txt`) and one mutation per guard that turns it red (removing the pie label
  colour; removing the UsageChart axis colour), in the change dir. Mutations: (1) remove the pie label colour; (2) remove the UsageChart axis colour; (3) hardcode the
  fallback/dark token in place of `tokens.text` in UsageChart — each must turn its test red.
- No new committed e2e spec: rendered measurement is evidence, not a CI gate (same as HEL-1263 D6).

## Risks / Trade-offs

- [Removing the outline makes a label that overlaps a slice harder to read.] -> Outside labels do not overlap slices in
  the default layout; the D3 screenshots in both themes are what the skeptic judges. If an overlap is observed in the
  running app, that is evidence for an escalation, not a silent outline restore.
- [Explicit low-contrast panel colour applied to slice labels.] -> Same policy as HEL-1263 axes (explicit colour honoured);
  already a recorded follow-up candidate there.
- [Usage page owner-tier seeding touches the shared dev DB.] -> Throwaway user only, ids recorded, deleted by id.

## Planner Notes

- Self-approved: no placement change for pie labels (D1 exception), so no design escalation. If measurement or the
  running app shows the fix needs a placement change (e.g. inside vs outside), the executor must stop and escalate early
  (the owner is offline overnight).
- No gate-chain (`.husky/**`) impact.
