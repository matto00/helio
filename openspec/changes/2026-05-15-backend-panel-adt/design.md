# Design — backend-panel-adt (CS2c-3b)

This document focuses on CS2c-3b-specific decisions. **Inherits** the discriminator/wire-shape/repo-dispatch pattern from `openspec/changes/2026-05-14-backend-domain-adts-foundations/design.md` (CS2c-series base) and the **executed per-file polymorphic-method template** from `openspec/changes/2026-05-15-backend-pipeline-step-adt/` (CS2c-3a, PR #151).

## Architectural pattern (inherited)

Wire shape: `{ id, type: "<kind>", config: {...kind-specific shape...}, ...common-fields }` — identical to DataSource (CS2c-2) and PipelineStep (CS2c-3a) modulo Panel-specific common fields.

Repo dispatch: `rowToDomain` reads `panels.type` column as discriminator, parses subtype-specific columns into typed `config`, constructs typed subtype via Registry. `domainToRow` flattens.

Frontend: discriminated union over `type` with per-subtype `config` typed. Narrowing helpers only where 3+ consumers need same narrow.

DB unchanged: no Flyway. `panels` table columns preserved.

Cross-type PATCH locked at 400.

**Per-file shape (CS2c-3a cycle 3 template, mandatory from day one):**
- One file per subtype: `domain/panels/<Kind>Panel.scala`
- Trait carries polymorphic methods (`kind`, `dataTypeId`, `validateConfig`); not `sealed` (Scala 2 sealed conflicts with per-file modules; exhaustiveness via Registry + spec test)
- `Panel.Registry: Map[String, Panel.Companion]` is single source of truth for kinds
- Codec / Protocol delegate to per-subtype companions

## CS2c-3b-specific design decisions

### 1. Trait shape: minimal polymorphic surface

Unlike PipelineStep (which carries `evaluate` because the engine dispatches on it polymorphically), Panel's polymorphic surface on the backend is lighter. Render lives in the frontend; backend operations are mostly storage + validation + snapshot serialization.

Proposed trait surface:

```scala
trait Panel {
  // Common identity + metadata
  def id: PanelId
  def dashboardId: DashboardId
  def title: String
  def kind: String
  def meta: ResourceMeta
  def appearance: PanelAppearance
  def ownerId: UserId

  /** Bound subtypes return Some; unbound return None. Replaces today's nullable `typeId`. */
  def dataTypeId: Option[DataTypeId]

  /** Per-subtype config-shape validation. Returns Left with a clear error string
   *  for invalid combinations (e.g. ImagePanel with empty imageUrl, DividerPanel
   *  with weight ≤ 0). Subtypes that don't have invariants return Right(()). */
  def validateConfig: Either[String, Unit]
}
```

That's the minimum justifying the per-file shape. If during exploration the executor finds other natural polymorphic methods (e.g. `buildQuery: Option[PanelQuery]` polymorphic via subtype) those can be added — keep the trait surface tight, don't over-engineer.

`buildQuery` candidate: today it's a free function `Panel.buildQuery(panel)`. Polymorphic version `def buildQuery: Option[PanelQuery]` returns `None` for unbound panels and `Some(...)` for bound. **Worth folding in** since it eliminates the `typeId.map { _ => ... }` pattern at the call site.

### 2. Per-subtype config shapes

| Subtype | Config |
|---|---|
| `MetricPanel` | `MetricPanelConfig(dataTypeId: DataTypeId, fieldMapping: JsObject)` |
| `ChartPanel` | `ChartPanelConfig(dataTypeId: DataTypeId, fieldMapping: JsObject)` — chart appearance already on `PanelAppearance.chart`, no additional config |
| `TablePanel` | `TablePanelConfig(dataTypeId: DataTypeId, fieldMapping: JsObject)` |
| `TextPanel` | `TextPanelConfig(content: String)` |
| `MarkdownPanel` | `MarkdownPanelConfig(content: String)` |
| `ImagePanel` | `ImagePanelConfig(imageUrl: String, imageFit: ImageFit)` |
| `DividerPanel` | `DividerPanelConfig(orientation: DividerOrientation, weight: Option[Int], color: Option[String])` |

`ImageFit` and `DividerOrientation` become typed enums (already strings on the wire). Defer string-enum-to-Scala-enum decision to the executor — `String` with validation in `validateConfig` is fine if the type ergonomics are clunky.

Bound trio (Metric/Chart/Table) all share `(dataTypeId, fieldMapping)`. If during work the executor finds those three subtypes diverging more, fine; if they stay identical, a shared `BoundConfig` case class is fine but **not** an intermediate trait — user explicitly chose strict per-type.

### 3. Read-path tolerance (CS2c-3a lesson)

Every per-subtype JSON format decodes partial JSON to default-valued config without throwing. Defaults:

| Subtype | Missing-field defaults |
|---|---|
| `MetricPanel` / `ChartPanel` / `TablePanel` | `dataTypeId → DataTypeId("")`, `fieldMapping → JsObject.empty` |
| `TextPanel` / `MarkdownPanel` | `content → ""` |
| `ImagePanel` | `imageUrl → ""`, `imageFit → "contain"` |
| `DividerPanel` | `orientation → "horizontal"`, `weight → None`, `color → None` |

A row persisted with `typeId IS NULL` and `type='metric'` (mid-edit state, or pre-typed-shape data) decodes to `MetricPanelConfig(DataTypeId(""), JsObject.empty)`. `listPanels` and `getPanel` stay alive; rendering may surface a "no data type bound" empty state in the UI (the existing behavior). `validateConfig` may emit a warning when called — implementation-detail decision for the executor.

Regression test required (per CS2c-3a cycle 2 lesson): `PanelRepositorySpec` round-trip with `INSERT INTO panels (type='metric', typeId=NULL, fieldMapping=NULL, ...)` → `listByDashboard` returns 200 with default-valued config.

### 4. `useLegacyBoundPanel` — exploration required

The name implies a prior migration that may or may not be finished. Executor inspects during exploration (§1.4):

- What does it actually do?
- What does "legacy" refer to?
- Was there a previous attempt at this refactor?
- Should CS2c-3b remove it (clean break) or preserve it (defer)?

Decision recorded in `executor-report-1.md`.

### 5. Snapshot import/export

Today's snapshot shape (from `frontend/src/types/models.ts:239-260`):

```ts
export interface DashboardSnapshotPanelEntry {
  snapshotId: string;
  title: string;
  type: string;          // already discriminated
  appearance: { ... };
  typeId?: string | null;
  fieldMapping?: Record<string, string> | null;
  content?: string | null;
  // Image / Divider fields missing from the snapshot entry (potential gap)
}
```

After:

```ts
export interface DashboardSnapshotPanelEntry {
  snapshotId: string;
  title: string;
  type: PanelType;
  appearance: PanelAppearance;
  config: MetricPanelConfig | ChartPanelConfig | ... | DividerPanelConfig;
  // (or just `unknown` typed-by-discriminator if the snapshot shape can mirror the wire shape)
}
```

**Snapshot version bump**: today's version is in `JsonProtocols.scala` (executor finds via grep). CS2c-3b bumps the version.

**Backward-compat decision**: executor inventories existing snapshots during exploration (§1.5). If only `DemoData` references the old shape, clean break with explicit error message + migration helper sketch. If user data exists, backward-compat shim that maps old-format `{ typeId, fieldMapping, content, ... }` into typed `config`.

Note today's `DashboardSnapshotPanelEntry` is missing Image / Divider fields — even pre-CS2c-3b, exporting an Image or Divider panel loses data on round-trip. CS2c-3b fixes this as a side effect of the typed `config` shape (Image/Divider configs are now first-class in the snapshot).

### 6. HEL-242 investigation

Executor explores during §1.6. Concrete steps:

1. Read `useLegacyBoundPanel.ts` and `usePanelData.ts`
2. Read backend `Panel.buildQuery` — it's a free function today, may be a candidate for polymorphic refactor
3. Grep for "binding" / "bound" / "typeId" sites in frontend; identify the render path for bound panels
4. Reproduce the bug locally: create a Metric panel bound to a populated DataType; verify it renders rows correctly. If it does, the bug is intermittent (test data ordering?); if it doesn't, the fix surface is now visible
5. Decide:
   - **Fold in**: ≤20-line change naturally enabled by the ADT (e.g. removed null-check that becomes unreachable). Add regression test. Document in report.
   - **Defer**: capture root cause + open follow-up ticket. CS2c-3b stays structural-only.

### 7. File-size targets (CS2c-3b)

| File | Today | Target | Plan |
|---|---:|---:|---|
| `domain/Panel.scala` | new | ≤ 100 | trait + Registry + Panel.Companion |
| `domain/panels/<Kind>Panel.scala` × 7 | new | ≤ 200 each | most ≤ 100; Image/Divider may approach 120 |
| `model.scala` | 294 | ≤ 250 | Panel case class removal returns this under budget (per CS2c-3a precedent) |
| `PanelRepository.scala` | 305 | ≤ 250 | typed dispatch + Registry should shrink |
| `PanelService.scala` | 287 | ≤ 300 | minor shrink (loses some null-handling indirection) |
| `PanelRoutes.scala` | 81 | ≤ 150 | already comfortable |
| `PanelProtocol.scala` | 211 | ≤ 150 | Registry-driven dispatch shrinks this |
| `PanelPatchApplier.scala` | unknown | ≤ 250 | per-subtype typed dispatch |
| `panel.schema.json` | 66 | ≤ 100 | discriminated union grows it modestly |

If `PanelService` or `PanelPatchApplier` exceed budget after the typed dispatch, soft-overage is acceptable per CS2c-2 / CS2c-3a precedent (under >400L hard blocker).

### 8. Test parity strategy

Existing test suites that touch Panel:

```
backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala               # main suite, ~2996L; panel endpoint cases live here
backend/src/test/scala/com/helio/services/PanelServiceSpec.scala       # if exists
backend/src/test/scala/com/helio/infrastructure/PanelRepositorySpec.scala # if exists
frontend/src/components/PanelGrid.test.tsx
frontend/src/features/panels/*.test.ts
```

Strategy:
1. Update test fixtures to construct typed Panel ADT instances
2. Run the full suite; any green→red is a behavior regression and blocker
3. New per-subtype `PanelSpec.scala` for ADT shape (kind correctness, Registry parity)
4. New `PanelProtocolSpec.scala` for round-trip per kind + cross-type-patch rejection
5. New repo-level regression test: partial-config decode (CS2c-3a cycle-2 lesson)
6. New snapshot round-trip per kind

### 9. Smoke validation (evaluator Phase 3)

Required flow:
1. Login (`matt@helio.dev`)
2. Create new dashboard `Smoke CS2c-3b`
3. Add one panel of each of the 7 kinds (use modal flow)
4. Bind Metric/Chart/Table panels to a seeded DataType (e.g. the seeded `Profit` source's typed)
5. Verify all 7 panels render correctly (bound show data, unbound show content/image/divider)
6. Export the dashboard → inspect snapshot JSON (confirm typed `config` per panel)
7. Import the snapshot into a new dashboard (or new instance) → confirm all 7 panels round-trip with full fidelity
8. Inspect Network tab: confirm `config` is a typed object per panel; no nullable `typeId`/`fieldMapping`/`content` etc. at the panel-root level

Negative-path:
- Attempt cross-type PATCH (`PATCH /api/panels/<id>` with `{type:"divider"}` on a Metric panel) — expect 400 with clear message
- Inspect a partial-config row (the executor sets one up during testing if not already present in DemoData) — confirm `listByDashboard` doesn't 500

### 10. Frontend impact map

```
frontend/src/types/models.ts                         — Panel union, per-subtype config interfaces, DashboardSnapshotPanelEntry
frontend/src/features/panels/panelsSlice.ts          — thunk payloads typed
frontend/src/hooks/useLegacyBoundPanel.ts            — investigate; remove or preserve
frontend/src/hooks/usePanelData.ts                   — bound-panel data fetch path; HEL-242 surface
frontend/src/components/PanelGrid.tsx                — renders the panel union; per-subtype renderer dispatch
frontend/src/components/PanelDetailModal.tsx         — typed config-shape consumption
frontend/src/components/Panel*.tsx (per kind)        — per-subtype renderer components
frontend/src/test/renderWithStore.tsx                — fixture updates
```

### 11. The `appearance.chart` quirk

`PanelAppearance.chart: Option[ChartAppearance]` is on the common appearance object today. It only makes sense for `ChartPanel`. **Don't move it** into `ChartPanelConfig` in cycle 1 — that's an appearance-vs-config boundary change that's out of scope here. Leave `appearance.chart` on the common shape; `ChartPanel.validateConfig` may enforce that bound charts have chart appearance populated (executor judgment).

This is the cleanest minimal cycle-1 scope. Restructuring appearance-vs-config can be a CS3-era spinoff.

### 12. Test count baseline

Today (post-CS2c-3a): 577 sbt + 664 Jest = 1241 total.

Expected:
- sbt: +30–40 (per-subtype protocol + repo + snapshot tests)
- Jest: +5–10 (panel discriminated union consumers)
- Regression count: 0

## Smoke validation

Outlined in §9 above.
