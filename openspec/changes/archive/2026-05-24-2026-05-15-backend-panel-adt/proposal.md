# Proposal — backend-panel-adt (CS2c-3b)

## Why

Three concrete problems converge on Panel:

1. **Wide-flat case class with 8 nullable per-subtype fields.** `Panel` today carries `typeId`, `fieldMapping`, `content`, `imageUrl`, `imageFit`, `dividerOrientation`, `dividerWeight`, `dividerColor` — every field nullable, every subtype "owns" a different subset. A `TextPanel` carries 7 unused null fields; a `DividerPanel` carries 5 unused null fields. The repository / service / protocol layers all carry null-handling indirection that the typed ADT eliminates.

2. **HEL-242 (P0).** "Populated DataTypes sometimes don't render on bound panels." This is a recurring bug surface and memory notes "deferred until after CS2c lands." The polymorphic ADT structure is the natural moment to surface root cause (likely a null-handling case in `typeId` / `fieldMapping` paths that disappears when bound vs unbound is a type-level distinction). Executor investigates during exploration; folds in if small.

3. **Discriminator already on the wire — typed config payload still missing.** Unlike DataSource (CS2c-2) and PipelineStep (CS2c-3a) which needed both, Panel already exposes `type` on the wire (verified in `schemas/panel.schema.json:21-24` and `frontend/src/types/models.ts:218`). The break here is **collapsing the 8 nullable fields into a typed `config` object** per subtype — frontend gets a proper discriminated union with no nullable-field guessing.

CS2c-3b closes the HEL-236 backend ADT remodel. After this, all three "wide-flat + discriminator + nullable fields" resources (DataSource, PipelineStep, Panel) ship as proper typed ADTs.

## What changes

### Backend domain

- New `domain/Panel.scala` (or rename from `model.scala` extract) — trait + companion + Registry + execution-style context if needed:
  ```scala
  trait Panel {
    def id: PanelId
    def dashboardId: DashboardId
    def title: String
    def kind: String
    def meta: ResourceMeta
    def appearance: PanelAppearance
    def ownerId: UserId
    /** Bound subtypes (Metric/Chart/Table) return Some; unbound return None. */
    def dataTypeId: Option[DataTypeId]
    /** Per-subtype config-shape validation; returns Left with a clear message for invalid combinations. */
    def validateConfig: Either[String, Unit]
  }
  object Panel {
    trait Companion {
      def kind: String
      def readFromWire(json: JsValue): Panel
      def writeToWire(panel: Panel): JsValue
    }
    val Registry: Map[String, Companion] = Map(
      MetricPanel.Kind   -> MetricPanel.companion,
      ChartPanel.Kind    -> ChartPanel.companion,
      TablePanel.Kind    -> TablePanel.companion,
      TextPanel.Kind     -> TextPanel.companion,
      MarkdownPanel.Kind -> MarkdownPanel.companion,
      ImagePanel.Kind    -> ImagePanel.companion,
      DividerPanel.Kind  -> DividerPanel.companion
    )
    val Kinds: Set[String] = Registry.keySet
  }
  ```
- 7 per-subtype files in `domain/panels/`:
  ```scala
  // domain/panels/MetricPanel.scala
  final case class MetricPanelConfig(dataTypeId: DataTypeId, fieldMapping: JsObject)
  final case class MetricPanel(id, dashboardId, title, meta, appearance, ownerId, config: MetricPanelConfig) extends Panel {
    val kind: String = MetricPanel.Kind
    def dataTypeId: Option[DataTypeId] = Some(config.dataTypeId)
    def validateConfig: Either[String, Unit] = Right(())
  }
  object MetricPanel {
    val Kind: String = "metric"
    val companion: Panel.Companion = new Panel.Companion { ... }
  }
  ```
  Similarly for `ChartPanel`, `TablePanel`, `TextPanel`, `MarkdownPanel`, `ImagePanel`, `DividerPanel`.
- Old wide-flat `Panel` case class deleted from `domain/model.scala`.

### Backend infrastructure (repo)

- `PanelRepository.rowToDomain` dispatches on `panels.type` column → typed subtype via `Panel.Registry`. DB columns unchanged (8 nullable columns continue to back the stored shape; row → typed dispatch happens at the repo boundary).
- `domainToRow` pattern-matches subtype → column-by-column flatten.
- **Read-path tolerance** (CS2c-3a lesson): rows persisted with missing/null subtype fields (e.g. a `MetricPanel` row with `typeId IS NULL`) decode to default-valued config — `MetricPanelConfig(DataTypeId(""), JsObject.empty)` — instead of throwing. Per-kind tolerance defaults documented in the per-subtype file.
- Today's `PanelRepository.scala` is 305L (over soft 250 target). The ADT dispatch should not grow this.

### Backend protocol

- `api/protocols/PanelProtocol.scala`:
  - Discriminated-union `RootJsonFormat[Panel]` delegating to `Panel.Registry[kind].companion` (Registry dispatch, addressing the CS2c-3a forward marker about hard-coded subtype enumeration)
  - `CreatePanelRequest` / `UpdatePanelRequest` discriminate on `type`
  - Cross-type PATCH (mutating `type`) returns 400 with explicit message
- Today's `PanelProtocol.scala` is 211L; Registry-driven dispatch should shrink it.

### Backend services

- `PanelService.addPanel` / `updatePanel`: typed ADT consumption; per-subtype `validateConfig` invoked
- `PanelPatchApplier`: per-subtype typed dispatch
- Cross-type PATCH (mutating panel `type`) returns 400; matches CS2c-2 / CS2c-3a policy

### Backend routes

- `PanelRoutes` thin HTTP shells; entity unmarshalling typed
- `DashboardRoutes` snapshot export/import paths updated for new wire shape

### Snapshot import/export

- `DashboardSnapshotPanelEntry` evolves to mirror the new wire shape (typed `config` per subtype)
- Snapshot version bump
- Import compatibility: executor decides during exploration based on what exists in the wild — clean break + explicit error if only DemoData uses the old format; backward-compat shim if any user data exists

### Schema

- `schemas/panel.schema.json` → discriminated-union shape (`oneOf` by `type`)
- 7 per-subtype config schemas (inline or as separate files; executor decides)
- `schemas/create-panel-request.schema.json` mirrors
- `schemas/panel.schema.json:65` comment about `dataSourceId` being invalid is preserved or strengthened by the typed shape (panels bind to DataTypes, not DataSources directly)

### Frontend

- `frontend/src/types/models.ts` lines 214–230:
  ```ts
  export type Panel =
    | MetricPanel | ChartPanel | TablePanel
    | TextPanel | MarkdownPanel | ImagePanel | DividerPanel;
  interface BasePanel { id: string; dashboardId: string; title: string; meta: ResourceMeta; appearance: PanelAppearance; ownerId: string; }
  export interface MetricPanel   extends BasePanel { type: "metric";   config: { dataTypeId: string; fieldMapping: Record<string, string> }; }
  export interface ChartPanel    extends BasePanel { type: "chart";    config: { dataTypeId: string; fieldMapping: Record<string, string> }; }
  export interface TablePanel    extends BasePanel { type: "table";    config: { dataTypeId: string; fieldMapping: Record<string, string> }; }
  export interface TextPanel     extends BasePanel { type: "text";     config: { content: string }; }
  export interface MarkdownPanel extends BasePanel { type: "markdown"; config: { content: string }; }
  export interface ImagePanel    extends BasePanel { type: "image";    config: { imageUrl: string; imageFit: ImageFit }; }
  export interface DividerPanel  extends BasePanel { type: "divider";  config: { orientation: DividerOrientation; weight?: number; color?: string }; }
  ```
- `panelsSlice.ts` thunk payloads + state shape
- `PanelGrid`, `PanelDetailModal`, `usePanelData` updated to consume the union
- `useLegacyBoundPanel.ts` — **investigate the "legacy" naming**; if it's a transition shim for a prior migration, decide whether CS2c-3b removes it or preserves it
- Per-subtype panel renderer dispatch (renderer components per subtype; if 3+ consumers narrow on `panel.type === "metric"`, extract `isMetricPanel` helper per CS2c-2 rule)
- `DashboardSnapshotPanelEntry` mirrors the new shape

### HEL-242 investigation

The executor investigates during exploration (§1.6 of tasks). Concrete questions:

1. What is `useLegacyBoundPanel` actually doing? Is it a sign of a prior incomplete migration?
2. Where does the panel render-empty-when-DataType-populated bug originate? `usePanelData`? `PanelGrid`? Backend `Panel.buildQuery`?
3. Does the typed ADT (especially making `MetricPanel.config.dataTypeId: DataTypeId` non-nullable) eliminate the bug as a side effect?

Decision tree:
- **Fold in if small**: ≤20 line fix that naturally falls out of the ADT shape. Document in executor report. Add regression test.
- **Defer if large**: capture root cause in executor report + open a follow-up ticket. CS2c-3b stays a pure structural refactor.

## Wire-shape diff (illustrative)

**Before:**
```json
{
  "id": "panel_abc",
  "dashboardId": "dash_123",
  "title": "Revenue",
  "type": "metric",
  "meta": { ... },
  "appearance": { ... },
  "ownerId": "user_x",
  "typeId": "dt_revenue",
  "fieldMapping": { "value": "amount" },
  "content": null,
  "imageUrl": null,
  "imageFit": null,
  "dividerOrientation": null,
  "dividerWeight": null,
  "dividerColor": null
}
```

**After:**
```json
{
  "id": "panel_abc",
  "dashboardId": "dash_123",
  "title": "Revenue",
  "type": "metric",
  "meta": { ... },
  "appearance": { ... },
  "ownerId": "user_x",
  "config": {
    "dataTypeId": "dt_revenue",
    "fieldMapping": { "value": "amount" }
  }
}
```

A `TextPanel` after:
```json
{ "id": "...", "type": "text", "config": { "content": "Hello dashboard" }, ... }
```

A `DividerPanel` after:
```json
{ "id": "...", "type": "divider", "config": { "orientation": "horizontal", "weight": 2, "color": "#cccccc" }, ... }
```

## Non-goals

- No DB schema migration. Panel columns (`type`, `typeId`, `fieldMapping`, `content`, `imageUrl`, `imageFit`, `dividerOrientation`, `dividerWeight`, `dividerColor`) preserved. The ADT is a domain/wire concern; rows stay flat in storage.
- No `BoundPanel` / `UnboundPanel` intermediate traits in cycle 1 (user explicitly chose strict per-type first)
- No new panel subtypes
- No render-logic changes beyond what the discriminated-union dispatch requires
- CS3 frontend feature-folder restructure stays out

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Snapshot import/export breaks for in-the-wild snapshots | Executor inventories what exists; clean break with explicit error if only DemoData; backward-compat shim if user data exists |
| Panel render path regression — bound panels show empty after change | Phase 3 Playwright must verify bound + unbound rendering end-to-end; smoke includes a 7-panel-kind dashboard with bound Metric/Chart/Table |
| HEL-242 widens cycle 1 unexpectedly | Executor investigation has explicit defer-if-large escape hatch |
| `useLegacyBoundPanel` is part of an unfinished prior migration | Executor inspects during exploration; either removes (clean break) or preserves (defer) — explicit decision in report |
| Cross-type PATCH allowed today implicitly | Locked at 400 with clear message — matches CS2c-2 / CS2c-3a |
| Per-subtype config shapes drift from what frontend sends | Schema discriminated-union + Playwright smoke catches at JSON-unmarshal time |
| HEL-256 (P0 data-source schema disappearance) is "very closely aligned" with this remodel | Out of scope for CS2c-3b; tracked as separate work |

## Out of scope (capture as spinoffs if surfaced)

- `BoundPanel` / `UnboundPanel` intermediate traits when ≥2 polymorphic methods cluster naturally on data-bound vs content panels
- `PanelDataResolver` extraction if `Panel.buildQuery` polymorphism grows beyond `Option[DataTypeId]`
- HEL-242 if exploration concludes it's not a small fold-in
- `useLegacyBoundPanel` removal if it represents an unfinished prior migration
- Snapshot version-N → version-(N+1) automatic upgrade tooling

## Estimate

Comparable to CS2c-3a in surface count, but with 3 unique additions: snapshot import/export updates, 6 panel-related JSON Schemas to migrate, and the HEL-242 investigation. Realistic: 1 executor cycle + 1 evaluator cycle if HEL-242 defers; potentially 2 executor cycles if HEL-242 folds in.
