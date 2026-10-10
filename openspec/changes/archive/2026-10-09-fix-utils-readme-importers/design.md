## Context

See proposal.md (Why). Facts below were verified on origin/main @ 2951d0b83 with the commands in Decision 1/2; the
executor MUST re-run them in the worktree and paste the output (see tasks.md). Non-test importers per module:

- `formatRelativeTime.ts`: features/connectors (ConnectorsPage.tsx), features/panels (provenance/ProvenanceContent.tsx),
  features/pipelines (PipelineDetailFooter.tsx, PipelineListTable.tsx), features/sources (SourceListTable.tsx).
- `chartAppearance.ts`: features/adminUsage (ui/UsageChart.tsx); features/panels (7 files: ui/buildChartOption.ts,
  ui/chartDataOptions.ts, ui/chartOverlayOption.ts, ui/editors/ChartDisplayFields.tsx, ui/resolvePanelChartType.ts,
  ui/useChartClickHandler.ts, ui/useChartOption.ts); features/pipelines (5 files under ui/outputEditor/:
  OutputKindFields.tsx, OutputPreviewPane.tsx, buildOutputConfig.ts, outputConfigTypes.ts, useOutputKindState.ts);
  utils/chartClickSelection.ts; utils/chartTypeOptions.ts. (15 lines of output total.)
- `aggregate.ts`: features/panels (7 files: ui/ChartOutputPanel.tsx, ui/ChartPanel.tsx, ui/MetricOutputPanel.tsx,
  ui/buildChartOption.ts, ui/chartDataOptions.ts, ui/renderers/ChartRenderer.tsx, ui/useChartOption.ts);
  features/pipelines (ui/outputEditor/OutputPreviewPane.tsx). (8 lines of output total.)
- `chartTypeOptions.ts`: features/panels only (ui/buildChartOption.ts, ui/chartDataOptions.ts).
- `prefersReducedMotion.ts`: features/panels/ui/buildChartOption.ts (line 233, `applyHoverEmphasis(..., prefersReducedMotion())`),
  shared/ui/Toast.tsx, utils/chartAppearance.ts (default param of `applyHoverEmphasis`). README paragraph 2 already says
  exactly this and is NOT changed.
- CSS motion-token guard: `frontend/src/theme/motionTokenGuard.css.test.ts` line 32,
  `} else if (entry.isFile() && entry.name.endsWith(".css")) {` — it walks only `.css` files.
- The removed text (681a16478, chartAppearance.ts): "ECharts hover-emphasis motion (Decision 4) is JS option config,
  not CSS, so the existing `motionTokenGuard.css.test.ts` (which only scans `.css` files) never covers it".

## Goals / Non-Goals

**Goals:** README paragraph 1 states only grep-verified importer facts; one sentence restores the JS-gating rationale.
**Non-Goals:** see proposal.md Non-goals. No code behaviour change.

## Decisions

### Decision 1 — README paragraph 1 is replaced verbatim

Replace lines 3-9 of `frontend/src/utils/README.md` (from "`formatRelativeTime.ts` is genuinely cross-feature" through the line
"docs-only.", which is line 9) with EXACTLY this text (line breaks as shown):

```
`formatRelativeTime.ts` is genuinely cross-feature (imported by
`features/connectors`, `features/panels`, `features/pipelines` and
`features/sources`). So is `chartAppearance.ts`: besides `features/panels` it
is imported by `features/adminUsage` (`ui/UsageChart.tsx`), by
`features/pipelines` (`ui/outputEditor/`), and by `chartClickSelection.ts` and
`chartTypeOptions.ts` in this directory. `aggregate.ts` is imported by
`features/panels` and `features/pipelines`
(`ui/outputEditor/OutputPreviewPane.tsx`). `chartTypeOptions.ts` is, as of
this writing, imported only by `features/panels` — it lives here from an
earlier intent to share it, not current usage, and is a candidate for a move
to `features/panels/utils`. These are non-test importers; re-check one (from the repo root) with
`git grep -lE 'from "[./]*(utils/)?<module>"' -- frontend/src ':!*.test.ts' ':!*.test.tsx'`.
```

Verification command (run from the worktree root):
`for m in formatRelativeTime aggregate chartAppearance chartTypeOptions prefersReducedMotion; do echo "== $m"; git grep -lE "from \"[./]*(utils/)?$m\"" -- frontend/src ':!*.test.ts' ':!*.test.tsx'; done`
Alternative considered: keep the "exclusively panels" framing and just add adminUsage — rejected, `aggregate.ts` and
`formatRelativeTime.ts` claims in the same paragraph are also stale.

### Decision 2 — the JS-gating sentence goes on `prefersReducedMotion.ts`

Insert into the existing doc comment of `frontend/src/utils/prefersReducedMotion.ts`, between the paragraph ending
"CSS should keep using its own `@media` block." and the blank ` *` line before "Guards `matchMedia`", EXACTLY:

```
 *
 *  ECharts hover-emphasis motion must be gated in JS because it is
 *  option config, not CSS: `theme/motionTokenGuard.css.test.ts` only scans
 *  `.css` files, so neither that guard nor a CSS `@media` block reaches it.
```

Chosen over the call site in `buildChartOption.ts` because the helper is the single shared read (HEL-1179) and a
future second ECharts caller would read the helper, not one call site. Verification:
`grep -n 'endsWith(".css")' frontend/src/theme/motionTokenGuard.css.test.ts` and
`grep -n "prefersReducedMotion()" frontend/src/features/panels/ui/buildChartOption.ts`.

## Risks / Trade-offs

- [Importer lists rot again] → README names the exact re-check command and says "as of this writing".
- [Doc-only diff still runs the full pre-commit] → expected; no `--no-verify`.

## Planner Notes

- Self-approved: widening item 1 to the whole paragraph (aggregate/formatRelativeTime claims found stale in premise
  validation) — same paragraph, same ticket intent ("correct it from a grep of importers").
