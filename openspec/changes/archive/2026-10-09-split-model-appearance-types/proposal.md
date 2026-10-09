## Why

`backend/src/main/scala/com/helio/domain/model/model.scala` is 1306 lines at b409172a, five times CONTRIBUTING's ~250-line
soft budget. Its one block of real behaviour is the panel/chart appearance patch decode-and-merge (HEL-362, HEL-1304),
which sits between unrelated id wrappers and dashboard types. Moving it into its own files makes the HEL-1304 merge rule
reviewable on its own and shrinks model.scala by ~270 lines.

## What Changes

- New `ChartAppearance.scala` in `com.helio.domain.model`: `ChartLegend`, `ChartTooltip`, `ChartAxisLabel`,
  `ChartAxisLabels`, `ChartAppearance` and its companion (`Default`, `Patch`, `Patch.decode`, `applyPatch`).
- New `PanelAppearance.scala` in the same package: `PanelAppearance` and its companion (`Default`, `Patch`,
  `Patch.decode`, `applyPatch`, `applyPatchJson`).
- Code moves byte-identical; model.scala loses those spans and the two imports only they used.
- Add one golden JSON round-trip spec pinning the serialized shape of representative appearances (guard, not a fix).
- Update `domain/model/README.md`'s file list.

## Non-goals

- No package change, no rename, no signature, default, logger-name or wire change; no caller edits.
- No bug fixes, comment rewrites or cleanup (e.g. the domain->`api.http.RequestValidation` dependency); findings become
  follow-ups.
- No further split of model.scala (still ~1040 lines after this); the PR proposes next seams.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None — pure structural refactor (`skip_specs: true`).

## Impact

- `backend/src/main/scala/com/helio/domain/model/` (model.scala shrinks, two new files, README); one new test spec.
- No API, schema, migration, frontend or helio-mcp impact.
