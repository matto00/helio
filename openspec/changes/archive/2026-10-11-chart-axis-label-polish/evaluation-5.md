## Evaluation Report — Cycle 5 (evaluation-5.md)

Reviewed commit: `faa2c38a6a18df88d033f44f57ea256e51a8f1ff`. It is 609b0bba0 (the revert per the owner ruling) merged with origin/main 41db49cee (HEL-1504 #960).
- The base was resolved live with `resolve-review-base.sh`: `41db49cee08f358a491253a1021e594b74d9dd6a`.
- origin/main is an ancestor of HEAD.

Evidence is in `/home/matt/Development/helio/.concertino/runs/HEL-1487/evidence/` (`eval5-*`).

The ruling is relayed by the orchestrator: keep main's axis-label thinning, ship items 2–5 plus bin-label precision, and split "show every label" to HEL-1512. I evaluate against that ruling, but I have not seen the owner's ruling directly.

### Phase 1: Spec Review — PASS

**(1) Axis-label behaviour equals main.**
- `git diff 41db49cee -- buildChartOption.ts buildChartOption.heatmapHistogram.test.ts unchangedPathCases.ts` is empty.
- There are no leftover `CATEGORY_LABEL*`, `categoryLabel*`, `categoryXLabel*`, `showsEveryCategoryLabel`, `textMargin` or `lineHeight` references in `frontend/src` or `e2e/`. The only `lineHeight` hits are CSS `getComputedStyle` reads in `hel1398-chart-narrow-footnotes.spec.ts`, which already exist on main and are unrelated.
- The `heatmapHistogramOptions.ts` diff against main contains only `histogramBinLabels` and its private `binLabelDecimals`, replacing `histogramBinLabel`. There are no dead exports.
- The snapshot differs from main by exactly one hunk: the histogram case's `xAxis.data`, `"1 to 3.67"…` → `"1.0 to 3.7"…`.
- In the running app, every heatmap and histogram axis carries main's `axisLabel` (`interval: "auto"`, default `textMargin [0, 3]`, no `hideOverlap` or `lineHeight`). The labels shown match main's thinning:

  | Viewport | heat x | heat y (3) | heat6 y | hist10 | hist12 | hist20 (w:6) |
  |---|---|---|---|---|---|---|
  | 1440 | 7/7 | 3/3 | 6/6 | 5 (10, 30, …, 90) | 6 | 4 |
  | 375 | 7/7 | 3/3 | 3 (1, 3, 5) | 3 | 2 | 3 |

  - Light and dark are identical at both widths.
  - Real-metric ink overlaps are 0 on every axis.
  - The 1440 hist10/hist12 subsets equal cycle-1's recorded pre-fix (main) subsets (`hel1487-e2e-axislabels-RED-before-fix.txt`).
  - The heatmap at 375 shows all 7 days again, so the cycle-4 regression is gone.
  - With main's `interval: auto` thinning, the 6-row heatmap at 375 shows 3 rows without overlap; the cycle-3 '国' issue only affected `hideOverlap`.

**(2) The kept items are intact.**
- `histogramBinLabels` and `heatmapHistogramLabels.test.ts` are present, including the full-span `toEqual(["1", "1 to 3", "3 to 5"])` assertion (:72).
- The hint copy is in `OutputKindFields.tsx` and its test.
- Both comments are fixed (`ChartPanel.tsx:7`, `chartOverlayOption.ts:72`).
- The hel1311 spec has `settleSheetOpenAnimation` before both reads, `>= 43.5` at both sites (:515, :525), the "Histogram bins" name, and the ECharts 6.1.0 legend-probe comment.

**(3) No relaxed assertion remains.**
- `e2e/hel1487-category-axis-labels.spec.ts` is deleted; `git ls-files e2e | grep 1487` returns 0.
- `evidence/hel1512-handoff/hel1487-category-axis-labels.spec.ts` is byte-identical to the 8fb843d1b version.

**(4) Archived artifacts and the canonical spec are consistent with the ruling, with two docs-only remnants noted below.**
- Ticket AC1 is replaced (precision only, thinning unchanged, HEL-1512). The ticket's Description keeps the original item 1 text verbatim, which is fine because it is the ticket as filed.
- Design D1 is replaced ("Axis-label thinning: unchanged (owner ruling)").
- The proposal has an owner-ruling section and no-change Non-Goals.
- Tasks 1.2, 2.4, 3.2, 4.1 and 4.2 are marked reverted or dropped. 4.2 correctly calls the hist10 edge a threshold effect, not a theme effect. 5.1 is accurate: I verified each claim above.
- The delta spec now has only MODIFIED "Histogram bins a numeric field" and "Output editor configures heatmap and histogram". The "show every label" requirement is gone from both the delta and the canonical spec.
- Both delta requirements are byte-identical to the canonical ones.
- The canonical spec's Purpose is real, not TBD.
- The archive layout is valid: `.openspec.yaml` (`schema: spec-driven`, `created: 2026-10-11`) and `specs/heatmap-histogram-charts/spec.md`.
- `check:openspec` exits 0.

**Branch diff against the live base:** exactly the intended change. There are 8 code/e2e files (hel1311 spec, ChartPanel, chartOverlayOption, snapshot hunk, labels test, options, editor test, OutputKindFields) plus the archive and the canonical spec. The branch is not re-squashed after 5df333a1f; the PR is squash-merged, as the orchestrator noted.

### Phase 2: Code Review — PASS

**(5) Gates, my own fresh run on faa2c38a6 (`eval5-gates.txt`):**
- lint, typecheck, format:check, check:openspec and `npm --prefix frontend run build` all exit 0.
- `npm test`: 48 + 562 suites, 454 + 6162 tests, all passed.
- check:e2e-types, check:e2e-evidence-paths and check:e2e-user-cleanup all exit 0.

The code under review is the cycle-2 content with the show-all changes removed. Mutation coverage for `histogramBinLabels` was established in cycles 1 and 2: the `bins[0]` width mutation and the negative-zero mutation both go red.

### Phase 3: UI Review — PASS

- Servers came up via `start-servers.sh`, and `assert-phase.sh servers` printed PASS. The listening PIDs' cwd was this worktree.
- Throwaway user `04fe1273-903f-427a-a507-f017241e6929`, checked via `/api/auth/me` before each reading.
- A peer session moved the shared browser to `localhost:6922` once. I navigated back, and every reading above records `href` on 6919.
- e2e on this head (`eval5-e2e.txt`): hel1311 + hel1305 + hel1306, **23 passed**. Touch targets are exactly 44 at 375 and 32 at 1440 after HEL-1490's Select change. The HEL-1305 time axis and HEL-1306 reference marks are green.
- Screenshots: `eval5-screens/dark-375.png`, `eval5-screens/light-1440.png`.

**Console:** only one `run-events` empty response, from the dev-proxy SSE (pre-existing).

**Cleanup:**
- Dashboard, pipeline and source deleted by exact id (204 each); re-listing returned 0/0/0.
- User deleted by exact id and email via `buildUserDeleteSql`; a follow-up count returned 0.
- Servers stopped by exact PID: 1504540/1504525 and 1504147/1503830.
- MCP files moved to `eval5-mcp/`.

### Overall: PASS

### Non-blocking Suggestions
Docs-only fixes, worth doing before merge. They need no gate re-run beyond `check:openspec`.
- **`design.md` still carries two remnants of the old D1** that contradict the replaced decision:
  - Risks, first bullet: "[hideOverlap drops labels irregularly on narrow screens] -> acceptable …".
  - Risks, second bullet: "(interval only)".
  - Planner Notes: "Self-approved: … `interval: 0` + `hideOverlap` over rotation (D1)".
  - Delete them, or reword them to "D1: thinning unchanged (owner ruling, HEL-1512)".
- **`proposal.md:20-21` is a garbled sentence** left by the removal: "…consistent-precision rule; heatmap/histogram category axes the heatmap editor hint must describe summing." It should read "…consistent-precision rule; the heatmap editor hint must describe summing."
- **`unchangedPathCases.ts:2-3`** still says the snapshot "holds the options main (3eb0cc893) built … regenerate it only from the pre-change tree", but its histogram entry now carries HEL-1487's bin labels. The cycle-2 note on that line was removed with the revert. Restore a one-line note.
- Carried over: wrap the comment at `chartOverlayOption.ts:72`; reword `PanelDetailModal.mobile.css:216`; propose a split of `hel1311-heatmap-histogram-charts.spec.ts` (538 lines) in the PR description.
