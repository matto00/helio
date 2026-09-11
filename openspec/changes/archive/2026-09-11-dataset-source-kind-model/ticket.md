# HEL-1073: `dataset` source kind: domain model, connector registration, and the `static` wire alias

## Description

Add `DatasetSource` alongside the existing `DataSource` ADT members and register `kind = "dataset"` in `ConnectorRegistry`. `DataSourceKind.All` is registry-derived (HEL-484), so no allow-list edit is needed and `ConnectorRegistrySpec`'s drift-detection test guards the change.

`"static"` stays accepted on the wire as an alias for one minor release, mapped at `DataSourceKind.parseKind`.

## Acceptance Criteria

- Creating a source with `type: "dataset"` round-trips.
- `type: "static"` still round-trips and resolves to `dataset`.
- `ConnectorRegistrySpec` passes.

## Reference

Design spec: `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md` (PR #627)

## Context inherited from HEL-1074 (Migration A, merged 730b42d8 / PR #632)

- `data_sources.source_type` is now stored as `"dataset"` for what used to be `"static"` rows (backfilled by V106).
- The Scala ADT member is still named `StaticSource`, deliberately left un-renamed pending this ticket — see `DataSource.scala`'s scaladoc: "the Scala ADT member here stays named `StaticSource` — renaming it is HEL-1073's scope, not this one's."
- `ConnectorRegistry.scala` still registers `kind = "static"` (`staticMetadata`) — not yet updated to `"dataset"`.
- `openspec/changes/archive/2026-09-10-migration-a-dataset-rows/design.md` Decisions 6/7 are binding context for this ticket.
- The v0.8 design spec states static is *migrated to* dataset — a lingering second ADT member for the same stored kind ("static" as a literal separate case alongside "dataset") would be a scope trap; this ticket must decide explicitly whether to rename `StaticSource` -> `DatasetSource` (keeping one ADT member, `kind = "dataset"`, with `"static"` as a wire-only alias) or add a genuinely distinct sibling, and justify the choice in `design.md`.

## Explicitly out of scope

- HEL-1118 (stale `StaticSource` scaladoc repo-wide sweep) — driver will dispatch separately after this ticket merges. If this ticket renames the class, update only the scaladoc on the renamed class/file itself as a natural consequence of the rename — not a repo-wide sweep.
