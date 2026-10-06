# HEL-1342: Chart contrast follow-ups: pie slice labels (#333 default) and admin UsageChart

## Description

origin_kind: followup
origin_ticket: HEL-1263

HEL-1263 (412aa16e) fixed axis and legend text colour across the chart kinds. Two gaps were out of scope:

1. **Pie slice labels.** They still use ECharts' default `#333` with a white outline. Without the outline that is 1.40:1 against the dark surface, and the labels look heavy next to the now-themed legend.
2. **Admin `UsageChart`.** It builds its own ECharts option outside `buildChartOption`, and nobody has checked it.

## Acceptance Criteria

- Route both through `resolveChartTextColor` and the theme tokens, or justify any exception.
- Measure contrast in both themes before and after, against WCAG 2.x 1.4.3 AA, using the same method as `docs/contrast-audit.md` §10 (and extend that section).
- Compare against the running app in both themes (DESIGN.md is binding).
- Add a test that fails on main.

## Driver constraints (binding for this run)

- Do not touch `ci.yml`, `playwright.config.ts` or `.gitignore`.
- Local Playwright: at most 2 workers, under `nice -n 19`. Own headless browser context, own ports (dev 6774 / backend 9681). Playwright MCP output inside the worktree. For e2e, use `isolateLivePage`.
- Never create/update/delete anything under `~` outside the repo and its worktrees — including npm cache and logs: use a project-local cache, kept out of the commit.
- Never pick deletion targets (processes included) by pattern, name or time window; never `pkill`/`pgrep`/`killall`. Recorded PIDs only.
- Record the exact id of every row/user created on the shared dev DB; delete own rows by those ids. Never create data under `matt@helio.dev`.
- Scratch logs in the session scratchpad with a `hel1342-` prefix.
- At most one CI run at a time.
