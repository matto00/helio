## Evaluation Report — Cycle 3 (evaluation-3.md)

Reviewed commit: `c90df4304642978e12318efe47197f01737769db`. Its parent is 17bb3e99d. The base was resolved live: `d6aef6c46cfd3fcd47ebddd5519497d0f58c562b`.
Evidence is in `/home/matt/Development/helio/.concertino/runs/HEL-1487/evidence/` (`eval3-*`).
Scope of this cycle: the fix for skeptic-final-1's REFUTE, the heatmap row labels at 375 that overlapped because ECharts measures label height from '国' and gets about 6px with no CJK font installed.

### Phase 1: Spec Review — PASS

Skeptic change requests:
1. **CR1 met.** `heatmapHistogramOptions.ts` adds `categoryLabelLineHeight` (`ceil(fontSize*1.2)`) and `categoryLabelShowAll`. `buildChartOption.ts` applies them in normal mode to heatmap x/y and histogram x, using the axis' own `fontSize` with 12 as the fallback. In compact mode (`buildChartOption.ts:385-387`, `:399-401`) the line height is 12. The rendered result is in Phase 3.
2. **CR2 met.**
   - The new fixture is a 6-row heatmap (`service1..6`). At 375 the spec asserts `heat8Y.shown.length < 6` and `> 0`, plus no overlap.
   - Overlap boxes now use canvas `measureText` heights for the label's own font, centred on ECharts' box. They no longer use zrender's `getBoundingRect().height`.
   - The executor's red on 17bb3e99d (`hel1487-c3-e2e-RED-on-17bb3e99d.txt`) shows 375 light and dark red: 6/6 shown and 5 overlapping pairs. The green run shows 3/6 shown with no overlaps.
3. **CR3 met.**
   - Unit tests cover `lineHeight` 15 (normal) and 12 (compact) for heatmap x/y and histogram x. They also check that the histogram y axis has no `lineHeight`, and that line/bar x has no `lineHeight`.
   - The snapshot edit is limited as required (Phase 2).
   - Archived `tasks.md` 4.1 records the fix and its proof.

The spec text is unchanged and still accurate: "no two rendered labels overlap" is now actually true at 375.

### Phase 2: Code Review — PASS

**Gates, my own fresh run on c90df4304 (`eval3-gates.txt`):**
- lint, typecheck, format:check, check:openspec and **`npm --prefix frontend run build`** all exit 0. The executor had not run the build.
- `npm test`: 48 + 555 suites, 454 + 6140 tests, all passed.
- check:e2e-types, check:e2e-evidence-paths and check:e2e-user-cleanup all exit 0.

**Unit red, which the executor had not recorded.** I ran these mutations in a throwaway detached worktree at HEAD, since removed (`eval3-mutations.txt`). Targets: the heatmap/histogram option tests plus the unchanged-path guard.
- N1, `categoryLabelShowAll` without `lineHeight` (the 17bb3e99d behaviour): 12 failures.
- N2, the compact path drops its `lineHeight` override: 2 failures.
- N3, `lineHeight` applied to every chart type's x axis: 86 failures (the guard catches line/bar/scatter/pie drift).
- Baseline: 127/127 pass.

**Snapshot.** I compared it semantically against 17bb3e99d. Only `heatmap`, `histogram`, `timestamp x: heatmap` and `timestamp x: histogram` changed, and the only change is `axisLabel.lineHeight: 15` on heatmap x/y and histogram x. No other case moved.

**Code quality:**
- The new comments explain *why* (the '国' probe), per CONTRIBUTING.
- No `any` and no new `eslint-disable`.
- `fontSizeOf` is a small typed helper; it uses an `as` cast on an `unknown` input, which is fine.
- `CATEGORY_LABEL_SHOW_ALL` is still exported and is used by `categoryLabelShowAll`.
- No colour changes, so no `color-mix()`.

### Phase 3: UI Review — PASS

**Setup:**
- Servers came up via `start-servers.sh`, and `assert-phase.sh servers` printed PASS. The listening PIDs' cwd was this worktree.
- I used a throwaway user, `96d44345-6315-407e-8e54-7e0dadc341e3`, checked via `/api/auth/me`.
- Fixture: a 6-row heatmap, a 3-row heatmap, a 12-bin histogram, a time-axis line with a reference line, and a time-axis bar with a reference line and band.

**e2e on this head:** hel1487, hel1311, hel1305 and hel1306 gave **27 passed** (`eval3-e2e.txt`). heat8Y at 375 shows `service1, service3, service5` with no overlaps in light and dark. At 1440 it shows all 6.

**Rendered at 375, light and dark:**
- The 6-row heatmap shows `service1, service3, service5` at a 12px pitch (label box height 12).
- Ink-box overlaps are 0, measured with `actualBoundingBox`.
- For comparison, I set `lineHeight: null` in the live chart, reproducing 17bb3e99d. That gave a label box height of 6, a 6px pitch, 6/6 labels shown and 5 overlapping pairs. Restoring `lineHeight: 12` returned 3 labels with 0 overlaps.
- The 3-row heatmap shows 3/3 labels, the 12-bin histogram 3 labels. The line and bar charts show 7 x labels each with their reference marks, and have no `lineHeight`.
- Screenshots: `eval3-screens/light-375.png`, `eval3-screens/dark-375.png`.

**1440, measured against `lineHeight` removed live:**
- Heatmap plot height drops from 151.8 to 144px (-7.8px), because `containLabel` reserves the taller x-label line.
- Heatmap x labels sit 3.6px higher.
- Histogram plot height is unchanged (143). Its x labels sit 3.9px lower.
- All labels that fit are still shown: heat6 y 6/6, heat3 3/3, x 7/7, hist12 6/12.
- Nothing is clipped.
- The line and bar charts are identical: no `lineHeight`, same plot area `[166.5, 65, 832.5, 143]`, and the HEL-1305 time labels and HEL-1306 marks are present.
- Screenshots: `eval3-screens/light-1440.png`, `eval3-screens/dark-1440.png`.
- I judge this a small, uniform shift, not a regression. The skeptic owns the visual call.

**Console:** no errors from the change. The only errors are 401s before login and connection-refused after I stopped the servers.

**Cleanup:**
- The dashboard, 2 pipelines and 2 sources were deleted by exact id (204 each); re-listing returned 0/0/0.
- The user was deleted by exact id and email via `buildUserDeleteSql`; a follow-up count returned 0.
- Servers were stopped by exact PID: 1219157/1219142 and 1218919/1218765.
- MCP files were moved to `eval3-mcp/`.

### Overall: PASS

### Non-blocking Suggestions
- **The e2e overlap detector is the least strict of the measures on offer.** It uses `actualBoundingBoxAscent + Descent`, the ink box (9px for "service1" at 10px). The skeptic suggested the font box (`fontBoundingBox*`, 13px here) or `fontSize × lineHeight` (12px).
  - Measured against the font box, the shown compact rows at a 12px pitch would count as 2 overlapping pairs, although the ink gap is about 3px and the labels read cleanly.
  - The ink box is a defensible definition of a visible overlap, and the detector was red on 17bb3e99d either way.
  - Still, a future tweak that tightens pitch below the ink height would be caught late. Consider `fontSize × lineHeight` as the detector height.
- Carried over: wrap the long comments at `chartOverlayOption.ts:72` and `unchangedPathCases.ts:2`; reword `PanelDetailModal.mobile.css:216`; propose a split of `hel1311-heatmap-histogram-charts.spec.ts` in the PR description.
