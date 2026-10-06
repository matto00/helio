## Skeptic Report — final gate (round 1, skeptic-final-1.md)

**Reviewed HEAD:** `bb70d84726df8bbfef39e45116837351aed84876`.
**Review base:** resolved live with `resolve-review-base.sh` as `3962e6eb2c09a009259c8f75f2cf1aa4c1fe3526`. The diff is 77 files, +3878/−79.

**Evidence:** `EV/` means `/home/matt/Development/helio/.concertino/runs/HEL-1277/evidence/openspec/changes/output-history-scrubber-diff/screenshots/final/`. Every file there was persisted with `persist-evidence.sh` when it was captured, and worktree copies are under `screenshots/final/`. No claim below depends on mtime ordering.

### What I verified (with evidence)

**Spawn guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/pipeline-run-scrubber-overlay/HEL-1277`.

#### Gates (re-run by me; nothing taken from the evaluator)

| Gate | Result |
|---|---|
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run format:check` | exit 0 |
| `npm run check:schemas` | in sync |
| Targeted frontend jest (`--maxWorkers=2`): outputHistory, diffRows, triggerSourceLabel, chartOverlay, formatCaptureTime, outputHistoryService, rowsTruncated, ChartPanel, PanelContent, buildChartOption, TableRenderer, DataGrid, OutputsGalleryTab, RunHistoryModal, token guards | 32 suites, 514 tests, all pass |
| Root jest `outputsHandlers` (MCP `includeSummaries` series strip) | 20/20 pass |
| `nice -n 19 sbt testFull` | 6042 tests, 0 failed, 432 suites, 0 aborted |
| `e2e/hel1277-output-history-scrubber.spec.ts` (`DEV_PORT=6709`, `--workers=2`, `nice -n 19`) | 4/4 passed in 20.9s |

- **sbt details.** No "Java heap space". `FirstRunRoutesSpec` ran without a timeout. `sbt --client shutdown` was run as its own call.
- **`-n` commits.** Running `npm --prefix helio-mcp run typecheck` gives exactly one error, `src/index.ts(58,52): TS2554`.
  - `helio-mcp/src/index.ts` is not in the diff.
  - The installed `helio-mcp/node_modules/@modelcontextprotocol/sdk` is `1.29.0`, but `package.json` requires `^1.31.0`.
  - The changed helio-mcp files type-check clean.
  - The cause is environmental, as claimed.
  - CLAUDE.md asks for any bypass to be stated, so the PR body must state both `-n` bypasses.

#### Acceptance criteria, traced

**AC1: "Scrubbing shows each point's summary, and its rows when a payload exists."**
- **Code.** `OutputHistoryModal.tsx` contains `HistoryScrubber`, `HistorySummary`, `HistoryChart` and `HistoryRows`.
  - `useOutputHistoryView.ts` fetches `limit=100` and loads payloads only when `hasPayload === true`.
  - It uses a payload map keyed by point id, so a late response for an unselected point cannot render.
- **Running app (both themes).** I seeded three real runs on a beta user. The second point, compared with the first, shows:
  - capture time, trigger chip, row count and the column-stats grid;
  - stored rows, with west 250 and north 300 marked "New or changed" and east 100 unflagged;
  - the note "1 row from Oct 6, 02:31 PM no longer present".
  - The output is correct. Evidence: `EV/history-view-diff-light.png` and `EV/history-view-diff-dark.png`.
- **Missing payload never reads as removal.**
  - Code: `HistoryRows.tsx` computes `diff` only when both payloads have status `ready`.
  - Tests: the "never reads a missing comparison payload as removed rows" and comparison-error tests.
  - e2e: a summary-only newest point shows "Rows weren't stored…", 0 highlights and 0 removal count.
  - Running app: a chart Output with no payload shows "Rows weren't stored for this run — summary only." (`EV/history-view-chart-*.png`).
- **Real-world case.** The data-source `PUT` caused an auto-run, which produced an identical third point. The newest point then correctly showed no highlight and no removal count, and the trigger chip read "Auto-run". That confirms the `triggerSourceLabel` fix works on the live app.

**AC2: "The overlay series is labelled."**
- **Code.** `chartOverlayOption.ts` sets `name: overlay.label` and appends the label to `legend.data`.
- **History view.** The legend reads "vs Oct 6, 02:32:41 PM" (`EV/history-view-chart-*.png`).
- **Dashboard panel (6×5).** The legend reads "vs previous" in both themes (`EV/dashboard-chart-overlay-{light,dark}.png`).
- **Compact panel.** On a default-size panel (canvas 148px, which is compact), the legend is hidden and the label appears in the axis tooltip ("vs previous 250"; `EV/dashboard-default-size-tooltip-dark.png`). This behaviour is explicit in design D8 and covered by a test. See non-blocking note 1.

**AC3: "Light and dark visual checks."**
- I made my own captures in both themes of the History diff view, the History chart view, the dashboard overlay, the gallery card and the public view.
- The changed-row wash is the accent-surface token: `color(srgb .918 .345 .047 / .11)` in light and `/ .15` in dark. In both themes it reads as a tint, and the text stays at full contrast.

#### Driver constraints

- **No "previous run" copy.** A grep of the added frontend/helio-mcp lines for `previous run` finds only test negations.
- **Public route is summary only.** Using a cookie-less context and a share token on the running backend:
  - `GET /api/dashboards/:d/panels/:p/history` → 200, carries `baseline.series`, with 0 occurrences of `"id"`, `hasPayload`, `runId` or `triggerSource`;
  - the payload route `GET /api/outputs/:o/history/:pt/rows` → **401** with the token and **401** without it;
  - the public viewer renders the overlay (`EV/public-dashboard-overlay-dark.png`).
- **No historyPayloads toggle.** There is no `historyPayloads` in added frontend code.
- **No migration.** There is no migration and no change to `playwright.config.ts`, `.github` or `.gitignore`.
- **e2e isolation.** The e2e spec uses `loginThenIsolate` before API seeding.

#### Owner rulings C1–C4

- **C1.** The History view opens from the gallery card's sibling "History" button. `RunHistoryModal`'s only change is the trigger-label helper.
- **C2.** `diffRows` is a canonical-key multiset. It has no cell-level highlight and runs only when both payloads exist.
- **C3.** The comparison is `points[selectedIndex+1]`, labelled by capture time. Seconds are added when two points fall in the same minute.
- **C4.** On dashboards, `ChartOutputPanel` with `selectChartOverlay` returns no overlay when any of these hold: `filterActive`, `rowsTruncated !== false`, a downsampled series, a mode/x/y mismatch, or a repeated x. The changed-rows highlight is used only by `HistoryRows`.

#### Design judgment (DESIGN.md, running app, both themes)

- **History view.** It reuses `Modal`, `IconButton`, `StatusChip`, `DataGrid`, `TableRenderer`, `ChartRenderer`, `EmptyState`, `Spinner` and `InlineError`. The CSS is all tokens. The typographic hierarchy matches sibling modals, and the light and dark versions are at parity.
- **Bar overlay (known item).** The overlay and primary bars sit side by side, so each bar is half width (`EV/dashboard-chart-overlay-*.png`, `EV/history-view-chart-*.png`). I judge this acceptable. A grouped "current vs comparison" bar layout is a standard, readable convention. The comparison series is clearly subordinate: a muted translucent fill with an opaque token border, about 6–7:1 at the boundary per evaluation-2. It is legend-labelled. Overlapping ghost bars (`barGap:-100%`) would be an alternative, not a correction.
- **Pinning disabled in the History view (known item).** I judge this acceptable. The table is a read-only snapshot, and a pin control that appeared and disappeared while scrubbing would be worse.
- **History button.** It is 79×28 (`--control-sm`). Measured on the running app:
  - Light hover: `#fff` on the hovered card's `rgb(239,236,230)`.
  - Dark hover: `rgb(35,32,25)` on `rgb(22,21,20)`.
  - Both give visible feedback against the real backdrop, which is surface-soft once the card is hovered. That is consistent with HEL-866's measure-the-backdrop rule.
  - Minor deviations from the §5 Ghost recipe are listed in note 2.
- **Console.** Each theme logged one 404 resource error. It matches the pre-existing `/schedule` 404 for a pipeline with no schedule (also reported in evaluation-2). There were no page errors.

#### Gate-defect check

- Evaluation-2 reports no unsound evidence-mtime problem, and this report does not rely on mtime ordering. No gate defect to record.

### Verdict: CONFIRM

### Non-blocking notes

1. **Compact panels show no visible overlay label.** A dashboard chart panel at its default placement measures compact (148px canvas against the 179px threshold). Its legend is hidden, so the "vs" series is labelled only in the hover/tap tooltip. This matches design D8 and the app-wide compact legend rule, so it meets AC2 as designed. Still, a dashed or grey twin series with no visible key on the default-size panel, and on public/kiosk views, is worth a follow-up, for example a compact inline "vs …" caption.
2. **History button differs slightly from DESIGN.md §5 Ghost.** In `OutputGalleryCard.css` `.output-gallery-card__history`, it uses `--app-radius-md` (9px) where the recipe says `--app-radius-sm` (6px), and weight 400 where the recipe says `--weight-medium`. These are small polish fixes.
3. **History rows layout and an "unchanged" state.** The table has a fixed 360px height, so with a few rows the "no longer present" note sits far below the table (`EV/history-view-diff-*.png`). Also, when two payload points are identical, the "Change" column is empty and nothing says "No row changes"; a one-line note would help.
4. **"vs previous" label.** The dashboard overlay label "vs previous" comes from the existing L5 `compareLabel`, and design D9 specifies it. It is not "previous run" copy, but HEL-1285's semantics question applies to it too.
5. **PR body must state** both `git commit -n` bypasses and their causes, and the two follow-ups the design notes but has not filed (a chart Compare picker; the editor preview grouping by aggregation while dashboards do not). Task 5.4 is still unchecked.

### Hygiene

- All scratch files were kept under `.concertino/skeptic-hel1277/`.
- Every dev-DB id I created, plus those from my e2e re-run, is appended to `residue.md` and was deleted by exact id. Counts were verified at 0, and `matt@helio.dev` was excluded in SQL.
- The servers on 6709/9616 were stopped by exact PID: 1547555, 1547525, 1547180, 1546990 and 1546948.
