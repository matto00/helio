## Evaluation Report — Cycle 2 (evaluation-2.md)

- Reviewed commit: 2829f6ecd6e7e171e4a336d02946def2440bf212 (cycle-2 delta 56fc3a02c..2829f6ecd).
- Base: b3a7efc9639386784c888347770800189662a380, resolved live.
- Evaluator evidence: /home/matt/Development/helio/.concertino/runs/HEL-1306/evidence/eval-2/

### Phase 1: Spec Review — PASS

- **Cycle-1 CR1 (band label under the bars): resolved.**
  - The fill markArea no longer carries a label.
  - Labels now ride a second nameless, silent, tooltip-off line carrier (`__helio_reference_band_labels__`). Its markArea is transparent at z 5, and the label has a `surfaceStrong` halo.
  - In compact mode `buildChartOption` passes `!effectiveCompact`, so band labels are hidden there while line labels stay.
  - design.md D5 now states this, replacing the old "Compact mode keeps lines and labels". The spec requirement ("label inside its top edge") is met on desktop.
  - Hiding band labels in compact mode is a documented narrowing. It was the option offered in cycle-1 CR1.
- **Cycle-1 CR2 (dangling citation): resolved.** `frontend/src/utils/referenceMarks.ts:4` now cites `referenceMarks.guard.test.ts`.
- **Label length counted in code points (from my cycle-1 non-blocking note):** done.
  - Server: `ChartReferenceMarks.codePoints`.
  - Frontend: `[...label].length`.
  - Fixture cases were added, with backend red evidence in `cycle2-backend-codepoint-red.txt`.
- **Constraints C1-C4: honoured.**
  - C1: `surfaceStrong` is plain hex in both themes (theme.css:153 `#262320`, :237 `#ffffff`). It is already passed to ECharts as the tooltip background.
  - C2: the label-z guard was mutation-proven red (`cycle2-mutation-label-z.txt`: received 1, expected > 2).
  - C3: every executor cycle-2 e2e fixture was deleted (`e2e-fixture-ids-c2.txt`). Checked read-only in the dev DB, by exact id: data-source 0/8, pipeline 0/8, output 0/16, dashboard 0/4 and panel 0/12 remain. Cycle-1 ids are also still at 0.
  - C4: proven in the running app (below).

### Phase 2: Code Review — PASS

Gates, all re-run by me at 2829f6ecd in WORKTREE_PATH (logs in eval-2/):
- lint: exit 0. format:check: exit 0. typecheck: exit 0.
- jest: 524 suites / 5661 tests passed.
- `npm --prefix frontend run build`: exit 0.
- `sbt testFull` (nice 19, -J-Xmx3g, no other testFull running): 6762 succeeded, 0 failed. `OutputReferenceMarksSeamSpec` and `ChartReferenceMarksSpec` both ran.

The delta is small and focused:
- The new display-list z test measures on a real ECharts instance.
- Compact-mode and no-label cases are covered.
- The e2e asserts label z > 2 at 1440 and that the label is absent at 375.
- No dead code and no new escape hatches.

### Phase 3: UI Review — PASS

I started the servers with the canonical start-servers.sh (ports 6738/9645). Fixture: my own throwaway user, plus:
- two sources and two pipelines;
- five chart Outputs: bar with line and a labelled band; plain bar control; line with "vs previous" compare, a neutral line and a labelled band; horizontal bar with a line and a labelled band; two-series line with a line and a labelled band;
- a dashboard with five panels.

Checked light and dark at 1440 and 375.

**Band label:**
- At 1440 "Healthy" is drawn on top of the Wed bar with a halo and is legible in both themes. Live display list: label z 5, halo `#ffffff` in light and `#262320` in dark, lineWidth 3. Bars are z 2.
- "Zone", "Band" and "Low" are also legible on the horizontal bar, the overlay line and the multi-series line.
- At 375 no band label element exists in any chart. Line labels "SLO 95", "30" and "Target" remain. The label carrier is absent from the option in compact mode.
- Screenshots: eval-2/dash-light-1440.png, dash-dark-1440.png, dash-light-375.png, dash-dark-375.png, marked-light-1440.png (persisted ref: /home/matt/Development/helio/.concertino/runs/HEL-1306/evidence/.concertino/runs/HEL-1306/evidence/eval-2/marked-light-1440.png).

**No regression from the second carrier:**
- Bar width: 1440 marked 54.3375 = plain 54.3375. At 375, 33.12 vs 33.95 (0.976), caused by axis-label width as in cycle 1.
- Legend data excludes both carriers: ["value"], ["value","vs previous"], ["east","west"].
- Tooltip trigger matches the no-mark case: "item" on the single-series bar, same as the plain bar; "axis" on the overlay and multi-series charts.
- The overlay series "vs previous" (dashed) is still drawn beside the neutral solid line.
- Hover, measured on the multi-series line by a synthetic mousemove on the zrender viewport: the other series fades to 0.1. The reference line stays at 1, the band at 0.12, and the "Low" and "Goal" labels at 1. Same result on the bar.
- Legend: with both series toggled off, the line and both labels stay drawn.

**Console:**
- No errors from my flows on port 6738; the only warnings were ECharts 0-size messages during viewport resizes.
- The shared browser's log also held 401/403 entries from port 6739, which belongs to another lane sharing the Playwright browser, not this app.

**Cleanup:**
- All my fixtures were deleted by exact id and confirmed at 0 rows (eval-2/eval-fixture-ids.txt). The throwaway user 5b2002ee-0848-4e69-ade0-4de6ce070bc6 remains because there is no user-delete API.
- Servers stopped by exact PID.
- My .playwright-mcp files were moved to eval-2/playwright-mcp/.

### Overall: PASS

### Non-blocking Suggestions
- In dark theme the neutral reference line and the "vs" overlay are both `#aaa49c`; only the dash pattern tells them apart. This matches design (D5) but is worth a look by the skeptic for visual cohesion.
- The two empty carrier series each take a palette colour slot. This is harmless now because they are appended last and have no points. A future feature that reads the palette by series index should skip ids prefixed `__helio_`.
- Still open from cycle 1 and out of scope: the hover emphasis feeds `color-mix()` `accentStrong` to ECharts (chartAppearance.ts:267-268, already on main). Candidate spin-off ticket.
