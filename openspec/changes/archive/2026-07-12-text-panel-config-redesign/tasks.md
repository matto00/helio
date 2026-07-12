## 1. Backend: TextPanelConfig binding infrastructure

- [x] 1.1 Extend `TextPanelConfig` (`backend/src/main/scala/com/helio/domain/panels/TextPanel.scala`) with
      `dataTypeId: DataTypeId = DataTypeId("")` and `fieldMapping: JsObject = JsObject.empty`; update
      `Empty`, `format` (jsonFormat3), and tolerant `decode`/`decodeCreate` mirroring `MetricPanelConfig`.
- [x] 1.2 Extend `TextPanelConfig.Patch` with `dataTypeId: Option[Option[DataTypeId]]` and
      `fieldMapping: Option[Option[JsObject]]` (absent-vs-null, mirroring `MetricPanelConfig.Patch`);
      keep the existing `content` field's current absent/JsNull-to-"" semantics unchanged; update `isEmpty`
      and `Patch.decode`.
- [x] 1.3 Implement `TextPanel.dataTypeId`/`fieldMapping`/`buildQuery` for real (mirror `MetricPanel`);
      implement `withBindingCleared` to clear only `dataTypeId`/`fieldMapping`, preserving `content`
      (per design.md Decision 1 — do NOT reset to `TextPanelConfig.Empty`).
- [x] 1.4 Update `TextPanel.applyPatch` to apply `dataTypeId`/`fieldMapping` patches alongside the existing
      `content` patch.
- [x] 1.5 Update `PanelRowMapper.textConfig` to read `row.typeId`/`row.fieldMapping` into
      `TextPanelConfig`; update `domainToRow`'s `TextPanel` case to write `typeId`/`fieldMapping` from
      `config.dataTypeId`/`config.fieldMapping` alongside the existing `content` write.
- [x] 1.6 Update `schemas/panel.schema.json`'s `TextConfig` def to add `dataTypeId`/`fieldMapping`
      properties (mirror `MetricConfig`).

## 2. Frontend: types and narrowing

- [x] 2.1 Extend `TextPanelConfig` in `frontend/src/features/panels/types/panel.ts` with `dataTypeId:
      string` and `fieldMapping: Record<string, string>`; update `emptyTextConfig`.
- [x] 2.2 Widen `isBoundCapablePanel` in `panelNarrowing.ts` to `p is MetricPanel | ChartPanel |
      TablePanel | TextPanel`.
- [x] 2.3 Verify `usePanelData.ts` needs no other changes — confirm the generic per-slot `data` mapping
      loop produces `data.content` for a bound Text panel and `currentFetchKey`/pageSize logic already
      covers `text` via its existing else-branches.

## 3. Frontend: Content editor

- [x] 3.1 Add an optional `literalMultiline?: boolean` prop to `BoundOrLiteralField.tsx`; when true, render
      a `Textarea` instead of `TextField` in literal mode. Default `false`; no behavior change for
      existing Metric Label/Unit call sites.
- [x] 3.2 Create `TextContentEditor.tsx` (`frontend/src/features/panels/ui/editors/`): fetches DataTypes
      (mirror `BindingEditor`'s inline fetch-and-filter), owns `selectedTypeId`/`typeSearch` state, and
      renders `DataTypePicker` only when `useBoundOrLiteralState`'s mode is "field" (Source); renders
      `BoundOrLiteralField` (label "Content", `literalMultiline: true`) always. Implements
      `PanelEditorHandle` (`reset`/`save`) mirroring `MarkdownEditor`'s ref-handle shape.
- [x] 3.3 Add a `buildTextBindingPatch` builder in `panelPayloads.ts` producing `{ dataTypeId, fieldMapping:
      { content: field } | null }` plus `content` **only when the editor's mode is Static** — per design.md
      Decision 1's bind-direction corollary, do NOT forward `contentState.patchValue` into the outgoing
      patch when mode is Source (unlike `buildBindingPatch`'s `label`/`unit` handling for Metric); omit the
      `content` key entirely on a Source-mode save so `TextPanelConfig.Patch.decode`'s "absent = unchanged"
      convention preserves the prior literal text.
- [x] 3.4 Wire `TextContentEditor` into `PanelDetailModal.tsx`: add `isTextPanel` import, a
      `textEditorRef`, an `activeEditorRef()` branch, and a `renderSubtypeEditor()` branch.
- [x] 3.5 Update `panelPayloads.ts`'s `seedCreateConfig` `"text"` case to seed `dataTypeId` from the
      creation modal's already-passed `dataTypeId` argument (currently discarded).

## 4. Tests

- [x] 4.1 Backend: `TextPanelConfig`/`Patch` decode/encode tests (tolerant decode, absent-vs-null patch
      semantics) mirroring `MetricPanelConfig`'s existing test coverage.
- [x] 4.2 Backend: `TextPanel.buildQuery`/`withBindingCleared` tests, including the content-preserved-on-
      clear behavior (Decision 1 divergence from Metric).
- [x] 4.3 Backend: `PanelRowMapper` round-trip test for a bound Text panel (typeId/fieldMapping persist
      through `domainToRow`/`rowToDomain`).
- [x] 4.4 Frontend: `usePanelData` test — bound Text panel resolves `data.content` from the first row's
      mapped field.
- [x] 4.5 Frontend: `TextContentEditor` tests — mode toggle, DataType picker visibility gating, save
      payload shape for both Source and Static modes, reset/dirty tracking, and an explicit regression
      case: saving in Source mode does NOT null/clear `config.content` (skeptic-flagged gap, design.md
      Decision 1 bind-direction corollary).
- [x] 4.6 Frontend: `BoundOrLiteralField` test for the new `literalMultiline` prop (textarea vs text
      field) and a regression check that Metric's existing tests still pass unmodified.
- [x] 4.7 Frontend: `PanelContent`/`TextRenderer` regression test — an existing unbound Text panel with
      only literal `content` renders unchanged.
- [x] 4.8 Frontend: `PanelCreationModal` test — creating a Text panel with a selected DataType now seeds
      `config.dataTypeId` (previously discarded).
