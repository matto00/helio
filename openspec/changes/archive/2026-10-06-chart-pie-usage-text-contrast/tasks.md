## Standing Constraints

## 1. Measure before (running app, both themes)

- [x] 1.1 Start own servers on dev 6774 / backend 9681, verify each server process cwd is this worktree, create a throwaway user (never `matt@helio.dev`), record its id, then promote that row only with `UPDATE users SET tier='owner' WHERE id='<id>'` (statement + row count recorded; never edit `backend/.env`) and log in fresh. Verify: `GET /api/admin/usage?days=7` as the throwaway session returns 200; `evidence-ids.md` lists the user id and every dashboard/panel/pipeline/source/output id.
- [x] 1.2 Seed a default pie panel (>= 3 slices) and a percent-label pie panel (percent labels on the second Output's config, distinct panel titles; cycle-2 corrected); open the admin usage page as the throwaway owner. Verify: both pies and the usage charts render with text; percent labels read "Name: NN.NN%".
- [x] 1.3 Measure (reading pie label painted style from TSpan children / `_defaultStyle`, not only `Text.style`) per `docs/contrast-audit.md` §10 method (zrender `style.fill` + outline props, DPR-2 rect pixels, sampled surface) for pie slice labels and every usage-chart text kind, light and dark; screenshot both surfaces in both themes. Confirm or correct the ticket's 1.40:1 claim. Verify: `measure-before.md` + `before-*.png` in the change dir.
- [x] 1.4 Confirm the real ECharts 6.1 property that paints the pie label outline (source or rendered style). Verify: cited in `measure-before.md`.

## 2. Red-first tests

- [x] 2.1 Extend `buildChartOption.textColor.test.ts` with the pie slice label cases (inherited, absent, percent labels, aggregate, explicit colour, no outline). Verify: red on unchanged code, output saved to `red-first.txt`.
- [x] 2.2 Add a `UsageChart` test capturing the ECharts `option` prop, with DISTINCT `--app-text` values set on `document.documentElement` per theme, switching theme and flushing the rAF recompute, asserting axis labels, axis names, legend and global textStyle colour follow the live token (fontFamily kept). Verify: red on unchanged code, appended to `red-first.txt`.

## 3. Implement

- [x] 3.1 `buildChartOption`: post-merge pie pass setting every series `label.color = textColor` and neutralising the default outline (D1); handle emphasis label colour if ECharts/`applyHoverEmphasis` re-sets it. Verify: 2.1 green, all existing HEL-1263 tests green.
- [x] 3.2 `UsageChart`: resolve with `resolveChartTextColor(theme, undefined, tokens.text)` and write into textStyle, legend.textStyle, axisLabel.color and nameTextStyle (D2). Verify: 2.2 green.
- [x] 3.3 Mutation proof: (1) remove the pie label colour, (2) remove the UsageChart axis colour, (3) hardcode the fallback/dark token in place of `tokens.text` in UsageChart; each turns its test red. Verify: `mutation.txt`.

## 4. Measure after + docs

- [x] 4.1 Re-measure exactly as 1.3 on the running app, both themes; screenshots `after-*.png`; visual comparison against DESIGN.md and the adjacent themed legend/axes. Verify: `measure-after.md`, every new text >= 4.5:1.
- [x] 4.2 Extend `docs/contrast-audit.md` §10 with the pie slice label and usage chart rows (before -> after, threshold, scope note, evidence paths). Verify: Prettier/format check passes on the doc.
- [x] 4.3 Grep for any other ECharts option builder / `ReactECharts` call site outside `buildChartOption` and `UsageChart`; list it as a follow-up candidate in `measure-after.md` (do not fix).

## 5. Gates + cleanup of own data

- [x] 5.1 Run lint, typecheck, format check and the Jest suite via the repo's pinned commands (project-local npm cache, never `~/.npm`). Verify: all green.
- [x] 5.2 Delete every created row/user by the exact ids in `evidence-ids.md`, children first (several FKs to `users(id)` have no ON DELETE CASCADE); rows created implicitly (e.g. `pipeline_run_rate_window`, telemetry) are deleted by the recorded user id, never by pattern; stop own servers by recorded PID. Verify: delete counts recorded in `evidence-ids.md`, final user delete succeeds.
