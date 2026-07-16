# Files modified — markdown-panel-config-image-refs (HEL-245)

## Backend

- `backend/src/main/scala/com/helio/domain/panels/MarkdownPanel.scala` — `MarkdownPanelConfig` gains `dataTypeId`/`fieldMapping` (tolerant `decode`, absent-vs-null `Patch`); `MarkdownPanel` implements `dataTypeId`/`fieldMapping`/`buildQuery`; `withBindingCleared` preserves literal `content`. Mirrors `TextPanel` wholesale.
- `backend/src/main/scala/com/helio/infrastructure/PanelRowMapper.scala` — **skeptic-verified gap fix**: `domainToRow`/`markdownConfig` now persist and read `typeId`/`fieldMapping` for Markdown (previously discarded — a bound Markdown panel silently reverted to unbound on round-trip).
- `schemas/panel.schema.json` — `MarkdownConfig` gains `dataTypeId`/`fieldMapping` (create/batch schemas inherit via `$ref` / generic `config`).
- `backend/src/test/scala/com/helio/domain/PanelSpec.scala` — Markdown binding coverage: decode with fields absent, Patch absent-vs-null, round-trip, bound buildQuery, binding-scrub preserves content.
- `backend/src/test/scala/com/helio/infrastructure/PanelRowMapperSpec.scala` — bound + unbound Markdown row round-trip (regression lock for the persistence gap).

## Frontend — types / state

- `frontend/src/features/panels/types/panel.ts` — `MarkdownPanelConfig` gains `dataTypeId`/`fieldMapping`; `emptyMarkdownConfig` updated.
- `frontend/src/features/panels/state/panelNarrowing.ts` — `isBoundCapablePanel` widens to include `MarkdownPanel`.
- `frontend/src/features/panels/state/panelPayloads.ts` — `buildTextBindingPatch` → `buildContentBindingPatch` (shared Text+Markdown); `markdown` create case wires `dataTypeId`; removed orphaned `buildContentPatch`/`buildMarkdownPatch`.
- `frontend/src/features/panels/services/panelService.ts` — added `updatePanelMarkdownBinding`; removed orphaned `updatePanelContent`; renamed patch-builder import.
- `frontend/src/features/panels/state/panelThunks.ts` — added `updatePanelMarkdownBinding` thunk; removed orphaned `updatePanelContent` thunk.
- `frontend/src/features/panels/state/panelsSlice.ts` — added `updatePanelMarkdownBinding` fulfilled case + re-export; removed `updatePanelContent`.
- `frontend/src/features/toasts/state/toastListeners.ts` — doc-comment update (silent thunk list).

## Frontend — editor / rendering

- `frontend/src/features/panels/ui/editors/fieldOptions.ts` — **new**: shared `fieldOptions` helper extracted at third use.
- `frontend/src/features/panels/ui/editors/BindingEditor.tsx` / `TextContentEditor.tsx` — use the shared `fieldOptions`.
- `frontend/src/features/panels/ui/editors/MarkdownEditor.tsx` — rebuilt on `useBoundOrLiteralState` + mode-gated `DataTypePicker` + `BoundOrLiteralField` (`literalMultiline`), mirroring `TextContentEditor`; saves via `updatePanelMarkdownBinding`.
- `frontend/src/features/panels/ui/markdownUrls.ts` — **new**: `resolveMarkdownUrl` (`helio://uploads/image/<id>` → `/api/uploads/image/<id>`, safe-segment id validation, else `defaultUrlTransform`).
- `frontend/src/features/panels/ui/MarkdownPanel.tsx` — passes `urlTransform={resolveMarkdownUrl}` to `ReactMarkdown`.
- `frontend/src/features/panels/ui/renderers/MarkdownRenderer.tsx` — accepts `data`; resolves `data?.content ?? config.content`.
- `frontend/src/features/panels/ui/PanelContent.tsx` — passes `data` to `MarkdownRenderer`.
- `frontend/src/features/panels/ui/PanelCreationModal.tsx` — `DATA_BOUND_TYPES` gains `"markdown"`.
- `frontend/src/features/panels/ui/PanelCreationPreview.tsx` — markdown preview config cast widened for new fields.
- `frontend/src/features/panels/ui/MarkdownPanel.css` — constrain images (`max-width: 100%; height: auto; border-radius: var(--app-radius-sm)`); tokenized padding (`--space-2`/`--space-3`).

## Frontend — tests

- `frontend/src/features/panels/ui/markdownUrls.test.ts` — **new**: scheme resolution (incl. traversal/query/slash rejection).
- `frontend/src/features/panels/ui/PanelDetailModal.markdownContent.test.tsx` — **new**: Markdown editor Source/Static mode + save-shape coverage.
- `frontend/src/features/panels/ui/MarkdownPanel.test.tsx` — `helio://` image-ref resolution via urlTransform.
- `frontend/src/test/reactMarkdownMock.tsx` — added a faithful `defaultUrlTransform` export + `urlTransform` application in the mock.
- `frontend/src/test/panelFixtures.ts` — `makeMarkdownPanel` seeds `dataTypeId`/`fieldMapping`.
- `frontend/src/features/panels/state/panelPayloads.test.ts` — rename + markdown create-case coverage.
- `frontend/src/features/panels/state/panelsSlice.test.ts` — `updatePanelContent` → `updatePanelMarkdownBinding` fulfilled case.
- `frontend/src/features/panels/ui/PanelDetailModal.test.tsx` — migrated `updatePanelContent` mock refs to `updatePanelMarkdownBinding`.
- `frontend/src/features/panels/ui/PanelCreationModal.test.tsx` — markdown now data-bound: generic create-flow tests use Image; new markdown datatype-step + create-dataTypeId tests.
- `frontend/src/features/panels/ui/PanelDetailModal.textContent.test.tsx` — stale comment rename.

## Docs

- `docs/uploads.md` — **new**: upload endpoints + `helio://uploads/image/<id>` scheme.

## Cycle 2 — mobile touch-target fix (skeptic final-gate CR #2)

- `frontend/src/features/panels/ui/PanelDetailModal.css` — added a mobile-scoped (`@media (max-width: 768px)`), style-only override bumping the Content editor's tap targets to the 44px minimum: `.panel-detail-modal__mode-toggle-btn` (Bind to field / Fixed text — measured 28px), `.panel-detail-modal__type-option` (DataType rows), `.panel-detail-modal__type-clear` (×, was 20×20), and `.panel-detail-modal .ui-select__trigger` (field select, was 32px). No `BoundOrLiteralField`/`DataTypePicker` logic touched. 768px matches the mobile-shell breakpoint (`BottomNav.css`, DESIGN.md §4) where the 44px convention already lives; `44px` is the a11y tap minimum (BottomNav.css precedent), not a `--control` token.
- `frontend/src/features/panels/ui/PanelDetailModal.css.test.ts` — **new**: static CSS-lock (MobilePanelStack.css.test.ts precedent) asserting the mobile `@media` block keeps the four ≥44px rules; brace-matches the media block so it can't regress silently.

## Note on the skeptic-verified gap (task 1.3)

Root cause (persistence layer): `PanelRowMapper.domainToRow`'s Markdown arm wrote only `content`, dropping `type_id`/`field_mapping`; `markdownConfig` read only `content`. A Source-mode Markdown panel would therefore lose its binding on the next read. Fix mirrors the Text arm exactly. Regression lock: the two new `PanelRowMapperSpec` round-trip tests fail against the pre-fix mapper and pass after. `PanelConfigCodec`/`DashboardSnapshotRepository` already dispatched Markdown symmetrically (via `decode`/`Patch.decode`/`MarkdownCreate`), so mirroring the config/Patch shape was sufficient there. `dataTypeIdFromCreateConfig` deliberately still lists only the metric/chart/table "bound trio" — Text is absent too, so Markdown matches Text by omission; PATCH re-bind validation (`dataTypeIdFromConfigPatch`) reads raw JSON and already covers both.
