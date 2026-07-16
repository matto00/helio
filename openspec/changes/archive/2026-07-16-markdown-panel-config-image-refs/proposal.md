## Why

Markdown panels only render static authored `content` — no path from a DataType (e.g. AI-generated
narrative summaries from pipelines) to a Markdown panel exists. HEL-243 (Metric) and HEL-244 (Text)
established the config-redesign pattern and explicitly deferred Markdown. Separately, HEL-246 added
uploaded images (`POST /api/uploads/image`), but markdown content has no stable way to reference them.

## What Changes

- `MarkdownPanelConfig` (backend + frontend + `schemas/panel.schema.json`) gains
  `dataTypeId`/`fieldMapping`, mirroring `TextPanelConfig` exactly (HEL-244), including the
  absent-vs-null Patch convention. No Flyway migration — `panels.type_id`/`field_mapping` are generic.
- `MarkdownPanel.scala` implements `dataTypeId`/`fieldMapping`/`buildQuery` for real;
  `withBindingCleared` clears only the binding, preserving literal `content` (same divergence-from-
  Metric rationale as Text).
- `MarkdownEditor.tsx` is rebuilt on the field-or-literal pattern: `useBoundOrLiteralState` +
  `DataTypePicker` (Source mode) + `BoundOrLiteralField` with `literalMultiline` (mirrors
  `TextContentEditor`).
- `isBoundCapablePanel` widens to include Markdown; `usePanelData`'s generic slot mapping populates
  `data.content`; `MarkdownRenderer` resolves `data?.content ?? config.content`.
- Markdown rendering resolves `![alt](helio://uploads/image/<id>)` to `/api/uploads/image/<id>` via a
  custom react-markdown `urlTransform` (the default transform strips unknown protocols, so `helio://`
  is dead-on-arrival without one). Resolution targets the uploads route — storage-backend agnostic.
- Rendered markdown images are constrained (`max-width: 100%`) so image refs don't overflow panels,
  including the mobile panel stack; in-scope style-debt cleanup in `MarkdownPanel.css`.
- Docs: the `helio://uploads/image/<id>` URL scheme is documented (new `docs/uploads.md`).

## Capabilities

### New Capabilities

- `markdown-panel-content-source`: Markdown's Source/Static content modes, the rebuilt content editor,
  bound-vs-literal render resolution, and the `helio://uploads/image/<id>` image-ref scheme.

### Modified Capabilities

- `panel-datatype-binding`: bound-capable panel set widens to include Markdown; documents Markdown's
  single-slot (`content`) field mapping and query building.
- `markdown-panel`: editor requirement changes from "plain textarea" to the field-or-literal Content
  editor; rendering requirement gains image-ref resolution.

## Non-goals

- No image-upload UI inside the markdown editor (authors paste `helio://` refs; upload UI is the
  Image panel's concern, HEL-246).
- No backend-side markdown transformation — resolution is render-time, frontend-only.
- No changes to Text/Metric editors or to `BoundOrLiteralField` itself (Text's `literalMultiline`
  already covers Markdown's need).
- No mobile-shell changes — mobile rendering is verified, not modified (HEL-300/301/302 shipped it).

## Impact

Backend: `MarkdownPanel.scala`, `schemas/panel.schema.json`. Frontend: `types/panel.ts`,
`panelNarrowing.ts`, new-shape `MarkdownEditor.tsx`, `MarkdownPanel.tsx`/`.css`,
`MarkdownRenderer.tsx`, `panelPayloads.ts`, `panelThunks.ts`, `panelService.ts`, `panelsSlice.ts`.
Docs: `docs/uploads.md`. No new external dependencies.
