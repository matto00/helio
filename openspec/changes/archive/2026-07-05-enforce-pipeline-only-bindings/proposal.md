## Why

Helio's core architecture (v1.3) is a linear flow: DataSource → Pipeline → DataType → Panel. In practice the
flow leaks: registering a source auto-creates a companion DataType (`sourceId != null`) that the BindingEditor
still offers as a panel binding target, and the "legacy binding" warning banner fires on every panel bound
through that (fully supported) path — i.e. constantly, for normal usage. The warning's premise ("sourceId set ⇒
pre-v1.3 relic") is wrong today, and the roadmap-v2 goal "remove the direct DataSource → Panel binding path"
was never finished.

## What Changes

- **Migration (V41)**: every companion DataType currently bound to ≥1 panel is converted into a pipeline-output
  type — a zero-step pass-through pipeline (source → type) is created, the type's `sourceId` is cleared, and a
  fresh companion DataType is inserted for the source so schema display / analyze / refresh keep working.
  Panel bindings and row snapshots are untouched; panels keep rendering.
- **Backend guard**: `POST /api/panels` and `PATCH /api/panels/:id` reject a `dataTypeId`/`typeId` that resolves
  to a companion DataType (`sourceId != null`) with 400.
- **Removed**: `PanelLegacyWarning` banner, `useLegacyBoundPanel` hook, and the `panel-legacy-binding-warning`
  capability — obsolete once companion types can no longer be bound.
- **Frontend**: BindingEditor and Type Registry list only pipeline-output DataTypes (companion types become
  internal); pipeline detail's mock multi-source bar (`SourceSelectorBar`/`SourceChip`) is replaced with a
  read-only display of the pipeline's single bound source; source-delete warning keys off dependent pipelines
  instead of companion-type panel bindings; misleading empty-state copy corrected.

## Capabilities

### Removed Capabilities

- `panel-legacy-binding-warning`: retired — no bindable companion types remain, so there is nothing to warn about.

### Modified Capabilities

- `panel-datatype-binding`: picker restricted to pipeline-output types; source badge removed; backend rejects
  companion-type bindings.
- `data-type-persistence`: documents companion DataTypes as internal source-schema records plus the V41
  conversion migration.
- `pipeline-editor-page`: read-only bound-source display replaces the mock source selector bar.
- `datasource-edit-delete`: delete warning is pipeline-dependency based.

## Non-goals

- Consolidating the `/api/sources` vs `/api/data-sources` route/service split (tracked separately).
- Removing companion DataTypes from the `GET /api/types` response (frontend still reads them for source schema
  display; API-level hiding can follow later).
- Auto-running the migrated pass-through pipelines; they run on first user demand like any pipeline.
