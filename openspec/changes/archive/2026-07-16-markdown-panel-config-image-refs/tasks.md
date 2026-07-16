# Tasks — markdown-panel-config-image-refs (HEL-245)

## 1. Backend: Markdown joins the bound-capable set (design Decision 1)

- [x] 1.1 `MarkdownPanelConfig` gains `dataTypeId: DataTypeId = DataTypeId("")` and
      `fieldMapping: JsObject = JsObject.empty`; tolerant `decode`; `Patch` with the absent-vs-null
      convention — mirror `TextPanelConfig` in `backend/.../domain/panels/TextPanel.scala`
- [x] 1.2 `MarkdownPanel` implements `dataTypeId`/`fieldMapping`/`buildQuery` like `TextPanel`;
      `withBindingCleared` clears binding only, preserving `content`; `applyPatch` handles the new
      Patch fields
- [x] 1.3 Mirror any Text-specific touches in `PanelRowMapper.scala` / `PanelConfigCodec.scala` /
      services that enumerate bound-capable kinds (grep for how HEL-244 wired Text; verify against
      code, not memory)
- [x] 1.4 Backend tests: decode with fields absent (spray-json omits `Option=None`), Patch
      absent-vs-null semantics, round-trip persistence, unbound-query 404, binding-scrub preserves
      content — mirror the Text panel's HEL-244 test coverage
- [x] 1.5 `schemas/panel.schema.json`: `MarkdownConfig` gains `dataTypeId`/`fieldMapping` (same shape
      as `TextConfig`); check `create-panel-request` / `update-panels-batch-request` schemas for
      parallel Text entries needing a markdown mirror

## 2. Frontend: types, narrowing, payloads, thunks

- [x] 2.1 `types/panel.ts`: `MarkdownPanelConfig` gains `dataTypeId`/`fieldMapping`;
      `emptyMarkdownConfig` updated
- [x] 2.2 `panelNarrowing.ts`: `isBoundCapablePanel` widens to include `MarkdownPanel`
- [x] 2.3 `panelPayloads.ts`: rename `buildTextBindingPatch` → `buildContentBindingPatch` (update Text
      call sites + `panelPayloads.test.ts` mechanically); `buildCreatePanelBody`'s `markdown` case
      wires `dataTypeId` through (mirror `text` case)
- [x] 2.4 `panelService.ts` + `panelThunks.ts` + `panelsSlice.ts`: add `updatePanelMarkdownBinding`
      mirroring `updatePanelTextBinding` (service fn, thunk, fulfilled reducer case)
- [x] 2.5 `PanelCreationModal.tsx`: `DATA_BOUND_TYPES` gains `"markdown"`

## 3. Frontend: editor (design Decision 2)

- [x] 3.1 Extract `fieldOptions` helper to `editors/fieldOptions.ts`; update `BindingEditor.tsx` and
      `TextContentEditor.tsx` to use it (rule of three)
- [x] 3.2 Rebuild `MarkdownEditor.tsx` on `useBoundOrLiteralState` + mode-gated `DataTypePicker` +
      `BoundOrLiteralField` (`literalMultiline`), mirroring `TextContentEditor.tsx` including the
      mode-default heuristic; save via `updatePanelMarkdownBinding`
- [x] 3.3 Editor tests mirroring the Text/Metric editor test approach (mode default, Source save
      shape, Static save shape)

## 4. Frontend: rendering + helio:// scheme (design Decisions 4–5)

- [x] 4.1 New `markdownUrls.ts`: `resolveMarkdownUrl` — `helio://uploads/image/<id>` →
      `/api/uploads/image/<id>` (id validated as single safe path segment), everything else through
      react-markdown's `defaultUrlTransform`; unit tests incl. non-uploads `helio://` and `../` ids
- [x] 4.2 `MarkdownPanel.tsx`: pass `urlTransform={resolveMarkdownUrl}` to `ReactMarkdown`
- [x] 4.3 `MarkdownRenderer.tsx`: accept `data` prop; resolve `data?.content ?? config.content`;
      `PanelContent.tsx` passes `data` (mirror the `TextRenderer` wiring)
- [x] 4.4 Update `MarkdownPanel.test.tsx` / `reactMarkdownMock.tsx` as needed for `urlTransform` and
      bound-content resolution

## 5. Styles (design Decision 6 — read DESIGN.md first)

- [x] 5.1 `MarkdownPanel.css`: constrain images (`max-width: 100%; height: auto`), tokenized radius
- [x] 5.2 In-scope style-debt pass on files already being edited (dead CSS, non-token colors,
      inconsistent spacing) — verify token names against DESIGN.md, no new files

## 6. Docs

- [x] 6.1 New `docs/uploads.md`: `POST /api/uploads/image`, `GET /api/uploads/image/:id`, the
      `helio://uploads/image/<id>` markdown scheme with an example, note that raw
      `/api/uploads/image/<id>` also renders

## 7. Verification

- [x] 7.1 Frontend: `npm run lint`, `npm test`, `npm run format:check`, `npm run build`
- [x] 7.2 Backend: `sbt test`
- [ ] 7.3 Manual smoke via dev servers: static markdown with `helio://` image ref renders; bind a
      markdown panel to a pipeline-output DataType field and see bound content; mobile stack
      (~390×844) renders markdown + image without overflow
      — NOT run by the executor (requires live dev servers + a browser at 390×844). Deferred to
      the evaluator/skeptic live-verification gate; automated coverage stands in for it:
      `markdownUrls.test.ts` (scheme resolution incl. traversal/query rejection),
      `MarkdownPanel.test.tsx` (urlTransform applied end-to-end), `PanelDetailModal.markdownContent.test.tsx`
      (Source/Static save shapes), and `.markdown-panel img { max-width: 100% }` (overflow guard).
