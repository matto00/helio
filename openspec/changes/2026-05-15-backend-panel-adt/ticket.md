# Ticket — backend-panel-adt (CS2c-3b)

**Linear:** HEL-236 (sub-PR 8 of 8 — final piece of the HEL-236 backend ADT remodel)

**Branch:** `task/backend-panel-adt/HEL-236`

**Worktree:** `.worktrees/HEL-236-cs2c-3b/`

**Parent change folder for series design:** `openspec/changes/2026-05-14-backend-domain-adts-foundations/design.md` — CS2c-series base. Inherits its discriminator/wire-shape pattern and repo dispatch.

**Sibling change establishing the per-file polymorphic shape:** `openspec/changes/2026-05-15-backend-pipeline-step-adt/` (CS2c-3a, merged as PR #151). The polymorphic-method-per-file pattern landed in cycle 3 there is **mandatory** for CS2c-3b from day one — do NOT start with a co-located `PanelHandlers` object. Apply the executed template directly:
- One file per subtype: `domain/panels/<Kind>Panel.scala`
- Trait carries polymorphic methods that make sense for Panel (see design.md §3)
- `PanelStep` / `Panel.Registry` is the single source of truth for kinds; no hard-coded `Set[String]`
- Codec is a thin facade delegating to per-subtype companions
- Tolerance defaults co-located with the data definition

## Scope

Replace `Panel` (today: wide flat case class with 8 nullable per-subtype fields — `typeId`, `fieldMapping`, `content`, `imageUrl`, `imageFit`, `dividerOrientation`, `dividerWeight`, `dividerColor`) with a **per-subtype ADT of 7 panel kinds**:

1. **`MetricPanel`** — bound; `dataTypeId`, `fieldMapping`
2. **`ChartPanel`** — bound; `dataTypeId`, `fieldMapping`, chart appearance already on `PanelAppearance.chart`
3. **`TablePanel`** — bound; `dataTypeId`, `fieldMapping`
4. **`TextPanel`** — unbound content; `content: String`
5. **`MarkdownPanel`** — unbound content; `content: String`
6. **`ImagePanel`** — unbound content; `imageUrl`, `imageFit`
7. **`DividerPanel`** — unbound structural; `orientation`, `weight`, `color`

In scope:

1. **Panel ADT** in `domain/Panel.scala` + `domain/panels/<Kind>Panel.scala` × 7:
   - `trait Panel` (NOT `sealed`, per CS2c-3a's cycle-3 decision — Scala 2 sealed-trait can't coexist with per-file modules; exhaustiveness comes from `Panel.Registry` + an exhaustiveness spec test)
   - 7 per-kind files, each holding case class + typed config + polymorphic methods (`kind`, `dataTypeId: Option[DataTypeId]`, `validateConfig: Either[String, Unit]`, JSON format)
   - `PanelKind` constants + `Panel.Registry: Map[String, Panel.Companion]`
   - Old wide-flat `Panel` case class deleted from `domain/model.scala`
2. **Wire-shape evolution**:
   - `type` discriminator already present on the wire (verified in `frontend/src/types/models.ts:218` and `schemas/panel.schema.json:21-24`). The break here is **collapsing nullable subtype fields into a typed `config` object** per subtype, mirroring CS2c-2 (DataSource) and CS2c-3a (PipelineStep)
   - Before: `{ id, type: "metric", typeId: "...", fieldMapping: {...}, content: null, imageUrl: null, ... }`
   - After: `{ id, type: "metric", config: { dataTypeId: "...", fieldMapping: {...} } }`
   - Frontend lockstep: `Panel` discriminated union with per-subtype `config`
3. **Panel schema evolution**:
   - `schemas/panel.schema.json` becomes a discriminated-union schema (oneOf branches by `type`)
   - 7 new per-subtype config schemas under `schemas/panel-<kind>-config.schema.json` (or inline in `panel.schema.json` — executor decides)
   - `schemas/create-panel-request.schema.json` mirrors the discriminator shape
4. **Backend repo / service / routes / protocol**:
   - `PanelRepository.rowToDomain` dispatches on `panels.type` column → typed subtype. DB columns unchanged.
   - `PanelService` consumes typed ADT; PATCH validation uses polymorphic `validateConfig`
   - `PanelPatchApplier` updated for typed dispatch
   - `PanelRoutes` thin HTTP shells; entity unmarshalling typed
   - `PanelProtocol` discriminated-union `RootJsonFormat[Panel]` delegating to per-subtype companions (Registry dispatch, per CS2c-3a forward marker #2 — close this gap from the start)
5. **Snapshot import/export** (`/api/dashboards/:id/export` and `/api/dashboards/import`):
   - `DashboardSnapshotPanelEntry` shape evolves to match the new wire shape
   - Snapshot version bump (today's version is in `JsonProtocols.scala` — executor finds and bumps)
   - **Round-trip compat**: import of old-format snapshots must still work, OR a clean break with an explicit error message and a migration helper. Executor decides during exploration based on what snapshot volume is in the wild (`grep` for old-format references; if it's only DemoData, clean break is fine)
6. **Frontend lockstep**:
   - `Panel` discriminated union over `type` with typed `config` per subtype (replaces the 8 nullable fields shape at `models.ts:214-230`)
   - `PanelGrid`, `PanelDetailModal`, `useLegacyBoundPanel` (note the "legacy" prefix — this hook is named to imply existing migration in progress; verify what "legacy" means here), `usePanelData` updated for the union
   - Per-subtype panel renderer dispatch
   - `DashboardSnapshotPanelEntry` mirrors the new shape
7. **HEL-242 investigation** (P0 panel-binding bug — "populated DataTypes sometimes don't render on bound panels"):
   - **Executor investigates root cause during exploration (§1)**. Decision tree:
     - If the fix is a 5-line change naturally enabled by the typed ADT (e.g. removed because `dataTypeId: Option` → `dataTypeId: DataTypeId` on `BoundPanel`-shaped subtypes eliminates a null-check bug), **fold into CS2c-3b** with explicit call-out in the executor report
     - If the fix is larger or risks the cycle (>20 lines, touches data-fetching logic significantly), **defer to a focused follow-up PR** after CS2c-3b merges
     - Capture findings + decision in `executor-report-1.md` regardless of which path
8. **OpenSpec spec.md sync** for panel-touching specs (dashboard-builder, panel-create, frontend-dashboard-page — executor greps)
9. **Tests**:
   - Per-subtype ADT spec (`PanelSpec.scala`) — `kind` correctness, `Registry.Kinds` parity with case classes
   - Per-subtype protocol round-trip + cross-type PATCH 400 rejection
   - Repo round-trip with partial config (CS2c-3a lesson: must not 500 on partial)
   - Snapshot round-trip per subtype
   - `PanelPatchApplier` per-subtype tests
10. **Smoke validation** — Playwright Phase 3 by evaluator: login → create dashboard → add one panel of each kind (7 panels) → bind a Metric/Chart/Table to a DataType → verify all renders → export dashboard → import to a new dashboard → verify panels round-trip

Out of scope (deferred to follow-up):
- `BoundPanel` / `UnboundPanel` intermediate traits — start strict per-type; executor introduces intermediates ONLY if common methods cluster naturally during work and the refactor is genuinely small (per user decision)
- Render-logic changes beyond what the discriminated-union dispatch requires
- New panel subtypes
- CS3 (frontend feature-folder restructure)
- HEL-242 if exploration concludes it's not a small fold-in

## Why now

CS2c-3b closes the HEL-236 backend ADT remodel. After this, the three resource types that today carry "wide flat case class + nullable per-subtype fields + string discriminator" — DataSource, PipelineStep, Panel — all have proper sealed-trait-style ADTs with per-subtype typed configs. Panel is the last and trickiest because it touches the dashboard render path, has 6 dedicated JSON Schemas, and is HEL-242's territory.

The polymorphic-method-per-file pattern (CS2c-3a cycle 3) is now the executed template. Applying it from day one for Panel avoids the cycle-3 re-touch cost we paid on PipelineStep.

## Acceptance criteria

- [ ] `sbt test` green (existing baseline + new ADT/protocol/repo/snapshot tests)
- [ ] `npm test`, `npm run lint`, `npm run format:check` green
- [ ] `npm run check:schemas`, `npm run check:openspec`, `npm run check:scala-quality` clean
- [ ] File-size budgets:
  - `PanelRepository.scala` ≤ 250 lines (today 305L)
  - `PanelService.scala` ≤ 300 lines (today 287L; the ADT dispatch should not grow this)
  - `PanelRoutes.scala` ≤ 150 lines (today 81L — comfortable)
  - `PanelProtocol.scala` ≤ 150 lines (today 211L; per-subtype dispatch via Registry should shrink this)
  - Every new `domain/panels/<Kind>Panel.scala` ≤ 200 lines
- [ ] `Panel.Registry` is the single source of truth for kinds; no hard-coded `Set[String]` lists
- [ ] Cross-type PATCH locked (returns 400) — mutating panel `type` rejected
- [ ] `AuthService` unchanged
- [ ] Old wide-flat `Panel` case class deleted from `domain/model.scala`
- [ ] All 6 panel-touching schema files updated to discriminated-union shape
- [ ] Snapshot import/export round-trips per subtype
- [ ] Playwright smoke: 7-panel-kind dashboard with bound Metric/Chart/Table + export/import round-trip passes
- [ ] HEL-242 investigation findings recorded in `executor-report-1.md` regardless of which decision path
