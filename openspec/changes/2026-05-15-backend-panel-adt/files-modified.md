# Files modified — CS2c-3b cycle 1

## New files (backend)

- `backend/src/main/scala/com/helio/domain/Panel.scala` (162L) —
  `trait Panel` (non-sealed, documented), `Panel.Companion`,
  `Panel.Registry`, `PanelKind` constants. Single source of truth for
  the 7 panel kinds. Shared `selectedFieldsFromMapping` helper.

- `backend/src/main/scala/com/helio/domain/panels/package.scala` (21L) —
  shared `DataTypeId` JSON format used by per-subtype config JSON
  formats.

- `backend/src/main/scala/com/helio/domain/panels/MetricPanel.scala`
  (78L) — `MetricPanelConfig(dataTypeId, fieldMapping)` + case class
  + tolerant decoder + companion + Registry entry.

- `backend/src/main/scala/com/helio/domain/panels/ChartPanel.scala`
  (82L) — same shape as MetricPanel; documented as the "bound trio"
  share-shape concern.

- `backend/src/main/scala/com/helio/domain/panels/TablePanel.scala`
  (73L) — same shape as MetricPanel/ChartPanel.

- `backend/src/main/scala/com/helio/domain/panels/TextPanel.scala`
  (52L) — `TextPanelConfig(content)`.

- `backend/src/main/scala/com/helio/domain/panels/MarkdownPanel.scala`
  (53L) — `MarkdownPanelConfig(content)`; shape identical to TextPanel.

- `backend/src/main/scala/com/helio/domain/panels/ImagePanel.scala`
  (62L) — `ImagePanelConfig(imageUrl, imageFit)` + `DefaultFit`
  constant.

- `backend/src/main/scala/com/helio/domain/panels/DividerPanel.scala`
  (73L) — `DividerPanelConfig(orientation, weight, color)` +
  `DefaultOrientation` constant + `validateConfig` invariant
  (`weight > 0` if present).

- `backend/src/main/scala/com/helio/infrastructure/PanelRowMapper.scala`
  (122L) — Slick row ↔ typed `Panel` ADT mapper. Mixes in
  `PanelProtocol` for the `PanelAppearance` JSON format. Used by
  `PanelRepository` and `DashboardRepository` (eliminates the row→Panel
  duplication that existed in both).

- `backend/src/test/scala/com/helio/domain/PanelSpec.scala` (160L) —
  14 tests: Registry parity, kind correctness per subtype,
  `dataTypeId`/`validateConfig`/`buildQuery` polymorphism, JSON config
  decode tolerance, exhaustiveness pattern-match.

## Modified files (backend)

- `backend/src/main/scala/com/helio/domain/model.scala`
  (-32L; 293L → 268L net) — old wide-flat `Panel` case class deleted;
  `Panel.buildQuery` free function deleted (now polymorphic on the
  trait); unused `JsString` / `JsObject` import scrubbed.

- `backend/src/main/scala/com/helio/infrastructure/PanelRepository.scala`
  (-32L; 305L → 273L) — `rowToDomain` / `domainToRow` delegated to
  `PanelRowMapper`. Repository now focuses purely on Slick query logic.

- `backend/src/main/scala/com/helio/infrastructure/DashboardRepository.scala`
  (-17L; 297L → 281L) — `panelRowToDomain` delegated to
  `PanelRowMapper.rowToDomain`. Eliminates the duplicate row→Panel
  mapping that existed in both repos.

- `backend/src/main/scala/com/helio/services/PanelService.scala`
  (+40L; 287L → 327L) — typed ADT consumption:
  `resolveBindingsForRead` and `resolveSingleBinding` consume the
  polymorphic `dataTypeId` / `withBindingCleared`; create path
  dispatches to a new `buildNewPanel` helper that constructs the
  correct typed subtype based on `PanelType`.

- `backend/src/main/scala/com/helio/services/PanelPatchApplier.scala`
  (+0L net) — `panel.typeId` → `panel.dataTypeId`,
  `panel.fieldMapping` reads via the polymorphic accessor.

- `backend/src/main/scala/com/helio/api/protocols/PanelProtocol.scala`
  (+18L; 211L → 229L) — `PanelResponse.fromDomain` pattern-matches the
  typed subtype back to the wide-flat wire shape. The single
  integration point that CS2c-3c rewrites for the `config`-collapse
  wire shape.

- `backend/src/main/scala/com/helio/api/protocols/DashboardProtocol.scala`
  (+39L; 186L → 225L) — `DashboardSnapshotPanelEntry.fromDomain`
  pattern-matches the typed subtype back to the wide-flat snapshot
  shape. The single integration point that CS2c-3c rewrites for the
  snapshot wire-shape break.

- `backend/src/main/scala/com/helio/api/routes/PanelRoutes.scala`
  (1-line diff) — `Panel.buildQuery(panel)` → `panel.buildQuery`
  (polymorphic).

- `backend/src/main/scala/com/helio/app/DemoData.scala`
  (+7L; 137L → 144L) — 4 seeded panels constructed as `MetricPanel`,
  `TablePanel`, `ChartPanel`, `ChartPanel` (was generic `Panel(...)`
  with `panelType = ...`).

## New files (openspec)

- `openspec/changes/2026-05-15-backend-panel-adt/ticket.md`
- `openspec/changes/2026-05-15-backend-panel-adt/proposal.md`
- `openspec/changes/2026-05-15-backend-panel-adt/design.md`
- `openspec/changes/2026-05-15-backend-panel-adt/tasks.md` (now with
  cycle-1 progress marked)
- `openspec/changes/2026-05-15-backend-panel-adt/executor-report-1.md`
- `openspec/changes/2026-05-15-backend-panel-adt/files-modified.md`
  (this file)

## Summary

- 11 new backend files (1 trait + 7 per-subtype + 1 package + 1 mapper + 1 test)
- 8 modified backend files
- 6 new openspec docs
- 0 schema changes (wire shape preserved)
- 0 frontend changes (wire shape preserved)
- 0 Flyway migrations (DB schema unchanged)

## Verification gates (all green)

- `sbt test` — 591/591 PASS (577 baseline + 14 new PanelSpec)
- `npm test` — 664/664 PASS (frontend untouched)
- `npm run lint` — zero warnings
- `npm run format:check` — clean
- `npm run check:schemas` — clean (6 schemas in sync; wide-flat
  wire shape preserved)
- `npm run check:openspec` — clean
- `npm run check:scala-quality` — clean, 19 soft warnings (matches
  CS2c-3a baseline exactly; no inline FQNs)
- `git diff main -- backend/src/main/scala/com/helio/services/AuthService.scala`
  — empty

## File-size snapshot

| File | Before | After | Soft target |
|---|---:|---:|---:|
| `domain/model.scala` | 293 | 268 | ≤ 250 (over by 18) |
| `domain/Panel.scala` | new | 162 | ≤ 250 |
| `domain/panels/<Kind>Panel.scala` × 7 | new | 52–82 | ≤ 200 |
| `domain/panels/package.scala` | new | 21 | ≤ 80 |
| `infrastructure/PanelRepository.scala` | 305 | 273 | ≤ 250 (over by 23) |
| `infrastructure/PanelRowMapper.scala` | new | 122 | ≤ 250 |
| `infrastructure/DashboardRepository.scala` | 297 | 281 | ≤ 250 (over by 31) |
| `services/PanelService.scala` | 287 | 327 | ≤ 300 (over by 27) |
| `services/PanelPatchApplier.scala` | 109 | 109 | ≤ 250 |
| `api/protocols/PanelProtocol.scala` | 211 | 229 | ≤ 250 |
| `api/protocols/DashboardProtocol.scala` | 186 | 225 | ≤ 250 |
| `api/routes/PanelRoutes.scala` | 81 | 81 | ≤ 150 |
| `app/DemoData.scala` | 137 | 144 | ≤ 250 |
| `test/PanelSpec.scala` | new | 160 | ≤ 250 |

Soft-over files are within CS2c-2 / CS2c-3a precedent (under 400L
hard limit). The `PanelService` overage is the `buildNewPanel`
helper that explicitly enumerates the 7 subtypes for the create
path; future cycles can fold that into a registry-driven factory.
The `model.scala` slight overage is because `PanelType` ADT still
lives there in cycle 1 — captured as a spinoff (#16.8).
