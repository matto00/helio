# Evidence — HEL-1401 (fix-utils-readme-importers)

Captured verbatim from the worktree at 2951d0b83 (pre-change HEAD).

## Importer grep

Command (Decision 1 verification, run from the worktree root):

```bash
for m in formatRelativeTime aggregate chartAppearance chartTypeOptions prefersReducedMotion; do echo "== $m"; git grep -lE "from \"[./]*(utils/)?$m\"" -- frontend/src ':!*.test.ts' ':!*.test.tsx'; done
```

Output:

```
== formatRelativeTime
frontend/src/features/connectors/ui/ConnectorsPage.tsx
frontend/src/features/panels/provenance/ProvenanceContent.tsx
frontend/src/features/pipelines/ui/PipelineDetailFooter.tsx
frontend/src/features/pipelines/ui/PipelineListTable.tsx
frontend/src/features/sources/ui/SourceListTable.tsx
== aggregate
frontend/src/features/panels/ui/ChartOutputPanel.tsx
frontend/src/features/panels/ui/ChartPanel.tsx
frontend/src/features/panels/ui/MetricOutputPanel.tsx
frontend/src/features/panels/ui/buildChartOption.ts
frontend/src/features/panels/ui/chartDataOptions.ts
frontend/src/features/panels/ui/renderers/ChartRenderer.tsx
frontend/src/features/panels/ui/useChartOption.ts
frontend/src/features/pipelines/ui/outputEditor/OutputPreviewPane.tsx
== chartAppearance
frontend/src/features/adminUsage/ui/UsageChart.tsx
frontend/src/features/panels/ui/buildChartOption.ts
frontend/src/features/panels/ui/chartDataOptions.ts
frontend/src/features/panels/ui/chartOverlayOption.ts
frontend/src/features/panels/ui/editors/ChartDisplayFields.tsx
frontend/src/features/panels/ui/resolvePanelChartType.ts
frontend/src/features/panels/ui/useChartClickHandler.ts
frontend/src/features/panels/ui/useChartOption.ts
frontend/src/features/pipelines/ui/outputEditor/OutputKindFields.tsx
frontend/src/features/pipelines/ui/outputEditor/OutputPreviewPane.tsx
frontend/src/features/pipelines/ui/outputEditor/buildOutputConfig.ts
frontend/src/features/pipelines/ui/outputEditor/outputConfigTypes.ts
frontend/src/features/pipelines/ui/outputEditor/useOutputKindState.ts
frontend/src/utils/chartClickSelection.ts
frontend/src/utils/chartTypeOptions.ts
== chartTypeOptions
frontend/src/features/panels/ui/buildChartOption.ts
frontend/src/features/panels/ui/chartDataOptions.ts
== prefersReducedMotion
frontend/src/features/panels/ui/buildChartOption.ts
frontend/src/shared/ui/Toast.tsx
frontend/src/utils/chartAppearance.ts
exit=0
```

## Guard and call-site grep

Command 1:

```bash
grep -n 'endsWith(".css")' frontend/src/theme/motionTokenGuard.css.test.ts
```

Output:

```
32:    } else if (entry.isFile() && entry.name.endsWith(".css")) {
exit=0
```

Command 2:

```bash
grep -n "prefersReducedMotion()" frontend/src/features/panels/ui/buildChartOption.ts
```

Output:

```
233:  built = applyHoverEmphasis(built, themeTokens, prefersReducedMotion());
exit=0
```

## Cycle 2

Wording fixes from skeptic-final-1.md non-blocking notes: prefersReducedMotion.ts "gated here in JS" -> "gated in JS"; README.md re-check command now says "(from the repo root)". Captured below verbatim (git -C <worktree> diff HEAD -- frontend/):

```diff
diff --git a/frontend/src/utils/README.md b/frontend/src/utils/README.md
index 346ba9816..b93c1e9be 100644
--- a/frontend/src/utils/README.md
+++ b/frontend/src/utils/README.md
@@ -10,7 +10,7 @@ is imported by `features/adminUsage` (`ui/UsageChart.tsx`), by
 (`ui/outputEditor/OutputPreviewPane.tsx`). `chartTypeOptions.ts` is, as of
 this writing, imported only by `features/panels` — it lives here from an
 earlier intent to share it, not current usage, and is a candidate for a move
-to `features/panels/utils`. These are non-test importers; re-check one with
+to `features/panels/utils`. These are non-test importers; re-check one (from the repo root) with
 `git grep -lE 'from "[./]*(utils/)?<module>"' -- frontend/src ':!*.test.ts' ':!*.test.tsx'`.
 
 `prefersReducedMotion.ts` is the single shared reduced-motion read (HEL-1179), imported by
diff --git a/frontend/src/utils/prefersReducedMotion.ts b/frontend/src/utils/prefersReducedMotion.ts
index 55e2ac7c6..0e1057783 100644
--- a/frontend/src/utils/prefersReducedMotion.ts
+++ b/frontend/src/utils/prefersReducedMotion.ts
@@ -3,7 +3,7 @@
  *  honour `prefers-reduced-motion`, e.g. ECharts option config or a JS-timed
  *  exit animation; CSS should keep using its own `@media` block.
  *
- *  ECharts hover-emphasis motion must be gated here in JS because it is
+ *  ECharts hover-emphasis motion must be gated in JS because it is
  *  option config, not CSS: `theme/motionTokenGuard.css.test.ts` only scans
  *  `.css` files, so neither that guard nor a CSS `@media` block reaches it.
  *
```
