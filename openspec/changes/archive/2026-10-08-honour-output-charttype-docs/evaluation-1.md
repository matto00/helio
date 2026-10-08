## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `742fbe51d29e3ae39ce97600df5437ebed0ea6c7` (HEAD, unchanged from start to end of review).
Diff base: `6218cd479966e7c5f04a75d993216a464d726cd7`, resolved live by `resolve-review-base.sh`.

### Phase 1: Spec Review — PASS
Issues: none

- AC1 (repro renders bar without `update_panel_appearance`): the new e2e creates Outputs with
  `POST /api/pipelines/:id/outputs` (`add_output`) and places them with `POST /api/panels/batch` using the
  exact `place_outputs` body (no appearance). The rendered ECharts `series[].type` is `bar`/`pie`. I re-ran it
  myself: passes in both themes.
- AC2 (panel `chartType` overrides the Output): the "Override" panel PATCHed to `line` renders `line` live.
  The existing `resolvePanelChartType` precedence unit test from HEL-1351 also covers this.
- AC3 (`place_outputs` description): `placements.ts:44-49` now gives the three-level precedence and names
  `update_output` and `update_panel_appearance`. `write.ts:727-729` is corrected the same way. Both are
  asserted by `chartTypeDescriptions.test.ts`.
- The premise drift (HEL-1351 already fixed the render path) is recorded in ticket.md and proposal.md. The
  ticket-drift escalation was answered `proceed-with-restated-scope`, and no AC was dropped or reinterpreted.
- D1 (merge base `ChartAppearance.Default.copy(chartType = None)`) is in scope. Without it, a legend-only chart
  patch would store `"line"`, which then beats the Output's type. The "LegendOnly" e2e panel and the new
  `PanelAppearanceMergeSpec` case cover it. The red-on-main claim checks out by inspection: on base, the merge
  base is `Default` with `chartType = Some("line")`, so the unit assertion `chartType = None` fails, and the
  stored `"line"` wins in `resolvePanelChartType`. Timing also fits a red-then-green sequence: `model.scala`
  mtime is 00:53:06, the dev backend (sbt) started at 00:54:09, and the first two `hel1304-*` users were
  created at 00:52 (before the restart) with the next two at 00:54.
- All tasks 1.1-3.6 are checked off and match the diff. No scope creep.
- Spec deltas are well-formed. The `panel-appearance-settings` MODIFIED requirement keeps all three existing
  scenarios and adds one. `mcp-panel-composition-tools` adds a requirement.
- CONSTRAINTS: C1 holds (no edit to `ci.yml`, root `package.json`, the lockfile or `.audit-ci.jsonc`; new specs
  are auto-collected through `testDir: ./e2e`). C2: evidence goes through `evidencePath`, and source, pipeline
  and dashboard are deleted by exact id in `finally`. Users are logged by id but not deleted; there is no
  user-delete endpoint, and other specs follow the same convention (see residue below). C3 holds.

### Phase 2: Code Review — PASS
Issues: none blocking

I ran every gate myself in `WORKTREE_PATH`, all under `nice -n 19`:
- `npm run lint`: exit 0
- `npm run format:check`: clean
- `npm test -- --maxWorkers=3`: root jest 384/384 passed, including
  `helio-mcp/src/tools/chartTypeDescriptions.test.ts`; frontend 4900/4900 passed (464 suites)
- `npm --prefix frontend run build`: exit 0
- `cd backend && sbt testFull`: 6117 succeeded, 0 failed, 4 canceled (pre-existing), 440 suites, 0 aborted.
  This includes the new `PanelAppearanceMergeSpec` case "store no chartType when a chart patch without
  chartType lands on a panel with no stored chart (HEL-1304)".
- Extra checks: `npm run typecheck` clean, `check:e2e-types` clean, `check:e2e-evidence-paths` clean
  (63 files), and `check:scala-quality` with no inline-FQN violations.

Code notes:
- `model.scala:473`: a one-expression, minimal fix. `ChartAppearance.applyPatch` already passes
  `existing.chartType` through, so an explicit `chartType` in the patch still wins and `null` still clears it.
  The scaladocs on `Default` (`:224-227`) and `applyPatch` (`:461-465`) are accurate.
- I checked the UI side for a frontend path that re-invents `"line"`. `PanelDetailModal.buildInitialChart`
  defaults `chartType` to `"line"`, but output panels mount `AppearanceEditor` with `showChartSection={false}`,
  and `handleEditSubmit` sends only background, color and transparency. No chart write happens from the UI,
  so it does not re-introduce the defect.
- The MCP description test reads `write.ts` as source text, slices out the registration, and collapses the
  concatenated literals. That is a little brittle, but the file header explains why (`write.ts`'s Zod surface
  cannot be imported under ts-jest), and it follows the existing `scheduleTools.test.ts` approach.
- Frontend changes are docstring-only and accurate against `ChartOutputPanel`/`PanelCard`'s use of
  `resolvePanelChartType`.

### Phase 3: UI Review — PASS
Issues: none

- The servers came up through the canonical `start-servers.sh` (reused healthy instances) and
  `assert-phase.sh servers` printed `PASS servers`. I checked that the reused servers serve this worktree:
  pid 4077231 (vite :6736) has cwd `.../HEL-1304/frontend`, and pid 4081036 (sbt :9643) has cwd
  `.../HEL-1304/backend`, started 00:54:09, after the last `model.scala` edit at 00:53:06. The live D1 case
  passing is self-authenticating proof the backend has the fix: on base code that panel would store `"line"`
  and render line.
- Happy path: I ran `DEV_PORT=6736 BACKEND_PORT=9643 npm run e2e -- e2e/hel1304-output-charttype-render.spec.ts --workers=2`.
  Both tests passed (light 8.6s, dark 6.0s). Screenshot evidence was persisted:
  - `/home/matt/Development/helio/.concertino/runs/HEL-1304/evidence/e2e-evidence/HEL-1304/output-charttype-light.png`
    (sha256 `2ea187fb1ef6d68fb6c39be544c1e2da9cf2ede6dc7ddf0e164cb6dd8c1f1d10`): PlacedBar = bar,
    PlacedPie = pie, Override = line, LegendOnly = bar with the legend hidden, as patched.
  - `/home/matt/Development/helio/.concertino/runs/HEL-1304/evidence/e2e-evidence/HEL-1304/output-charttype-dark.png`
    (sha256 `e68ea7a6390ded4286c86fa477d5a609ebcf30ba1687a0df158f2c7521b4819c`)
- No component, CSS or layout code changed (frontend edits are comments only), so breakpoint, a11y and
  console-error behaviour cannot have changed. I did not run a separate breakpoint sweep; the e2e covered
  the 1440 viewport.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- `model.scala` is now 1306 lines (was 1300; soft budget ~250, and CONTRIBUTING.md:24 asks to "propose a split
  in the PR description" when editing a file over ~400). The PR body should carry a one-line split note.
- `e2e/hel1304-output-charttype-render.spec.ts:36,39` uses `any` for the React-fiber walk. HEL-1351's spec
  does the same and lint passes; a shared typed helper in `e2e/support` would remove the duplication between
  the two specs.
- **Dev-DB residue (exact ids, identified read-only, nothing deleted):** six `hel1304-*@example.test` users
  remain in the shared dev DB. None owns any dashboards, data sources or pipelines; per-test cleanup worked.
  - Executor runs: `1f73c639-c096-46d4-b779-9571b956b88e` (light, 00:52:37) and
    `1de634ba-ff49-4b91-a3a3-9e982ddcf2a3` (dark, 00:52:43). These are likely the unrecorded red-run users:
    they were created before the 00:54:09 backend restart. Also `d012f0cf-b215-4d17-8acf-2595dea1565e`
    (light, 00:54:19) and `9e8e7790-cd15-44fd-a05a-59eaabbacc94` (dark, 00:54:24).
  - Evaluator run (this review): `a1e46c52-cb1d-4e02-988e-b9e6c9542e7e`, `e3f305e7-f707-49dd-9720-6ce0eee8e4ec`.
