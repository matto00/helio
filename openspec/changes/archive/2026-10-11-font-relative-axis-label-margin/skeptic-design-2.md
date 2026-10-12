## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed: the untracked change dir on branch `feature/show-every-axis-label/HEL-1512`, HEAD `2e02b79511fab222ac2bc73a142fc61e0979f192` (= main). Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=feature/show-every-axis-label/HEL-1512`.

### What I verified (with evidence)

**Round-1 change requests:**

- **CR1 (0.5 px tolerance): addressed.**
  - design.md Risks bullet 1 now caps the tolerance at a 0.05 px epsilon on both floors, with "No larger tolerance on either floor".
  - The epsilon is tied to the only measured box-vs-text delta (13.95 vs 14.0).
  - Instability routes to the C5 escalation (x5 run).
  - This is option (a) from round 1.
- **CR2 (spec scenario keyed to viewport, not font): addressed.**
  - In `specs/heatmap-histogram-charts/spec.md`, the "Labels never run together" scenario is now keyed by font: >=14 px at the 12 px font, >=12 px at the 10 px compact font. That matches the requirement text.
  - Design Decision 5 picks the floor from the label element's rendered font size, not the viewport.
  - This is feasible. The handoff probe already reads `el.style.fontSize` and `el.style.font`, so the e2e can see each label's font.
- **CR3 (heat8 x read): addressed.**
  - Decision 5 and task 3.3 add a `heat8X` read and include it in the gap loop.
  - They assert `heat8X.shown == DAYS` at both 375 and 1440, and name it as the threshold-edge chart that catches a compact path inheriting the 7.2 margin.

**Round-1 non-blocking notes, also taken up:**

- Unit-test red must be an assertion failure, not an import error (Decision 5, task 3.1).
- The margin comment is corrected to the 2 x margin mechanism (Decision 1).
- C4 is confirmed via task 3.0. `e2e/support/auth.ts:69-71` does call `GET /api/auth/me`, which I checked.

**Mechanism re-checked against the code (ECharts 6.1.0):**

- `frontend/node_modules/echarts/lib/label/labelLayoutHelper.js:107-112` expands each label's local rect by its `textMargin` on all four sides before the overlap test.
- So two horizontal neighbours collide when their gap is below 2 x margin.
- With a factor of 0.6, the hide threshold is 14.4 px at 12 px and 12.0 px at 10 px, as Decision 1 states.

**Compact path (Decision 2):**

- `buildChartOption.ts:335-385` is the only compact axis-label override. It spreads `built.xAxis.axisLabel` and `built.yAxis.axisLabel` and sets only `fontSize: 10`, so without a fix it would inherit the normal-mode `textMargin` and `lineHeight`.
- Decision 2 and task 1.3 recompute both values there.
- Line 329 is the legend `textStyle`, not an axis, so nothing else needs the recompute.

**The measured numbers hold at factor 0.6** (from round 1's read of evaluation-4):

| Chart | Measured | Threshold at 0.6 | Expected result |
|---|---|---|---|
| hist10 at 1440 | last gap 14.85 | 14.4 | 10/10 |
| heat x (3-row) at 375 | 14.57 | 12 | 7/7 |
| heat8 x at 375 | 12.0 real gap at margin 6, with factor 0.6 giving exactly 6 at 10 px | 12 | 7/7, at the edge |

- At the edge the 0.05 epsilon is sufficient, and the x5 run plus C5 covers flakiness.
- hist20 at 1440: expected to thin, with every shown gap at least about 14.35 px. Decision 6 records the measurement and escalates if a factor change is needed.

**Other checks:**

- AC coverage is complete:
  - 7/7 on both heatmaps at 375 (and at 1440).
  - 10/10 bins at 1440.
  - Font-based floors.
  - HEL-1305 and HEL-1306 regression checks (task 1.4, and C3's e2e runs).
  - Light and dark at 1440 and 375 (C3, task 3.5).
  - The hist20 decision (Decision 6, task 3.4).
- No scope drift. Snapshot churn is confined to heatmap/histogram entries (task 3.2).
- `openspec validate font-relative-axis-label-margin --strict` printed "Change 'font-relative-axis-label-margin' is valid". ADDED is correct, because the main spec has no existing axis-label requirement.
- No placeholders or TBDs. Proposal, design, tasks and spec do not contradict each other.

### Verdict: CONFIRM

### Non-blocking notes

- The handoff spec asserts `heat8Y.shown.length < 6` at 375, which is a live check that `hideOverlap` plus the explicit `lineHeight` actually hide rows. Decision 5 does not say whether this is kept.
  - Keep it, or a similar y-axis assertion. It is the only e2e signal for the lineHeight / no-CJK-font fix.
  - Re-check it at the new lineHeight. If the explicit lineHeight now lets all 6 rows fit without overlap, change the assertion to "no overlap", not "fewer than 6".
- `12 * 0.6` evaluates to `7.199999999999999` in JS. This is harmless, but unit tests should use `toBeCloseTo` rather than exact `7.2`.
- Task numbering puts 3.0 after 3.2. This is cosmetic.
- Keep the name "heat8" consistently in the evidence. evaluation-4 calls the same card "heat6", and design.md already notes the alias.
