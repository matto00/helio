## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)
- buildChartOption.ts:80-83 null branch exists exactly as described; hover emphasis/axis-trigger run after it unconditionally (ticket's "no hover emphasis" claim is stale, as the design says).
- frontend defaultChartAppearance (theme/appearance.ts:19-37) vs backend ChartAppearance.Default (model.scala:225-237): seriesColors, legend top/show, tooltip enabled, axisLabels show/"" , chartType line all match field by field (D3 parity holds at read time).
- Create-path enumeration: backend Default (model.scala ~397) has no chart; only chart construction is PATCH merge (467). Frontend chart consumers (useChartClickHandler, PanelCard:460 via resolveChartType, PanelDetailModal) already tolerate absent chart and resolve to "line", consistent with the fallback's chartType "line", so no divergence in chart-type resolution.
- Every AC maps: AC1 -> D1 + equality test 2.2 (light/dark); AC2 -> 2.1 red-first; AC3 -> 2.3 guard. Spec delta present and consistent with the proposal and design. No placeholders, no migration, no PanelGrid/PanelCard edits, so no collision with the parallel lanes.

### Verdict: CONFIRM

### Non-blocking notes
- Design Risk says the default palette "equals ECharts' own default"; ECharts has a 9th colour (#ea7ccc) the 8-colour default lacks, so 9+ series would now wrap. Immaterial, and identical to an edited-with-defaults panel; soften the wording.
- Task 2.1 should pass a real themed tooltip assertion on a single-series chart (where today there is no tooltip key at all), not only the multi-series case.
- Existing tests that render ChartPanel with no appearance now go through the themed path; if any break, treat it as a symptom per the plan.
