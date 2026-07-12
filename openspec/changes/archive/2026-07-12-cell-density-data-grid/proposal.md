## Why

HEL-240 (Data Grid Standardization) wants a single, documented cell-density contract so every
table-shaped surface looks consistent and future grid work (HEL-253 draggable widths, HEL-255
Table config rework) can build on a stable API instead of re-deriving density behavior per surface.

## What Changes

- Confirm and harden the `density` prop already implemented on the shared `DataGrid` primitive
  (`frontend/src/shared/ui/DataGrid.tsx` / `DataGrid.css`, from HEL-251/HEL-254): three modes
  (`condensed` / `normal` / `spacious`) with variant-based defaults (`preview` → `condensed`,
  `full` → `normal`).
- Verify all six current `DataGrid` consumers (`TypeDetailPanel`, `SourceDetailPanel`,
  `PipelinePreviewModal`, `StepCard`, `SqlTab`, `TableRenderer`) render the correct default density
  for their variant, and that the density CSS tokens/scale match `DESIGN.md`.
- Fill any gaps in the unit-test matrix for density (three modes x preview/full defaults x
  explicit-override behavior).
- Document the density API contract with JSDoc on the `DataGrid` prop plus a short design note
  (`DESIGN.md` or the `DataGrid` file) so HEL-253/HEL-255 can build on it without re-discovery.

## Non-goals

- **Table panel config UI/dropdown for density is explicitly deferred to HEL-255** (Table config
  rework), per project decision — not part of this change, even though it appears in the Linear
  ticket's literal text. See `design.md` for the deferral rationale.
- No backend changes: `TablePanelConfig` gains no `density` field, no codec/patch/schema changes.
- No changes to `DataGrid`'s scroll, column-derivation, or cell-formatting behavior (HEL-254/251
  territory).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `data-grid`: add a requirement that documents/verifies the consumer contract — each of the six
  listed surfaces relies on `DataGrid`'s variant-based density default (no unintended overrides),
  keeping preview surfaces visually condensed and full surfaces normal by default.

## Impact

- `frontend/src/shared/ui/DataGrid.tsx`, `DataGrid.css`, `DataGrid.test.tsx` (docs/tests hardening,
  likely no behavior change).
- Six consumer files (verification only, no behavior change expected unless a gap is found):
  `frontend/src/features/dataTypes/ui/TypeDetailPanel.tsx`,
  `frontend/src/features/sources/ui/SourceDetailPanel.tsx`,
  `frontend/src/features/pipelines/ui/PipelinePreviewModal.tsx`,
  `frontend/src/features/pipelines/ui/StepCard.tsx`,
  `frontend/src/features/sources/ui/SqlTab.tsx`,
  `frontend/src/features/panels/ui/renderers/TableRenderer.tsx`.
- `DESIGN.md` (density documentation note).
- `openspec/specs/data-grid/spec.md` (delta: consumer-contract requirement).
