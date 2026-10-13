## Why

Since HEL-1408 a blank CSV cell is null, so an aggregated chart groups blanks under the literal label "null", and
selection headers render an empty value ("team: "). The owner ruled (HEL-1408 Q7, confirmed 2026-10-12) that this
should read "(blank)". Separately, stored CSV and Output schemas keep only `{name, type}`, so every column reports
`nullable: false`, including all-blank ones.

## What Changes

- Blank/null category groups display "(blank)" on four surfaces: aggregated chart categories (axis, pie, legend,
  tooltip, including the Output editor preview), Output history grouped series (stored "null" categories),
  the cross-filter indicator, and the Inspect header and its "Filter dashboard" button.
- Selection values stay `""`: click-to-select and "Filter dashboard" keep matching null rows exactly as today.
- DESIGN.md gains the "(blank)" copy rule.
- Stored schema fields gain an optional `nullable`, written for CSV sources (upload, URL, refresh) and Outputs (every
  run and backfill). A stored field without the key reads as `nullable: true` for CSV sources and Outputs. Other
  source kinds report exactly what they report today. No data migration.
- Two HEL-1408 test nits: `eq ""` snapshot test covers the timestamp cast; the lookup test asserts its null-row count.

## Capabilities

### New Capabilities
- `blank-category-label`: how a null/blank category or selection value is labelled in the UI.
- `stored-schema-nullability`: what nullability CSV-source and Output schemas report, and how it is persisted.

### Modified Capabilities
- (none)

## Non-goals

- Non-aggregated charts' blank x label and Inspect grid cells (unchanged, owner ruling).
- Re-ordering the blank category (it keeps its current sort position).
- Node capabilities (analyze-derived, never persisted) and REST/SQL/dataset/content source nullability.
- Any change to the server history reducer, the timestamp parser or the cast step (HEL-1502).

## Impact

- Frontend: chart aggregate rendering, click mapping, history chart/overlay, CrossFilterIndicator, PanelInspectView,
  OutputPreviewPane; new shared label helper.
- Backend: `SchemaField` + its JSON format, CSV inference, shallow Output inference, CSV/Output schema write paths,
  `InferredFieldResponse`, panel capabilities, workspace context. Wire key `nullable` already exists in `/schemas`.
