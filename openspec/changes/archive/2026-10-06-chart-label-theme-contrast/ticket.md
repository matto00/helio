# HEL-1263: Chart axis labels are low-contrast in dark theme (inherit appearance.color)

## Description

origin_kind: followup
origin_ticket: HEL-1178

Reported by the HEL-1178 evaluator and not verified by the driver.

In dark theme, chart axis labels look low-contrast. They take their colour from the panel's `appearance.color`, which defaults to `"inherit"`. The HEL-1178 final skeptic computed the ECharts options on main and on the HEL-1178 branch and found `"inherit"` in both, so the issue predates HEL-1178 and affects explicitly defaulted panels too.

## Acceptance Criteria

- Measure the label contrast against DESIGN.md tokens in light and dark, for line, bar, scatter and pie.
- Axis and legend text resolves to a theme token that meets the design standard's contrast, unless the panel explicitly sets a colour.
- Visual check against the running app in both themes.

## Driver constraints for this run (from the dispatching driver; treat its factual statements as claims to verify)

- DESIGN.md is binding: theme tokens; compare against the RUNNING app in both themes — token compliance alone does not prove readability.
- Contrast is measured as a ratio, in both themes, before AND after, with the applied WCAG threshold stated.
- Every chart kind `buildChartOption` renders (line, bar, scatter, pie) is checked.
- Do not touch `.github/workflows/ci.yml`, `playwright.config.ts`, `.gitignore`. HEL-1326 owns the metric headline/reducer files; HEL-1277 owns the history scrubber files.
- Local Playwright: at most 2 workers, under `nice -n 19`. At most one CI run at a time.
- Nothing written under `~` outside the repo/worktrees (npm logs/caches go to a project-local cache, e.g. `npm_config_cache=$WORKTREE_PATH/.npm-cache`).
- Shared dev DB: use your own throwaway user (never `matt@helio.dev`); record the exact id of every row/user created; never delete by pattern/name/time window.
- Own headless browser context, own allocated ports (dev 6695 / backend 9602). Playwright MCP output inside the worktree only. e2e specs use `isolateLivePage`.
