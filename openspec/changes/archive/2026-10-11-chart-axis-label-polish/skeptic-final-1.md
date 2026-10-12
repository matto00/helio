## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `17bb3e99d28cda114471e5c8b29deb9a543756c2`. The worktree had no tracked changes; the only untracked file is `evaluation-2.md`.
Diff base, resolved live with `resolve-review-base.sh` (exit 0): `d6aef6c46cfd3fcd47ebddd5519497d0f58c562b`.
Commits in range: 5df333a1f (squash), e0737d63a (archive), 17bb3e99d (merge of origin/main).

Evidence directory (already the durable main-checkout location): `/home/matt/Development/helio/.concertino/runs/HEL-1487/evidence/skeptic1/`

### What I verified (with evidence)

**Gates.** I ran these myself, from `frontend/`, under `nice -n 19`:
- `npm run lint`: exit 0.
- `npm run typecheck`: exit 0.
- `npm run format:check`: "All matched files use Prettier code style!", exit 0.
- `npm test -- --testPathPatterns='features/panels/ui|OutputEditorSheet.heatmapHistogram|histogramBins'`: 138 suites and 1433 tests passed.

**Hygiene.**
- I grepped the `+` lines of the full diff for `eslint-disable` and `color-mix`. The only hits are prose in design.md, ticket.md and evaluation-1.md. No code adds either one.
- `git log $BASE..HEAD` contains no `claude.ai`, `Claude-Session` or "session" string.

**AC1, bin precision.** I transpiled the real `heatmapHistogramOptions.ts` and `histogramBins.ts` into the scratchpad with the TypeScript compiler. Only `withAlpha` was stubbed, and it is not on the label path. I ran 16 inputs through the shipped `histogramBinLabels`:
- Every multi-bin case used a single decimal count.
- No case had duplicate adjacent labels.
- The results match the spec scenarios:
  - 0–10/4 gives "0.0 to 2.5"…
  - 0–10/5 gives "0 to 2"…
  - -0.1–0.5/6 gives "-0.1 to 0.0" (no negative zero).
  - 1700000000–1700000002/8 uses 2 places.
  - 0–1e-12/4 uses 14 places and stays distinct.
  - -5–5/12 uses 2 places.
- The rule is implemented as the spec states it.

**AC2.** `OutputKindFields.tsx:155` now says "rows with the same column and row are summed into one cell". The test asserts the new copy.

**AC3.**
- `ChartPanel.tsx:7` now points to `echartsCore.ts`, which registers Bar/Heatmap/Line/Pie/Scatter (`echartsCore.ts:18,36`).
- The `chartOverlayOption.ts:72` comment matches the line/bar guard.
- One stale list remains, at `PanelDetailModal.mobile.css:216`. The evaluator already flagged it as non-blocking, and I agree.

**AC5.** The comment at `e2e/hel1311-heatmap-histogram-charts.spec.ts:305` names ECharts 6.1.0 and the internals it reads. `frontend/node_modules/echarts/package.json` reports `"version": "6.1.0"`.

**AC4 is honest and sufficient.**
- The settle wait is targeted. It reads the dialog's own `getAnimations()`, filtered to `ui-modal-in`, never with `subtree`. `Modal.css:19` confirms the animation sits on `.ui-modal[open]` itself.
- The red-proof transcripts show the stretched-animation run going red at 43.448 without the wait, and green at exactly 44 with it.
- Under real timing, the run without the wait measured 43.56–43.98, which passes 43.5. The tasks text discloses this instead of claiming a natural red.
- The wait is still genuinely needed. The original HEL-1311 reading of 43.34 is the mid-animation value (44 × 0.985). The real-timing margin over 43.5 is only 0.06px, so the unwaited check is load-sensitive. With the wait the reading is a deterministic 44.0.
- Proof (b), with real controls set to 40px, is red at both sites.

**Frozen HEL-1305 guard snapshot edit is legitimate.**
- I parsed `chartUnchangedPath.main.snapshot.json` (32 cases). `interval`/`hideOverlap` appear only on the `heatmap` x/y and `histogram` x entries, and on the "timestamp x:" variants of those two charts.
- The only data change is the histogram labels, `["1.0 to 3.7","3.7 to 6.3","6.3 to 9.0"]`, which is exactly what D2 produces.
- No line, bar, pie or scatter entry was touched, so the guard keeps protecting every chart this change must not alter.
- The provenance comment in `unchangedPathCases.ts:2` records the edit. It is over-long, which is a nit.

**Running app.**
- Servers came up via `start-servers.sh` on 6919/9826 and `assert-phase.sh servers` printed PASS.
- I tested as throwaway user `6bcda2ca-88be-4baf-8b75-eff944b7c390` (`hel1487-skeptic-1791766310852@example.test`), checked with `/api/auth/me` before every probe.
- My dashboard had five panels at realistic widths, not the e2e's full-width w:12:
  - heatmap, 12 months × 6 services, w:6
  - histogram, 12 bins, w:6
  - histogram, 20 bins, w:4
  - timestamp-x line chart, w:4
  - bar chart with a reference line and band, w:4
- At 1440, in both light and dark:
  - Light: `hel1487-skeptic-dash-light-1440.png`. Dark: `hel1487-skeptic-dash-dark-1440.png` and `hel1487-skeptic-refbar-dark-1440.png`.
  - Every x axis and the heatmap y axis had zero overlapping labels.
  - The heatmap x axis shows 6 of 12 months. The cells are 24.1px and "Jan" is 21.6px wide, so the gap of about 2.5px is under ECharts' `textMargin`. I accept that as "does not fit".
  - The HEL-1305 time-axis labels and the HEL-1306 "SLO 60" line and "Healthy" band render correctly. Theme parity is good.

### AC1 fails at 375: heatmap row labels overlap

- **Light** (`hel1487-skeptic-dash-light-375.png`) and **dark** (`hel1487-skeptic-dash-dark-375.png`, close-up `hel1487-skeptic-heat-dark-375-branch.png`) both show the same thing: all 6 heatmap row labels (inventory, notifications, billing, auth-service, search, checkout-api) are drawn stacked on top of each other and cannot be read.
- I reproduced it on a fresh reload in both themes. The probe reported `y: shown 6 of 6`, `interval: 0`, `hideOverlap: true`.

**Root cause (probe-confirmed).**
- ECharts sizes each label's collision box from zrender's line height. That value is the measured width of the character '国' in the label font.
- This machine has no CJK font (`fc-list :lang=zh` lists 0 fonts). So '国' measures 6px, which is 0.6em at the compact 10px font size.
- The real glyphs are 11px tall (canvas `measureText`: ascent 9, descent 2).
- So ECharts sees 6px boxes at a 7px row pitch and hides nothing.

**Why main did not show this.**
- On the same live chart I set main's option back (`interval: 'auto'`, no `hideOverlap`).
- ECharts' auto interval pads the same estimate by 1.3×. It showed 3 of 6 rows, legibly (`hel1487-skeptic-heat-dark-375-main-sim.png`).
- So this change regresses the heatmap row axis on any browser whose fallback font for '国' is half-width. That includes this machine, the owner's own desktop.

**Fix probe.** Adding `lineHeight: 12` to the y `axisLabel` at runtime made `hideOverlap` hide correctly, showing 3 of 6 rows legibly (`hel1487-skeptic-heat-dark-375-lineheight-probe.png`).

**Why the gates missed it.**
- The e2e heatmap has only 3 rows. At a 14px pitch they never need hiding.
- The e2e overlap detector (`axisLabels` in `e2e/hel1487-category-axis-labels.spec.ts:33-93`) measures the same zrender `getBoundingRect`. It inherits the 6px underestimate, so it cannot see a vertical overlap even when one is on screen.
- My own detector, built the same way, also reported "0 overlaps" for the stacked labels in the screenshot.

### Verdict: REFUTE

### Change Requests

1. **Heatmap row-axis labels overlap when they do not fit (AC1; spec requirement "Heatmap and histogram category axes show every label that fits": "no two rendered labels overlap").**
   - Where: `buildChartOption.ts:222-227`, where the heatmap `yAxis.axisLabel` gets `CATEGORY_LABEL_SHOW_ALL`.
   - What: give ECharts a label line height it can trust, so `hideOverlap` measures real glyph height and not the '国' fallback width. One way is an explicit `lineHeight` derived from the axis `fontSize` (normal and compact). It could be added to `CATEGORY_LABEL_SHOW_ALL` or set alongside it, so it applies to both heatmap axes and the histogram x axis.
   - Any other mechanism is acceptable if it is proven in the rendered chart.
   - Verify in the running app: at 375 in light and dark, a heatmap with at least 6 rows shows fewer than all rows, with no visible overlap. At 1440 at w:12, all labels that fit are still shown, and the line, bar, time-axis and reference-mark charts are unchanged.
2. **Make the e2e able to see this defect, and show it red on the current head.**
   - The fixture: `e2e/hel1487-category-axis-labels.spec.ts` needs a heatmap whose rows cannot all fit at 375 (6 or more rows; the compact chart is 100px tall).
   - What to assert:
     - `heatY.shown.length < rows` at 375.
     - Non-overlap, with box heights taken from real font metrics and not from zrender's `getBoundingRect().height`. Real metrics means canvas `measureText(...).fontBoundingBoxAscent + fontBoundingBoxDescent` for the label's font, or `fontSize × lineHeight`.
   - It must be red on 17bb3e99d and green after fix 1, with both transcripts recorded.
3. Update the unit test in `buildChartOption.heatmapHistogram.test.ts` (HEL-1487 describe) to cover whatever fix 1 adds, in normal and compact modes, and confirm the line/bar axis labels are still untouched. If the frozen snapshot in `chartUnchangedPath.main.snapshot.json` changes, limit the edit to the heatmap/histogram entries, as this round did.

### Non-blocking notes

- Wrap the over-long comment lines at `chartOverlayOption.ts:72` and `unchangedPathCases.ts:2`.
- `PanelDetailModal.mobile.css:216` still says "bar/line/pie/scatter share this markup".
- On the shared Playwright browser, another lane navigated the page to `localhost:6869` mid-session. I caught it with a `location.href` check and re-navigated, so every reading cited above was taken on 6919.
- Residue cleanup:
  - My dashboard `ac87b069-…`, pipeline `ea5ea2f2-…` and source `21bd8811-…` were deleted via the API (204 each).
  - User `6bcda2ca-…` was deleted by exact id and email through the harness's guarded `buildUserDeleteSql`; a follow-up count returned 0.
  - Servers stopped by exact PID (1112982/1112950 vite+npm, 1112306/1111845 java+sbt launcher) after verifying their cwd was this worktree. The ports are free.
- No evidence here depends on mtime ordering. All claims rest on content: probe outputs, screenshots and line numbers.
