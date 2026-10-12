## Evaluation Report — Cycle 4 (evaluation-4.md)

Reviewed commit: `8fb843d1b50c787e2e9e1a5101cf423224572a99`. It is the merge of df59fee0f (this round's fix, `textMargin [0, 8]`) with origin/main 9e51550f1 (HEL-1490 #962 and HEL-1437 #961). The base was resolved live: `9e51550f16b7a2d29250e7b2f7e5b8c91076349f`.
Evidence is in `/home/matt/Development/helio/.concertino/runs/HEL-1487/evidence/` (`eval4-*`).
This is the last allowed final round.

### Phase 1: Spec Review — FAIL

**AC1 regression: the heatmap column axis at 375 is back to every-other labels, though all 7 fit.**
- With the shipped `textMargin [0, 8]`, a 7-day heatmap at 375 shows **Mon, Wed, Fri, Sun (4/7)**, in light and dark. This is exactly the automatic every-other thinning the ticket exists to remove.
- The seven labels fit:
  - The real-text gap between neighbours is **14.57px** for the 3-row heatmap and **12.0px** for the 6-row heatmap.
  - Both meet the change's own legibility threshold: the e2e asserts ≥ 14px, and skeptic-final-2 CR1 says ≥ 12px at the 10px compact font.
- Before HEL-1487, all 7 showed at 375 (`hel1487-e2e-axislabels-RED-before-fix.txt`: light-375 heatX `["Mon",…,"Sun"]`). They also showed 7/7 on c90df4304 (evaluation-3). This round introduced the regression.
- My own e2e run confirms it. Ten runs of hel1487 on this head show `heatX 4` at 375 in both themes every time. The spec does not assert heatX at 375, so it passes anyway.
- Screenshot: `eval4-screens/dark-375-shipped.png`.

**(a) "8, not the skeptic's 10, because 10 dropped a 10-bin label that fits."** Only partly true, and the source comment overstates it.
- In the e2e's layout (where the last pair's gap is 16.75px), 8 shows 10/10 and 10 would show 9/10.
- On a real dashboard I built, the hist10 chart was 1110px wide and the last pair's gap was **14.85px**. There, 8 **also** hides "100 to 110" (9/10), exactly like 10.
- Measured live at 1440 by setting `textMargin` in the running chart: margins 3, 6 and 7 show 10/10; margins 8 and 10 show 9/10.
- So 8 hides a label whose gap (14.85px) exceeds the change's own 14px threshold.
- ECharts' `hideOverlap` hides a label once its gap drops below about 2 × margin. A margin of 8 therefore enforces about 16px, while the e2e checks 14px. The two thresholds disagree.

**(b) "In dark 1440 the widest last label can be hidden."** This is not a theme effect.
- In the executor's own `hel1487-c4-e2e-GREEN-final.txt`, hist10 shows 9 labels in **both** light and dark, with identical minGaps (23.75). In `hel1487-c4-e2e-GREEN.txt` it shows 10 in both themes.
- My hel1487 runs: 10/10 runs gave 10/10 labels in both themes, with an identical last gap of 16.75px.
- Live, light and dark give identical geometry (9/10, last gap 14.85px).
- Fonts are not the cause either. The axis font is `"JetBrains Mono", ui-monospace, …`. "100 to 110" measures 72px whether JetBrains Mono is loaded, in fallback, or plain `monospace`.
- What decides 9 or 10 is the last gap against the ~16px that margin 8 enforces. The e2e layout puts it at 16.75px, within about 0.75px of the threshold, so the outcome is borderline. My manual dashboard has a slightly narrower pitch (14.85px), and the label is hidden.
- The relaxed assertion (`hist10 >= 8 shown`) therefore masks a real "label fits but is hidden" case rather than a flaky measurement. The rationale in tasks.md 4.2 and the source comment (`heatmapHistogramOptions.ts:48-50`) misstates the cause.

**Other AC1 checks pass:**
- Heatmap x is 7/7 at 1440.
- hist5 is 5/5 at 1440.
- No overlaps anywhere.
- 6-row heatmap y at 375 shows 3/6.

### Phase 2: Code Review — FAIL

**Gates, my own fresh run on 8fb843d1b (`eval4-gates.txt`):**
- lint, typecheck, format:check, check:openspec and `npm --prefix frontend run build` all exit 0.
- `npm test`: 48 + 562 suites, 454 + 6168 tests, all passed.
- e2e-types, evidence-paths and user-cleanup checks all exit 0.

**(e) Snapshot:** compared semantically against c90df4304. Only `heatmap`, `histogram`, `timestamp x: heatmap` and `timestamp x: histogram` changed. The only change is `xAxis.axisLabel.textMargin: [0, 8]`.

**Merge:** origin/main changed none of this ticket's files (`git diff --name-only df59fee0f 8fb843d1b`).

**Unit coverage** (`eval4-mutations.txt`, throwaway worktree, since removed):
- Dropping `textMargin` gives 14 failures.
- Applying it to the heatmap y axis gives 7 failures.
- Baseline 127/127.

**(c) Gap e2e:**
- It is red on c90df4304, per the executor's transcript: hist20 8.75px at 1440, 9px at 375, and hist10 13.9px at 375. It is green now.
- The gap uses canvas `measureText` width centred on ECharts' label centre, so it is real text metrics.

**Gaps in the e2e:**
- It asserts no heatmap x count at 375, which is why the regression above passes.
- It asserts a fixed 14px minimum at every font size, including compact 10px, where skeptic-final-2 set 12px.

### Phase 3: UI Review — FAIL

Setup:
- Servers came up via `start-servers.sh`, and `assert-phase.sh servers` printed PASS. The listening PIDs' cwd was this worktree.
- Throwaway user `18252d33-d36b-43fa-81cc-652329f2eb27`, checked via `/api/auth/me`.
- Fixture, matching the e2e: 3-row heatmap, 6-row heatmap, 10-bin and 12-bin histograms, and a 20-bin histogram over 12.345–314.743 on a w:6 card.

e2e on this head:
- hel1487 ran ×5 (20 tests): all passed (`eval4-e2e-hel1487-repeat5.txt`).
- hel1311 + hel1305 + hel1306: 23 passed (`eval4-e2e-others.txt`).
- **(f)** hel1311 touch targets are exactly 44 at 375 and 32 at 1440 after HEL-1490's Select change. The HEL-1305 time axis and HEL-1306 reference marks are green.

Measured live: shown labels and the real-text minimum gap, at each `textMargin` set in the running chart.

| Chart | Viewport | m3 | m5/m6 | m7 | **m8 (shipped)** | m10 |
|---|---|---|---|---|---|---|
| heat x (3 rows) | 375 | 7/7, 14.57 | 7/7 | 7/7 | **4/7** | n/a |
| heat6 x | 375 | 7/7, 12.0 | 7/7 | 4/7 | **4/7** | n/a |
| hist10 x | 1440 | 10/10, 14.85 | 10/10 | 10/10 | **9/10** | 9/10 |
| hist20 x (w:6) | 1440 | 5/20, 6.75 | 5/20, 13.95 | 5/20, 13.95 | **5/20, 21.15** | 5/20, 21.15 |
| hist20 x | 375 | 4/20, 8.84 | 4/20, 11.97 (m5) / 3/20, 17.31 (m6) | 3/20, 16.92 | **3/20, 16.58** | n/a |

**(d) Overlaps and legibility:**
- No overlaps or run-together labels at 1440 or 375, in either theme.
- Heatmap x is 7/7 at 1440, but **4/7 at 375**, which is the regression.

Cleanup:
- Dashboard, pipeline and source were deleted by exact id (204 each); re-listing returned 0/0/0.
- The user was deleted by exact id and email via `buildUserDeleteSql`; a follow-up count returned 0.
- Servers were stopped by exact PID: 1362718/1362703 and 1362432/1362167.
- MCP files were moved to `eval4-mcp/`.

Console: only 401s before login, `run-events` 502s while idle (pre-existing SSE proxy behaviour), and connection-refused after I stopped the servers.

### Overall: FAIL

### Change Requests
1. **Make the x-axis margin font-relative and consistent with the legibility threshold.**
   - Where: `heatmapHistogramOptions.ts:50-55`, the `CATEGORY_X_LABEL_TEXT_MARGIN` / `categoryXLabelShowAll`, and `buildChartOption.ts`.
   - What: replace the fixed `[0, 8]` with a margin derived from the axis font size, so that ECharts' hide threshold (about 2 × margin) equals the intended minimum gap. For example `[0, fontSize * 0.6]`: 7.2 at 12px (about 14.4px gap) and 6 at compact 10px (about 12px gap).
   - The compact path must override it with the margin for `COMPACT_AXIS_LABEL_FONT_SIZE`, as it already does for `lineHeight` (today it carries the normal-mode `textMargin` through its `axisLabel` spread).
   - Measured evidence: margin 6 at 375 gives heat x 7/7 (14.57px), heat6 x 7/7 (12px) and hist20 3/20 (17.31px). Margin 7 at 1440 gives hist10 10/10 (14.85px).
   - Re-verify the 1440 hist20 gap at 7.2. At 7 it was 13.95, about 0.05px under 14.
   - Correct the comment at `heatmapHistogramOptions.ts:45-49` to state the actual mechanism.
2. **e2e (`e2e/hel1487-category-axis-labels.spec.ts`).**
   - Assert `read.heatX.shown` equals `DAYS` at **375** as well as 1440. It was 7/7 before this ticket and fits with 14.57px.
   - Restore `expect(read.hist10.shown).toHaveLength(10)` at 1440.
   - Make the gap threshold font-relative: ≥ 14 at 1440 (12px font) and ≥ 12 at 375 (10px compact), matching CR1.
   - Show that the new heatX-at-375 assertion is red on 8fb843d1b (4/7) and green after.
3. **Unit tests and snapshot:** update to the font-relative margin, in normal and compact modes. Keep the snapshot edit to the heatmap/histogram entries.
4. **tasks.md 4.2:** correct the record.
   - The hist10 9-vs-10 difference is a threshold edge (last gap 16.75px against about 16px), not a theme effect. Both themes behave identically in every transcript.
   - A margin of 8 also hid the heatmap days at 375.

### Critical Path
This is the final allowed round, and the verdict is FAIL.
- **Most important:** the heatmap column axis at 375 regresses to every-other day labels (Mon/Wed/Fri/Sun) under `textMargin [0, 8]`, although all 7 fit with 12–14.6px gaps. That reintroduces the defect the ticket fixes. Shipping c90df4304's behaviour plus a correctly sized margin (CR1) resolves it.
- Everything else is green: the gates, the build, 43 e2e tests, the other AC items, the snapshot scope, and the merge with HEL-1490/HEL-1437.
- **Recommendation for the human, three options:**
  - (i) One more narrowly scoped round: CR1 and CR2, verified with the measurements above.
  - (ii) Ship c90df4304's label behaviour, i.e. revert df59fee0f's `textMargin`. Accept the skeptic's run-together-histogram finding as a follow-up ticket, since the label gap was 6.75–9px on dense histograms.
  - (iii) Accept 8fb843d1b with the mobile heatmap thinning as a known regression. I do not recommend this.

### Non-blocking Suggestions
Carried over: wrap the comments at `chartOverlayOption.ts:72` and `unchangedPathCases.ts:2`; reword `PanelDetailModal.mobile.css:216`; propose a split of `hel1311-heatmap-histogram-charts.spec.ts` in the PR description.
