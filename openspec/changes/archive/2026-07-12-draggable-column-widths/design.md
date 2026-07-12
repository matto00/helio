## Context

HEL-240's grid-standardization chain: HEL-254 (scroll, merged) -> HEL-252 (density, merged) ->
HEL-253 (this change) -> HEL-255 (Table config rework, not yet started).

`DataGrid` (`frontend/src/shared/ui/DataGrid.tsx`) has six consumers today: `TypeDetailPanel`,
`SourceDetailPanel`, `PipelinePreviewModal`, `StepCard`, `SqlTab` (all `variant="preview"`), and
`TableRenderer` (`variant="full"`, the only Table-panel consumer). No resize capability exists
anywhere in the codebase today (`grep` for resize/columnWidth/colWidth in `DataGrid.tsx`/`.css`
returns nothing) — this is genuinely net-new, unlike HEL-252's density prop which was already built.

`TablePanelConfig` (`backend/src/main/scala/com/helio/domain/panels/TablePanel.scala`) currently
carries only `dataTypeId` + `fieldMapping`, with a matching `Patch` (`Option[Option[X]]`
absent-vs-null convention) and a `schemas/panel.schema.json` `TableConfig` def with
`additionalProperties: false`. The frontend mirrors this in `frontend/src/features/panels/types/
panel.ts` (`TablePanelConfig`, `emptyTableConfig()`) and `panelPayloads.ts` (`buildBindingPatch`).

`PanelGrid.tsx` configures React Grid Layout with an explicit drag handle selector
(`dragConfig={{ handle: ".panel-grid-card__handle" }}`), not a `cancel` selector — panel dragging
only starts from that specific handle element. Panel resizing is a `react-resizable` corner handle
(`.react-resizable-handle`). Neither is triggered by mousedown elsewhere in the card, so a column
resize handle inside `DataGrid`'s `<thead>` is structurally isolated from both, provided we don't
reuse either class name and don't let a synthetic event get misrouted by a portal/ref hack.

## Scope boundary vs. HEL-255 (recorded per project decision, overrides earlier HEL-252 note)

HEL-252's design.md left an informal note earmarking width-persistence for HEL-255. That note is
**superseded**: HEL-253's own title ("...with persistence on Table panels") and DoD ("widths
persist across reload") make persistence this ticket's differentiator, not an add-on. Decision
(recorded here + posted to Linear HEL-255):

- **HEL-253 owns**: the drag-resize interaction (primitive) AND the full persistence vertical
  slice for Table panels — backend field/codec/patch/schema + frontend load/save wiring.
- **HEL-255 owns only**: config-UI *controls* layered over storage that already exists by the time
  it starts — the density dropdown (HEL-251/252 storage) and any width-related controls (e.g. a
  "reset column widths" button) over the `columnWidths` storage this change adds. HEL-255 does not
  build any storage.

## Goals / Non-Goals

**Goals:**
- Column-resize drag handles on `DataGrid` headers, `variant="full"` only, 60px minimum width, one
  column at a time (no redistribution), debounced persistence for Table panels.
- Keep `variant="preview"` consumers unaffected — no resize affordance, no width state.
- Isolate resize gesture from PanelGrid's RGL drag/resize handles.

**Non-Goals:**
- No Table-panel config UI/dropdown for widths (HEL-255).
- No resize on preview-variant consumers.
- No column reordering — width only.

## Decisions

- **`DataGrid` owns transient/controlled width state; the Table panel owns persistence.** Add an
  optional `columnWidths?: Record<string, number>` + `onColumnResize?: (key: string, width:
  number) => void` prop pair to `DataGrid`. `DataGrid` renders resize handles only when
  `variant="full"` (guards preview automatically without a separate opt-out flag — matches the
  existing `variant`-gated density-default pattern). Resize handles report live width via
  `onColumnResize`; `DataGrid` itself does not persist anything, keeping the primitive stateless
  and preview-safe by construction. Alternative considered: a `resizable` boolean prop — rejected
  because it adds a second way to end up resizable-in-preview (misuse-by-default risk); gating on
  `variant` alone matches the density precedent and the ticket's explicit "preview variants do NOT
  expose resizing" requirement.
- **`TableRenderer` is the persistence boundary**, not `DataGrid`. Today `TableRenderer` receives
  no `panel`/`panelId`/`config` at all (`TableRendererProps` is `rawRows`/`headers`/pagination
  fields only) — unlike its sibling renderers on the same `PanelContent.tsx` dispatcher
  (`DividerRenderer`, `MarkdownRenderer`, `ImageRenderer`), which all receive the full `panel`
  object. This change extends `TableRendererProps` with `panelId: string` and
  `columnWidths?: Record<string, number>` (mirroring the narrower prop style `TableRenderer`
  already uses, rather than the full-`panel` style, since `TableRenderer` only ever needs these two
  fields) and updates `PanelContent.tsx`'s `<TableRenderer>` call site (`isTablePanel(panel)`
  branch) to pass `panel.id` and `panel.config.columnWidths` through.
- **Persistence timing: a self-contained local debounce, not the `PanelGrid` autosave pipeline.**
  Verified there is no 250ms (or any) debounce on `PanelGrid`'s layout persistence —
  `usePanelGridSave.ts` batches layout changes into a **30-second auto-save interval** plus
  explicit flush points (`SaveStateContext`/`SaveStateIndicator`), because layout changes fire on
  every drag tick and are non-critical to persist immediately. That pipeline is the wrong fit here:
  a 30s window would visibly violate the "widths persist across reload" DoD for a user who resizes
  and reloads shortly after. Instead, `TableRenderer` follows the pattern every other panel-config
  field already uses for direct persistence — `updatePanelBinding`/`updatePanelContent`/
  `updatePanelImage`/`updatePanelDivider` in `panelService.ts` all PATCH `/api/panels/:id`
  immediately, bypassing the layout autosave pipeline entirely (that pipeline is layout-position–
  specific, not a general panel-config mechanism). Because `onColumnResize` can fire many times
  per drag, `TableRenderer` wraps its call to a new `updatePanelColumnWidths` with a local
  `useRef<ReturnType<typeof setTimeout>>` debounce (same hand-rolled ref+setTimeout pattern already
  used in `frontend/src/features/pipelines/ui/ComputedFieldForm.tsx` for its 400ms input-validation
  debounce — this codebase's actual debounce idiom, no library dependency). 400ms after the last
  resize event, it fires one direct PATCH with the final width. Local width state updates
  synchronously on every `onColumnResize` call so the drag itself feels responsive; only the
  network call is debounced.
- **New `columnWidths: Map[String, Int]` field on `TablePanelConfig`**, following the exact
  `fieldMapping: JsObject` pattern already in `TablePanel.scala`: `Empty` defaults to `Map.empty`,
  `decode`/`Patch.decode` follow the same `Option[Option[X]]` absent-vs-null convention, `Patch`
  gets a `columnWidths: Option[Option[Map[String, Int]]]` field, `applyPatch` folds it the same way
  `fieldMapping` does. `schemas/panel.schema.json`'s `TableConfig` gets a matching `columnWidths`
  object property (string keys, integer values, `additionalProperties: false` on both levels).
  Alternative considered: storing widths under `PanelAppearance` (like `ChartAppearance`) —
  rejected because widths are a Table-specific *binding-adjacent* config (tied to which columns are
  bound, not visual theming), so they belong with `dataTypeId`/`fieldMapping` in `TablePanelConfig`,
  not appearance.
- **A dedicated `buildTableWidthsPatch` payload builder** (in `panelPayloads.ts`, alongside
  `buildBindingPatch`) rather than folding widths into `buildBindingPatch`, since width edits are
  driven by drag gestures (frequent, debounced) on a completely different cadence than binding
  edits (deliberate, modal-driven) — keeping them as separate PATCH calls avoids a fast drag
  clobbering an in-flight binding edit's absent-vs-null semantics.
- **Resize handle stops propagation on `mousedown`/`pointerdown`** before RGL's card-level drag
  listener can see it, and lives in its own `<span class="ui-data-grid__resize-handle">` inside each
  `<th>` — distinct from both `.panel-grid-card__handle` (drag) and `.react-resizable-handle`
  (panel resize), so no selector collision is even possible; the `stopPropagation` is a second,
  defense-in-depth layer verified live per the ticket's explicit callout.

## Risks / Trade-offs

- [Risk] Existing Table panels have no `columnWidths` in their stored config (nullable/absent).
  Mitigation: `Patch.decode`/`decode` treat absent as `Map.empty`, and `TableRenderer` treats an
  empty map as "no override" — `DataGrid` falls back to its existing auto-width behavior per
  column, so old panels render unchanged until a user first drags a column.
- [Risk] Debounced PATCH racing a binding-edit PATCH on the same panel. Mitigation: separate PATCH
  calls already isolated per-field via the existing `Option[Option[X]]` patch semantics — a widths
  patch never touches `dataTypeId`/`fieldMapping` keys and vice versa, so they don't clobber.
- [Risk] Resize handle mousedown reaching RGL's drag listener despite the handle-selector gate, if
  a future refactor changes `dragConfig`. Mitigation: `stopPropagation` as defense-in-depth (see
  Decisions), plus a live-interaction check in evaluation per the ticket's explicit callout.

## Planner Notes

- Self-approved: new `table-panel-column-widths` capability (new spec.md) rather than folding into
  `data-grid`, since persistence is Table-panel-specific and cross-cuts backend + frontend, while
  `data-grid` stays scoped to the primitive's rendering contract (matches the existing
  proposal/spec split for HEL-254/HEL-252's each-ticket-modifies-`data-grid`-for-primitive-only
  precedent, plus one new capability where the change is a new persisted concern).
- Self-approved: storing widths on `TablePanelConfig` rather than `PanelAppearance` (see Decisions).
- HEL-255 scope boundary is a project decision (human-approved), not a self-approval — recorded
  here and posted to Linear HEL-255 for traceability.
