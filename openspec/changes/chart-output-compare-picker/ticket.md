# HEL-1350: Compare picker for chart Outputs (dashboard 'vs' overlay is unreachable from the UI)

## Description

origin_kind: followup
origin_ticket: HEL-1277

HEL-1277 (L7, e1aaf72f) draws a labelled "vs" overlay of the baseline series on dashboard chart panels whose Output has `config.compare`. The Output editor's compare picker (HEL-1275) only appears for **metric** Outputs. Chart owners therefore can't turn on the overlay from the UI; today it is only reachable through `PATCH /api/outputs/:id` or MCP.

## Acceptance Criteria

* The compare picker is offered for chart Outputs where the overlay can render. The picker's help text says when it can't: aggregated Outputs, more than 200 rows, under a filter, and unsupported chart kinds (pie, scatter, multi-series, normalized-stacked, horizontal bars). Better still, hide the picker for kinds that can never overlay.
* No "previous run" copy (HEL-1285).
* Add an RTL test, plus an e2e test that sets compare from the editor and sees the overlay on the dashboard. Check against the running app in both themes.

## Driver constraints (binding for this run)

* Reuse the existing `config.compare` server-side validation (HEL-1273); no new validation path.
* Do not add more "vs previous" / "previous run" copy; the L5 `compareLabel` path already says "vs previous" — leave it, don't extend it.
* Do not fix HEL-1351 (overlay coverage: aggregated Outputs, >200 rows) here.
* DESIGN.md is binding; compare against the RUNNING app in both themes.
* Tests: RTL + one e2e (editor sets compare -> overlay on dashboard). Use `isolateLivePage` and `e2e/support/settingsReady.ts` where relevant. E2E CI is 4 legs x 2 workers (HEL-1288).
* Do not touch `ci.yml`, `playwright.config.ts`, `.gitignore`.
* Local Playwright: at most 2 workers, `nice -n 19`. Backend tests (only if backend touched): `nice -n 19 sbt testFull`, Bash timeout 600000, at most 2 workers.
* Never bypass hooks. Never pattern-select deletion targets (no pkill/pgrep/killall). Record exact ids of any dev-DB rows/users created; delete by id; never touch matt@helio.dev.
* Own headless browser context + own ports (dev 6782 / backend 9689); NOT the shared Playwright MCP browser, NOT shared /tmp cookie jars; scratch stays inside the worktree.
* No writes under ~ outside the repo/worktrees; project-local npm cache.

## Owner rulings
* 2026-10-07 owner answer `show-with-inline-note` (escalation HEL-1350-1791340284334-73a9fa, recorded via `concertino answer`):
  show the Compare picker on EVERY chart Output, with fixed help text listing when the "vs" overlay won't show
  (aggregated Outputs, more than 200 rows, under a filter, pie, scatter, multi-series, normalized-stacked, horizontal
  bars). When THIS Output's own config already rules the overlay out (aggregated, series split, horizontal or
  normalized bars), add a specific note. Nothing is hidden, so a compare value set earlier stays visible and clearable.
  The chart KIND (pie/scatter/line/bar) is the panel's `appearance.chart.chartType`, not the Output's — so pie/scatter
  live only in the general help text; the Output-specific note covers only what the Output config determines.
