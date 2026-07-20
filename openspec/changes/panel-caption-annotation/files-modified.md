# Files modified — panel-caption-annotation (HEL-318)

## Backend — persistence & domain

- `backend/src/main/resources/db/migration/V59__panel_caption_annotation.sql` — new Flyway migration adding nullable `image_caption TEXT` and `chart_annotation TEXT` columns to `panels`.
- `backend/src/main/scala/com/helio/domain/panels/ImagePanel.scala` — `caption: Option[String]` on `ImagePanelConfig` (jsonFormat3); tolerant decode (absent/null/blank ⇒ None); two-level `Patch` (`Option[Option[String]]`) with blank⇒clear; `applyPatch` wiring.
- `backend/src/main/scala/com/helio/domain/panels/ChartPanel.scala` — `annotation: Option[String]` on `ChartPanelConfig` (jsonFormat5); tolerant decode; annotation added to the two-level `Patch` and `applyPatch`.
- `backend/src/main/scala/com/helio/infrastructure/PanelRowMapper.scala` — write `image_caption`/`chart_annotation` from the typed config; read them back in `imageConfig`/`chartConfig`; `normalizeText` read-path tolerance (blank⇒None).
- `backend/src/main/scala/com/helio/infrastructure/PanelRepository.scala` — added `imageCaption`/`chartAnnotation` to `PanelRow`, `PanelTable`, the HList projection, and the single-source-of-truth `configColumnsOf`/`configColumnValuesOf` tuples (the PATCH `replace` + `batchUpdate` write path).

## Contract

- `schemas/panel.schema.json` — `caption` on `ImageConfig`, `annotation` on `ChartConfig` (both `["string","null"]`, documented).

## Frontend

- `frontend/src/features/panels/types/panel.ts` — optional `caption` on `ImagePanelConfig`, `annotation` on `ChartPanelConfig`.
- `frontend/src/features/panels/ui/ImagePanel.tsx` + `.css` — column frame; caption strip beneath the image/placeholder, hidden when blank, CSS line-clamp (2 lines) + `title` for full text.
- `frontend/src/features/panels/ui/renderers/ImageRenderer.tsx` — thread `caption` from config.
- `frontend/src/features/panels/ui/renderers/ChartRenderer.tsx` — annotation footnote beneath the chart canvas, hidden when blank, matching clamp.
- `frontend/src/features/panels/ui/PanelContent.tsx` + `.css` — pass `annotation` to `ChartRenderer`; chart wrapper becomes a column (`chart-panel__canvas` fills, annotation footnote clamped).
- `frontend/src/features/panels/ui/editors/ImageEditor.tsx` — caption `TextField`, wired to dirty/save/reset; empty⇒null on save.
- `frontend/src/features/panels/ui/editors/ChartDisplayFields.tsx` — annotation `TextField` (presentational); new `annotation`/`onAnnotationChange` props.
- `frontend/src/features/panels/ui/editors/BindingEditor.tsx` — annotation state (chart-only), dirty/reset/save wiring; empty⇒null; passes props to `ChartDisplayFields`.
- `frontend/src/features/panels/state/panelPayloads.ts` — `caption` on `buildImagePatch`; `annotation` on `buildBindingPatch` (absent-vs-null).
- `frontend/src/features/panels/state/panelThunks.ts` — `caption` on `updatePanelImage`; `annotation` on `updatePanelBinding`.
- `frontend/src/features/panels/services/panelService.ts` — thread `caption`/`annotation` to the PATCH config builders.

## MCP (stretch)

- `helio-mcp/src/tools/write.ts` — documented `caption` (image) / `annotation` (chart) on the `create_panel` config passthrough.

## Tests

- `backend/.../domain/PanelSpec.scala` — caption/annotation decode/wire-omission/Patch/applyPatch (absent/null/blank/value); fixed pre-existing `ChartPanelConfig.Patch` positional constructions for the new 5th field.
- `backend/.../infrastructure/PanelRowMapperSpec.scala` — row round-trip (duplication/export parity) for caption/annotation, plus NULL/blank⇒None.
- `frontend/.../ui/ImagePanel.test.tsx` — caption shown/hidden/blank/placeholder/long-clamp.
- `frontend/.../ui/renderers/ChartRenderer.test.tsx` (new) — annotation shown/hidden/blank/null/long-clamp.
- `frontend/.../ui/editors/ChartDisplayFields.test.tsx` — annotation control renders/edits/clears; updated shared `renderFields` for new props.
- `frontend/.../state/panelPayloads.test.ts` — `buildImagePatch`/`buildBindingPatch` caption/annotation set + null-clear payloads.
- `frontend/.../ui/PanelDetailModal.test.tsx` + `PanelDetailModal.aggregation.test.tsx` — added trailing `annotation` arg to the positional `updatePanelBinding` call assertions.

## Notes for the evaluator

- No DataType-field binding — static literal text only (design Decision 2).
- Blank normalization happens at every boundary (decode, PATCH, row read, render) so a cleared caption/annotation is an omitted wire field, never a stored `""` or an empty strip.
- The chart annotation rides the existing single `updatePanelBinding` PATCH (chart-only state in `BindingEditor`), not `useChartDisplayState`'s per-chart-type map — annotation is a chart-config scalar, not a per-type option.
- `ChartRenderer` now wraps the ECharts in `.chart-panel__canvas` (flex column) so the footnote never collapses the canvas; verify chart sizing visually.
