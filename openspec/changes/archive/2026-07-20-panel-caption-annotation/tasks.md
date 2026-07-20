## 1. Backend — persistence & domain

- [x] 1.1 Add Flyway migration `V59__panel_caption_annotation.sql` adding nullable `image_caption TEXT` and `chart_annotation TEXT` columns to the panels table
- [x] 1.2 Extend `PanelRepository.PanelRow`/`PanelTable` and its SQL projections with the two new columns, AND add them to `configColumnsOf`/`configColumnValuesOf` (the HEL-296 single-source-of-truth the PATCH `replace` write path uses) so PATCH actually persists them
- [x] 1.3 Add `caption: Option[String]` to `ImagePanelConfig` and `annotation: Option[String]` to `ChartPanelConfig`, with tolerant `decode`/`decodeCreate` (absent/null/blank ⇒ None) so an unset field is omitted (not `null`) on the wire
- [x] 1.4 Add `caption`/`annotation` to each config's two-level `Patch` (`Option[Option[String]]`: absent=unchanged, `Some(None)`=clear on null/blank, `Some(Some(v))`=set), following `ChartPanelConfig.Patch.aggregation` — NOT the single-level `imageUrl` Patch
- [x] 1.5 Wire `PanelRowMapper.toRow` to write `image_caption`/`chart_annotation`, and `imageConfig`/`chartConfig` builders to read them back
- [x] 1.6 Ensure the panel response `config` includes `caption` (image) / `annotation` (chart) when set and omits it when unset, via `PanelConfigCodec`/`JsonProtocols` (other subtypes' configs carry no such field)

## 2. Contract — schema

- [x] 2.1 Add `caption` (string) to `ImageConfig` and `annotation` (string) to `ChartConfig` in `schemas/panel.schema.json`

## 3. Frontend — types, rendering, editors

- [x] 3.1 Add optional `caption` to `ImagePanelConfig` and `annotation` to `ChartPanelConfig` in `types/panel.ts`
- [x] 3.2 Thread `caption` through `ImageRenderer` → `ImagePanel`; render a caption strip beneath the image, hidden when blank, with CSS line-clamp in `ImagePanel.css`
- [x] 3.3 Thread `annotation` through `PanelContent` → `ChartRenderer`; render a subtitle/footnote beneath the chart title, hidden when blank, with matching clamp styling
- [x] 3.4 Add a caption `TextField` control to `ImageEditor`, wired into its dirty/save state and PATCH payload
- [x] 3.5 Add an annotation `TextField` control to the chart display editor (`ChartDisplayFields`), wired into its dirty/save state and PATCH payload
- [x] 3.6 Include `caption`/`annotation` in `panelPayloads` PATCH construction (send null to clear)

## 4. MCP (stretch)

- [x] 4.1 Accept `caption` (image) / `annotation` (chart) on the helio-mcp panel create/update tool config and document them in the tool descriptions

## 5. Tests

- [x] 5.1 Backend: ScalaTest for caption/annotation PATCH round-trip (absent unchanged, null clears, value set) and response null for other types
- [x] 5.2 Backend: duplication/export-import parity test carrying caption/annotation
- [x] 5.3 Frontend: `ImagePanel`/`ImageRenderer` tests — caption strip shown when set, hidden when blank, clamps long text
- [x] 5.4 Frontend: `ChartRenderer` test — annotation shown when set, hidden when blank
- [x] 5.5 Frontend: editor tests — editing/clearing caption and annotation issues the correct PATCH payload
- [x] 5.6 Run `npm test`, `npm run lint`, `npm run build`, and `sbt test`; validate `openspec validate --change panel-caption-annotation`
